
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
      return json({
        publicKey: env.VAPID_PUBLIC_KEY || "",
        configured: !!env.VAPID_PUBLIC_KEY
      });
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
      const auth = request.headers.get("Authorization") || "";

      if (auth !== "Bearer " + env.DEVICE_TOKEN)
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
      if (env.VAPID_SUBJECT && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
        await sendPush(env, {
          title: "Regenmelder",
          body: raining ? "Regen erkannt!" : "Regen beendet!",
          tag: "regenmelder-" + body.event.toLowerCase()
        });
      }

      return json({ ok: true, state });
    }

    return json({ error: "Not found" }, 404);
  }
};

async function sendPush(env, payload) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  const keys = await env.REGENMELDER_KV.list({ prefix: "sub:" });

  await Promise.all(keys.keys.map(async item => {
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
