@echo off
setlocal enabledelayedexpansion

echo ========================================================
echo               AEGIS-Graph Server Launcher               
echo ========================================================

REM Get local IP
for /f "tokens=*" %%a in ('powershell -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress"') do set LAN_IP=%%a

if "%LAN_IP%"=="" set LAN_IP=127.0.0.1

echo.
echo [1] Laptop LAN IP: %LAN_IP%
echo [2] Web Dashboard: http://%LAN_IP%:8000
echo.
echo === COPY THESE LINES INTO HARDWARE DEVICE FIRMWARE ===
echo ESP32 config.h:
echo   #define AEGIS_API_BASE "http://%LAN_IP%:8000"
echo   #define DEVICE_KEY     "aegis-demo-key-change-me"
echo.
echo UNO Q main.py:
echo   AEGIS_API_BASE = "http://%LAN_IP%:8000"
echo   DEVICE_KEY     = "aegis-demo-key-change-me"
echo ========================================================
echo.
echo Starting FastAPI server on 0.0.0.0:8000...
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
