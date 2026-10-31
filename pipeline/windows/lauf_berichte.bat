@echo off
REM Ein Berichtslauf: Verlaufsberichte, dann Pflegeplanungen.
REM Als geplante Aufgabe alle 30 Minuten einrichten, fensterlos ueber run_hidden.vbs.
REM
REM Erfahrung: "lms load" auf ein bereits geladenes Modell laedt eine ZWEITE Kopie.
REM Bei halbstuendlichem Lauf fuellt das den Arbeitsspeicher. Deshalb nur laden,
REM wenn das Modell noch nicht geladen ist.
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
set LMS=%USERPROFILE%\.lmstudio\bin\lms.exe
set MODELL=qwen2.5-7b-instruct-1m
"%LMS%" ps 2>nul | findstr /B /L /C:"%MODELL% " >nul
if errorlevel 1 "%LMS%" load "%MODELL%"
python bericht_batch.py >> lauf_berichte.log 2>&1
python bericht_batch.py --planung >> lauf_berichte.log 2>&1
