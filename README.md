# Chartr

Diktier-App für die ambulante Pflege. Sie nimmt Sprachnotizen nach einem Einsatz auf und lädt sie auf die **eigene** Nextcloud hoch. Dort werden sie lokal weiterverarbeitet.

Gebaut von Jost Centeno Castro, Pflegefachmann HF Psychiatrie und Experte Intensivpflege NDS HF, für die eigene Praxis im Kanton Zürich. Geteilt, damit andere Pflegefachpersonen davon lernen und es weiterbauen können.

## Was die App macht

- **Aufnehmen:** Sprachnotiz zu einem Einsatz, einer Klientin oder einem Klienten zugeordnet.
- **Hochladen:** über WebDAV in einen Ordner der eigenen Nextcloud, nur über HTTPS.
- **Inbox:** zeigt fertige Transkripte aus der Nextcloud an.
- **Zeiteinträge:** Einsätze von Hand nachtragen, mit Datum.

## Was sie nicht macht

- Sie transkribiert nicht und schreibt keine Berichte. Das erledigt eine **separate, lokale** Pipeline auf einem eigenen Rechner (Whisper, lokales Sprachmodell). Sie ist nicht Teil dieses Repositorys.
- Sie schickt nichts an Dritte. Es gibt keine Cloud ausser der eigenen Nextcloud, kein Tracking und keine Werbung.
- Sie rechnet nicht ab und ersetzt keine Spitex-Fachanwendung.

## Datenschutz

Die Klientenliste steht **nicht** im Code. Die App lädt sie zur Laufzeit aus der eigenen Nextcloud. Zugangsdaten liegen verschlüsselt im SecureStore des Geräts.

Wer die App für Gesundheitsdaten nutzt, ist selbst verantwortlich für Server, Verschlüsselung, Berufsgeheimnis und Datenschutz.

## Installation

Expo / React Native.

```bash
npm install
npx expo start
```

APK bauen: siehe `BUILD_APK.bat` (EAS Build).

## Haftung

Ohne Gewähr, wie sie ist. Kein Medizinprodukt, keine Diagnose, keine Überwachung.

## Lizenz

Copyright (C) 2026 Jost Centeno Castro.

Freie Software unter der GNU Affero General Public License, Version 3 oder neuer (AGPL-3.0-or-later). Den vollständigen Text enthält die Datei `LICENSE`. Wer die Software verändert und anderen anbietet, auch als Webdienst, muss den veränderten Quellcode ebenfalls offenlegen.
