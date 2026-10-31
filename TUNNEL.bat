@echo off
cd /d "%~dp0"
echo Installiere ngrok (einmalig)...
call npm install -g @expo/ngrok@^4.1.0 --legacy-peer-deps --quiet 2>nul
echo.
echo Starte Expo Tunnel-Modus...
echo Y | npx expo start --tunnel
pause
