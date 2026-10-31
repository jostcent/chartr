@echo off
cd /d "%~dp0"
echo ===========================
echo   Chartr App starten
echo ===========================
echo.
echo Installiere Expo (Schritt 1/2)...
call npm install expo@~54.0.0 --legacy-peer-deps
if %errorlevel% neq 0 (
  echo FEHLER bei npm install!
  pause
  exit /b
)
echo Installiere alle weiteren Pakete (Schritt 2/2)...
call npx expo install expo-av expo-file-system expo-status-bar expo-secure-store react react-native @react-navigation/native @react-navigation/bottom-tabs react-native-safe-area-context react-native-screens -- --legacy-peer-deps
if %errorlevel% neq 0 (
  echo FEHLER bei expo install!
  pause
  exit /b
)
echo.
echo Starte Expo - Fenster OFFEN lassen!
echo QR-Code mit Expo Go scannen.
echo.
npx expo start
echo.
echo === Expo beendet ===
pause
