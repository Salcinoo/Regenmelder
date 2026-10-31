# Regenmelder – Website + Push-Backend + ESP32-C3

Dieses Projekt enthält:
- eine installierbare PWA (Website) für iPhone und PC
- einen Cloudflare-Worker als API und Web-Push-Versender
- ein MicroPython-Beispiel für den ESP32-C3
- eine Anleitung für GitHub Pages und Cloudflare

## Wichtige Architektur

GitHub Pages kann nur die statische Website hosten. Es kann keine Push-Abonnements speichern und keine Pushnachrichten versenden.
Dafür enthält dieses Projekt einen separaten Cloudflare Worker. Der Worker ist kostenlos im Free-Tarif nutzbar (Limits beachten).
Der ESP32-C3 sendet nur ausgehende HTTPS-Anfragen an den Worker. Es ist keine Portfreigabe am Router nötig.

**Wichtig:** Die Pushfunktion ist für iPhones erst verfügbar, wenn die Website in Safari zum Home-Bildschirm hinzugefügt und von dort gestartet wurde. Danach kann der Nutzer Push erlauben. iOS/iPadOS 16.4 oder neuer ist erforderlich.

## 1. Website auf GitHub Pages veröffentlichen

1. Neues öffentliches GitHub-Repository erstellen, z. B. `regenmelder`.
2. Den Inhalt des Ordners `site/` in das Stammverzeichnis des Repositorys hochladen.
3. In GitHub: **Settings → Pages**.
4. Bei **Build and deployment** `Deploy from a branch` wählen.
5. Branch `main`, Ordner `/ (root)` auswählen und speichern.
6. Die veröffentlichte Adresse wird etwa `https://DEIN-NAME.github.io/regenmelder/` sein.

## 2. Cloudflare Worker einrichten

Ein kostenloses Cloudflare-Konto unter https://dash.cloudflare.com/ anlegen.

### KV-Speicher anlegen
1. Cloudflare Dashboard → **Workers & Pages → KV**.
2. Namespace mit dem Namen `REGENMELDER_KV` erstellen.
3. Die Namespace-ID notieren.

### Worker-Dateien bereitstellen
1. Lokal Node.js installieren: https://nodejs.org/
2. In den Ordner `worker/` wechseln.
3. `wrangler.toml` öffnen und `id = "DEINE_KV_NAMESPACE_ID"` durch die KV-ID ersetzen.
4. Terminal öffnen und ausführen:

   npm install
   npx wrangler login
   npx wrangler secret put DEVICE_TOKEN
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT
   npx wrangler deploy

Für `DEVICE_TOKEN` einen langen, zufälligen Geheimwert verwenden.
Für VAPID-Schlüssel kann z. B. das Tool `web-push` verwendet werden:
   npx web-push generate-vapid-keys

`VAPID_SUBJECT` z. B. `mailto:DEINE-EMAIL@example.com`.

**Hinweis zur Laufzeit:** Der Worker nutzt das npm-Paket `web-push` mit `nodejs_compat`. Die tatsächliche Kompatibilität kann je nach Worker-Runtime und Paketversion variieren. Nach dem Deploy bitte zuerst mit einem Test-iPhone prüfen. Wenn Cloudflare die Paket-APIs nicht unterstützt, muss der Push-Versand auf einen kompatiblen Node-Host verschoben werden.

Nach erfolgreichem Deploy zeigt Wrangler eine Worker-Adresse, z. B.
`https://regenmelder-api.DEIN-KONTO.workers.dev`

### API-Adresse in der Website eintragen
In `site/app.js` ganz oben `API_BASE` auf deine Worker-Adresse setzen, ohne abschließenden Slash.

### Worker-Konfiguration
Die Datei `worker/wrangler.toml` enthält die KV-Bindung. Der Worker speichert Push-Abonnements in KV.

## 3. ESP32-C3 einrichten

1. In `esp32/config.py` WLAN-Name, WLAN-Passwort, Worker-URL und DEVICE_TOKEN eintragen.
2. Dateien `config.py`, `main.py` und `rain_sensor.py` auf den ESP32-C3 kopieren.
3. Sensor-Ausgang AO an GPIO0, GND an GND und VCC an 3,3 V anschließen.
4. Den Grenzwert nach Messung in `rain_sensor.py` anpassen.

Das Beispiel nutzt `urequests`. Falls deine MicroPython-Firmware kein `urequests` enthält, kann `requests` oder eine passende HTTP-Bibliothek verwendet werden.

## 4. Push auf dem iPhone aktivieren

1. Website in Safari öffnen.
2. Teilen → **Zum Home-Bildschirm**.
3. Die App über das neue Symbol starten.
4. In Regenmelder **Push aktivieren** antippen.
5. iOS-Abfrage mit **Erlauben** bestätigen.

Die Website muss über HTTPS geladen werden. GitHub Pages erfüllt das.

## 5. Test

- Auf der Website Push aktivieren.
- Auf dem ESP32 einen Regenbeginn auslösen oder `send_event("REGEN_START")` testen.
- Die Pushnachricht sollte auf dem iPhone eintreffen.

## Sicherheit / Betrieb

- `DEVICE_TOKEN` niemals in ein öffentliches GitHub-Repository hochladen.
- `config.py` mit WLAN-Passwort und Token nicht veröffentlichen. Am besten `config.example.py` ins Repository stellen und `config.py` nur lokal auf den ESP32 kopieren.
- Die Website ist öffentlich. Der Status-Endpunkt ist öffentlich lesbar; keine privaten Daten dort ablegen.
- Der Worker prüft den Geräte-Token für Regenereignisse.
- Dies ist ein Startprojekt. Vor dauerhaftem Außeneinsatz Sensor entprellen, Trocken-/Nassgrenzwert kalibrieren und Stromversorgung/WLAN-Ausfallszenarien testen.
