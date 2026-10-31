@echo off
REM Startet den LM-Studio-Server ohne Fenster und laedt das Modell.
REM Als geplante Aufgabe "bei Anmeldung" einrichten.
REM Den genauen Modellnamen zeigt "lms ls".
set LMS=%USERPROFILE%\.lmstudio\bin\lms.exe
set MODELL=qwen2.5-7b-instruct-1m
"%LMS%" server start
"%LMS%" ps 2>nul | findstr /B /L /C:"%MODELL% " >nul
if errorlevel 1 "%LMS%" load "%MODELL%"
