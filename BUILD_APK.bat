@echo off
cd /d "%~dp0"
echo ================================
echo   Chartr APK Build (EAS Cloud)
echo ================================
echo.

REM ---------------------------------------------------------------------
REM Schritt 0 gab es frueher nicht und hat am 07.09.2026 einen Build
REM verhindert: ohne node_modules kann die EAS-CLI das Plugin aus app.json
REM (expo-secure-store) nicht aufloesen und bricht ab, BEVOR irgendetwas in
REM die Cloud geht. Fehlermeldung: "Failed to resolve plugin for module".
REM ---------------------------------------------------------------------
if not exist "node_modules\" (
  echo Schritt 0: node_modules fehlen - werden einmalig installiert...
  call npm install --legacy-peer-deps
  echo.
)

echo Schritt 1: EAS CLI installieren...
call npm install -g eas-cli --legacy-peer-deps --quiet
echo.

echo Schritt 2: Expo-Login (nursedev2026)...
echo Bitte Passwort eingeben wenn gefragt.
call eas login
echo.

REM ---------------------------------------------------------------------
REM Schritt 3: EAS baut aus dem GIT-COMMIT, nicht aus dem Arbeitsordner.
REM Frueher stand hier nur "git add assets\ app.json" - Aenderungen an
REM screens\ blieben dadurch aussen vor, und der Build erzeugte stillschweigend
REM wieder die alte App. Genau das drohte am 07.09.2026: der Kalender war
REM geschrieben, aber nicht committet. Darum jetzt: alles einchecken.
REM ---------------------------------------------------------------------
echo Schritt 3: Aenderungen einchecken...
if exist ".git\index.lock" del /f ".git\index.lock"
git add -A
git diff --cached --quiet
if errorlevel 1 (
  echo Folgende Dateien gehen in den Build:
  git diff --cached --name-only
  git commit -m "Build vom %date%"
  echo.
) else (
  echo (keine Aenderungen - es wird der letzte Commit gebaut^)
  echo.
)
echo Letzter Commit:
git log -1 --format="   %%h  %%ad  %%s" --date=format:"%%d.%%m.%%Y %%H:%%M"
echo.

echo Schritt 4: Build starten (laeuft in der Cloud, ca. 20 Min^)...
call eas build -p android --profile preview
echo.
echo Build gestartet. Die APK erscheint danach unter:
echo   https://expo.dev/accounts/nursedev2026/projects/chartr/builds
echo.
echo Am einfachsten: diese Seite auf dem HANDY oeffnen, obersten Build
echo antippen, "Install" - dann braucht es kein Kabel.
echo.
echo Status pruefen geht auch hier:
echo   eas build:list --platform android --limit 3
pause
