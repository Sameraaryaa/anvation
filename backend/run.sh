#!/usr/bin/env bash

echo "========================================================"
echo "              AEGIS-Graph Server Launcher               "
echo "========================================================"

LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$LAN_IP" ]; then
    LAN_IP="127.0.0.1"
fi

echo ""
echo "[1] Laptop LAN IP: ${LAN_IP}"
echo "[2] Web Dashboard: http://${LAN_IP}:8000"
echo ""
echo "=== COPY THESE LINES INTO HARDWARE DEVICE FIRMWARE ==="
echo "ESP32 config.h:"
echo "  #define AEGIS_API_BASE \"http://${LAN_IP}:8000\""
echo "  #define DEVICE_KEY     \"aegis-demo-key-change-me\""
echo ""
echo "UNO Q main.py:"
echo "  AEGIS_API_BASE = \"http://${LAN_IP}:8000\""
echo "  DEVICE_KEY     = \"aegis-demo-key-change-me\""
echo "========================================================"
echo ""
echo "Starting FastAPI server on 0.0.0.0:8000..."
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
