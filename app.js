// Nach dem Deploy die Worker-Adresse eintragen (ohne abschließenden Slash).
const API_BASE = "https://regenmelder-api.niclas-tiedge.workers.dev";

const $ = (id) => document.getElementById(id);
let currentStatus = null;

function apiReady(){ return API_BASE.startsWith("https://") && !API_BASE.includes("DEIN-WORKER"); }
function setConnection(ok){ $("connection").textContent=ok?"Server erreichbar":"Server nicht erreichbar"; $("connection").className="pill "+(ok?"ok":"bad"); }
function niceTime(value){ if(!value) return "–"; try{return new Date(value).toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short"});}catch{return value;} }

async function loadStatus(){
  if(!apiReady()){setConnection(false);$("rainState").textContent="Einrichtung erforderlich";$("lastUpdate").textContent="Trage zuerst die Worker-Adresse in app.js ein.";return;}
  try{
    const r=await fetch(API_BASE+"/api/status",{cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data=await r.json(); currentStatus=data; setConnection(true);
    const rain=!!data.raining;
    $("rainState").textContent=rain?"Regen erkannt":"Kein Regen";
    $("weatherIcon").textContent=rain?"🌧️":"☀️";
    $("lastUpdate").textContent="Letzte Aktualisierung: "+niceTime(data.updated_at);
    $("sensorState").textContent=data.device_online?"Verbunden":"Warte auf ESP32-C3";
    $("lastContact").textContent=niceTime(data.updated_at);
    const list=$("events"); list.innerHTML="";
    if(!data.events || !data.events.length){list.innerHTML='<li class="empty">Noch keine Ereignisse vorhanden.</li>';return;}
    data.events.slice(0,12).forEach(e=>{const li=document.createElement("li");const label=e.event==="REGEN_START"?"🌧️ Regenbeginn":"☀️ Regenende";li.innerHTML=`<span>${label}</span><small>${niceTime(e.time)}</small>`;list.appendChild(li);});
  }catch(e){setConnection(false);$("lastUpdate").textContent="Server momentan nicht erreichbar.";}
}

async function enablePush(){
  if(!apiReady()){ $("pushStatus").textContent="Zuerst die Worker-Adresse in app.js eintragen.";return;}
  if(!("serviceWorker" in navigator) || !("PushManager" in window)){ $("pushStatus").textContent="Dieser Browser unterstützt Web Push nicht.";return;}
  if(!window.isSecureContext){ $("pushStatus").textContent="Push benötigt HTTPS.";return;}
  try{
    const reg=await navigator.serviceWorker.register("./service-worker.js");
    const permission=await Notification.requestPermission();
    if(permission!=="granted"){ $("pushStatus").textContent="Benachrichtigungen wurden nicht erlaubt.";return;}
    const keyResponse=await fetch(API_BASE+"/api/vapid-public-key");
    if(!keyResponse.ok) throw new Error("VAPID-Schlüssel konnte nicht geladen werden.");
    const key=(await keyResponse.json()).publicKey;
    const subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(key)});
    const saved=await fetch(API_BASE+"/api/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subscription,preferences:{start:$("startToggle").checked,end:$("endToggle").checked}})});
    if(!saved.ok) throw new Error("Abonnement konnte nicht gespeichert werden.");
    $("pushStatus").textContent="Push-Benachrichtigungen sind aktiviert.";
  }catch(e){$("pushStatus").textContent="Fehler beim Aktivieren: "+e.message;}
}
function urlBase64ToUint8Array(s){const p="=".repeat((4-s.length%4)%4);const b=atob((s+p).replace(/-/g,"+").replace(/_/g,"/"));const a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}

$("enablePush").addEventListener("click",enablePush);
$("refresh").addEventListener("click",loadStatus);
$("startToggle").addEventListener("change",()=>localStorage.setItem("notifyStart",$("startToggle").checked?"1":"0"));
$("endToggle").addEventListener("change",()=>localStorage.setItem("notifyEnd",$("endToggle").checked?"1":"0"));
$("startToggle").checked=localStorage.getItem("notifyStart")!=="0";
$("endToggle").checked=localStorage.getItem("notifyEnd")!=="0";
if("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
loadStatus();setInterval(loadStatus,15000);
