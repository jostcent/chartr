@echo off
REM Startet die Transkription FENSTERLOS und beendet sich sofort.
REM Ein sichtbares Konsolenfenster stirbt, sobald jemand es schliesst; pythonw.exe hat keines.
REM Als geplante Aufgabe "bei Anmeldung" einrichten.
REM
REM HF_HUB_OFFLINE=1: kein Kontakt zu Hugging Face. Das Modell muss deshalb einmal vorher
REM geladen sein: beim ersten Mal "python transkribieren.py" von Hand starten.
cd /d "%~dp0.."
set HF_HUB_OFFLINE=1
start "" pythonw.exe transkribieren.py
