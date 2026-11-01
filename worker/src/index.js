
import webpush from "web-push";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: cors });

const now = () => new Date().toISOString();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS")
      return new Response(null, { headers: cors });

    if (url.pathname === "/api/vapid-public-key" && request.method === "GET") {
      try {
        const keys = await getVapidKeys(env);
        return json({ publicKey: keys.publicKey, configured: true });
      } catch (error) {
        console.log("VAPID setup error", error?.message || String(error));
        return json({ publicKey: "", configured: false, error: "Push-Schlüssel konnten nicht bereitgestellt werden" }, 503);
      }
    }

    if (url.pathname === "/api/status" && request.method === "GET") {
      const state = await env.REGENMELDER_KV.get("state", "json") ||
        { raining: false, updated_at: null, device_online: false, events: [] };

      const updated = state.updated_at ? Date.parse(state.updated_at) : 0;
      state.device_online = !!updated && (Date.now() - updated) < 120000;

      return json(state);
    }

    if (url.pathname === "/api/subscribe" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const sub = body.subscription || body;
      const preferences = body.preferences || { start: true, end: true };

      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth)
        return json({ error: "Invalid subscription" }, 400);

      const id = await hash(sub.endpoint);

      await env.REGENMELDER_KV.put(
        "sub:" + id,
        JSON.stringify({ subscription: sub, preferences })
      );

      return json({ ok: true });
    }

    if (url.pathname === "/api/event" && request.method === "POST") {
      const auth = (request.headers.get("Authorization") || "").trim();
      const authParts = auth.split(/\s+/);
      const scheme = (authParts.shift() || "").toLowerCase();
      const suppliedToken = authParts.join(" ");
      const expectedToken = String(env.DEVICE_TOKEN || "").trim();

      if (scheme !== "bearer" || !expectedToken || suppliedToken !== expectedToken)
        return json({ error: "Unauthorized" }, 401);

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      if (!["REGEN_START", "REGEN_END", "HEARTBEAT"].includes(body.event))
        return json({ error: "Invalid event" }, 400);

      const old = await env.REGENMELDER_KV.get("state", "json") || {
        raining: false, updated_at: null, device_online: false, events: []
      };
      const timestamp = now();

      // Heartbeats refresh the online timestamp without changing rain state
      // or creating a visible event in the history.
      if (body.event === "HEARTBEAT") {
        const state = { ...old, updated_at: timestamp, device_online: true };
        await env.REGENMELDER_KV.put("state", JSON.stringify(state));
        return json({ ok: true, state });
      }

      const raining = body.event === "REGEN_START";
      const event = { event: body.event, time: timestamp };
      const events = [event, ...(old.events || [])].slice(0, 30);
      const state = { raining, updated_at: timestamp, device_online: true, events };

      await env.REGENMELDER_KV.put("state", JSON.stringify(state));

      // Rain status must still be saved if push credentials are not configured.
      let push = "not_configured";
      try {
        await sendPush(env, {
          title: "Regenmelder",
          body: raining ? "Regen erkannt!" : "Regen beendet!",
          tag: "regenmelder-" + body.event.toLowerCase()
        });
        push = "sent";
      } catch (error) {
        // Rain state is already safely stored; push failures must not reject the ESP32 event.
        push = "failed";
        console.log("Push send error", error?.message || String(error));
      }

      return json({ ok: true, state, push });
    }

    return json({ error: "Not found" }, 404);
  }
};

async function getVapidKeys(env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  }

  // If VAPID secrets were not added in Cloudflare, create and persist a keypair
  // in the existing KV namespace. This avoids requiring manual secret setup.
  const stored = await env.REGENMELDER_KV.get("vapid:keys", "json");
  if (stored?.publicKey && stored?.privateKey) return stored;

  const generated = webpush.generateVAPIDKeys();
  const keys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
  await env.REGENMELDER_KV.put("vapid:keys", JSON.stringify(keys));
  return keys;
}

async function sendPush(env, payload) {
  const keys = await getVapidKeys(env);
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || "mailto:regenmelder@example.com",
    keys.publicKey,
    keys.privateKey
  );

  const subscriptions = await env.REGENMELDER_KV.list({ prefix: "sub:" });

  await Promise.all(subscriptions.keys.map(async item => {
    const raw = await env.REGENMELDER_KV.get(item.name);
    if (!raw) return;

    const saved = JSON.parse(raw);
    const wantsStart = payload.tag.endsWith("regen_start");

    if (wantsStart && saved.preferences?.start === false) return;
    if (!wantsStart && saved.preferences?.end === false) return;

    try {
      await webpush.sendNotification(
        saved.subscription || saved,
        JSON.stringify(payload)
      );
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410)
        await env.REGENMELDER_KV.delete(item.name);
      else
        console.log("Push send error", e.message);
    }
  }));
}

async function hash(s) {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
