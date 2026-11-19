# Lokale Pipeline: vom Diktat zum Berichtsentwurf

Diese Pipeline verarbeitet Diktate und Notizen aus der ambulanten Pflege **auf dem eigenen Rechner**. Aufnahmen, Texte und Berichte gehen an keinen Dienst im Internet. Für Fachpersonen mit Berufsgeheimnis (in der Schweiz Art. 321 StGB) ist das der Zweck.

Sie ist eine bereinigte Neufassung der Pipeline aus meiner Praxis. Die Erfahrungen aus dem Betrieb stecken in den Kommentaren. Klientendaten, echte Kürzel und Beispielberichte enthält sie nicht.

## Ablauf

```
Handy (CHARTR) ──HTTPS/WebDAV──▶ eigene Nextcloud ──Synchronisation──▶ eigener Rechner

AUDIO_ROH/<Code>_<Datum>_<Von>_<Bis>.m4a ──transkribieren.py (Whisper, Code aus Dateiname)──▶ AUDIO_TRANSKRIPT/<Code>/<Code>_<Datum>_<Von>_<Bis>.txt
Browser, nur 127.0.0.1 ─────────schreibtisch.py─────────────▶ AUDIO_TRANSKRIPT/<Code>/<Code>_<Datum>_<Beginn>_<Minuten>min.txt
                                                                           │
                                  bericht_batch.py (LM Studio auf diesem Rechner, alle 30 Minuten)
                                                                           ▼
                                                  AUDIO_TRANSKRIPT/<Code>/BERICHTE/…_Bericht_lokal_….txt
                                                  Die Pflegefachperson liest, prüft und übernimmt.
```

| Datei | Aufgabe |
|---|---|
| `transkribieren.py` | Transkribiert neue Aufnahmen mit [faster-whisper](https://github.com/SYSTRAN/faster-whisper), legt sie anhand des Codes im Dateinamen im passenden Klienten-Ordner ab und löscht verarbeitete Aufnahmen nach der eingestellten Frist |
| `schreibtisch.py` | Eingabeseite im Browser für geschriebene statt diktierte Notizen |
| `bericht_batch.py` | Erzeugt Berichtsentwürfe, mit `--planung` Entwürfe für Pflegeplanungen |
| `gemeinsam.py` | Konfiguration, Klientenliste, Anfrage an LM Studio |
| `prompts/` | Die Anweisungen an das Sprachmodell, als Textdateien zum Anpassen |
| `windows/` | Startskripte für die Windows-Aufgabenplanung, fensterlos |

## Datenschutz: was der Code erzwingt

- **Nur dieser Rechner.** `lm_studio.url` muss auf `localhost`, `127.0.0.1` oder `::1` zeigen, sonst bricht jeder Lauf ab. Proxy-Einstellungen des Systems werden ignoriert.
- **Schreibtisch nur lokal.** Er lauscht nur auf `127.0.0.1`. Er weist fremde Hostnamen ab (Schutz vor DNS-Rebinding) und Formulare ohne geheimen Schlüssel (Schutz vor fremden Webseiten). Er erlaubt keine Einbettung und keine Zwischenspeicherung im Browser.
- **Codes statt Namen.** Ordner heissen nach einem Code (`XY1`). Die Zuordnung zum Kürzel steht in `klienten.json`, nicht im Code. Die Kürzel erscheinen weder auf dem Schreibtisch noch im Protokoll.
- **Unbekannter Code ergibt weder Transkript noch Bericht.** Es gibt keinen Ersatzwert.
- **Nichts erfinden.** Der Prompt verbietet Ergänzungen. Weil ein Prompt keine Garantie ist, heisst ein Entwurf, der deutlich länger ist als seine Quelle, `…_PRUEFEN.txt`.
- **Keine Bruchstücke.** Quellen unter 20 Zeichen bleiben liegen. Dateien werden erst vollständig geschrieben und dann umbenannt.
- **Nichts geht verloren.** Gleichnamige Aufnahmen überschreiben kein bestehendes Transkript. Es läuft immer nur eine Transkription gleichzeitig.
- **Speicherbegrenzung.** Verarbeitete Aufnahmen werden nach `audio_aufbewahrung_tage` gelöscht (Standard 14).
- **Protokolle ohne Inhalte.** `_STATISTIK/log.csv` und `transkription.log` enthalten Codes, Dateinamen, Zeiten und Zeichenzahlen. Das sind trotzdem Gesundheitsdaten im weiteren Sinn, denn sie zeigen, wann jemand betreut wurde. Behandeln Sie sie wie die Dokumentation.

## Was Sie selbst sicherstellen müssen

- **Festplattenverschlüsselung** auf dem Rechner, zum Beispiel BitLocker.
- **Die Nextcloud gehört Ihnen** oder einem Anbieter mit Vertrag zur Auftragsbearbeitung, und sie läuft über HTTPS. Aufnahmen und Transkripte liegen dort mit.
- **LM Studio:** In den Servereinstellungen «Im lokalen Netzwerk bereitstellen» **ausgeschaltet** lassen. LM Studio ist kein freies Programm. Prüfen Sie dessen Datenschutzbestimmungen und die Lizenz des Modells.
- **Einmaliger Download:** Beim ersten Start lädt faster-whisper das Modell von Hugging Face. Dabei wird keine Aufnahme übertragen. `windows/start_transkription.bat` verhindert danach jeden weiteren Kontakt (`HF_HUB_OFFLINE=1`).
- **Browser-Erweiterungen:** Der Schreibtisch läuft nur auf `127.0.0.1`, aber im normalen Browser. Erweiterungen für Rechtschreibung, Grammatik oder Übersetzung (zum Beispiel LanguageTool, Grammarly, DeepL) lesen Textfelder mit, und viele schicken den Text zur Prüfung an ihre Server. Das Schreibfeld trägt die Ausschluss-Attribute, doch kein Browser garantiert, dass sich jede Erweiterung daran hält. Schalten Sie solche Erweiterungen für `127.0.0.1` aus oder nutzen Sie ein eigenes Browserprofil ohne Erweiterungen. Die eingebaute Rechtschreibprüfung des Browsers arbeitet lokal und kann bleiben.
- **Datensicherungen** des Rechners enthalten Gesundheitsdaten. Sie gehören verschlüsselt und nicht in eine fremde Cloud.

## Installation (Windows)

1. Python 3.11 installieren, dann `pip install faster-whisper`.
2. [LM Studio](https://lmstudio.ai) installieren und ein Modell laden, zum Beispiel `qwen2.5-7b-instruct-1m` (genügsam, läuft auf den meisten Rechnern) oder, mit mehr Arbeitsspeicher, `qwen3-14b` (in meinem eigenen Betrieb seit 18.11.2026, 31 GB RAM, kein NVIDIA).
3. `config.example.json` nach `config.json` kopieren und die Pfade eintragen.
4. `klienten.example.json` an den in `config.json` genannten Ort kopieren, als `klienten.json`, und die eigenen Codes und Kürzel eintragen.
5. Einmal `python transkribieren.py` von Hand starten. Das Modell wird geladen. Danach mit Strg+C beenden.
6. In der Aufgabenplanung einrichten:
   - bei Anmeldung `windows\start_lm_studio.bat`
   - bei Anmeldung `windows\start_transkription.bat`
   - alle 30 Minuten `wscript.exe windows\run_hidden.vbs windows\lauf_berichte.bat`

## Vor jedem Hochladen

`config.json`, `klienten.json`, Aufnahmen, Transkripte, Berichte und Protokolle gehören nie in ein Repository. Die `.gitignore` schliesst sie aus, alle `.txt` ausser den Prompts eingeschlossen. Prüfen Sie trotzdem mit `git status`, was Sie hochladen.

## Grenzen

Die Pipeline schreibt **Entwürfe**. Sie ersetzt weder die fachliche Beurteilung noch die Pflegedokumentation, rechnet nicht ab und ist kein Medizinprodukt. Wer sie einsetzt, ist selbst verantwortlich für Datenschutz, Berufsgeheimnis und die Richtigkeit der Dokumentation.

Lizenz: AGPL-3.0-or-later, siehe `LICENSE` im Hauptordner.
