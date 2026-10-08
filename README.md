# AEGIS-Graph
### Defensive Cloud Attack Path Analyzer · Hackathon Demo System
Built to integrate seamlessly with the physical ESP32 Approval Console and Arduino UNO Q Status Board.

---

## 1. Quick Start

### Backend (FastAPI on Port 8000)
```bash
cd backend
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env

# Start with launcher (displays LAN IP and device constants):
# Windows:
run.bat
# Linux/macOS:
chmod +x run.sh && ./run.sh
```

### Frontend (Development Mode)
```bash
cd frontend
npm install
npm run dev
# Browser: http://localhost:5173 (proxies /api to http://localhost:8000)
```

### Single-Port Production Demo (One Port for Judges: 8000)
```bash
cd frontend
npm run build
# FastAPI serves API and built dashboard on http://0.0.0.0:8000
```

### Hardware Simulator (No Physical Hardware Required)
```bash
python tools/device_simulator.py --api http://127.0.0.1:8000 --key aegis-demo-key-change-me
```
Interactive commands in simulator:
- `status` — check current state and pending fix
- `tap 04A1B2C3` — tap enrolled badge (approves pending fix)
- `tap DEADBEEF` — tap unknown badge (triggers 403 & denial audit)
- `loop` — continuous 2s polling and 10s heartbeats

---

## 2. Demo Day Instructions

### Start Order
1. **Host Laptop**: Turn on phone/router **2.4 GHz Wi-Fi hotspot** and connect the laptop.
2. **Launch Server**: Run `backend/run.bat` (or `backend/run.sh`). Note the printed `LAN_IP` (e.g. `192.168.43.57`).
3. **Power On Arduino UNO Q**: Boot status board. Once connected to the hotspot, it begins polling `http://<LAN_IP>:8000/api/status`. The matrix LED lights blue dots in idle pattern.
4. **Power On ESP32 Console**: Boot approval console. It joins Wi-Fi and TFT displays "AEGIS-Graph Ready · Waiting for analysis".
5. **Judges / Audience**: Open `http://<LAN_IP>:8000` from any laptop, tablet, or phone on the same hotspot.

### Windows Firewall Note
Ensure Windows Defender Firewall allows incoming connections on Private networks for Python:
- Settings &rarr; Windows Security &rarr; Firewall & network protection &rarr; Allow an app through firewall &rarr; Check **Private** for `python.exe`.

### Environment Configuration (`backend/.env`)
- `DB_MODE=local`: SQLite database stored in `aegis.db` (zero external dependencies, runs offline).
- `DB_MODE=cloud`: Google Cloud Firestore behind Repository interface.
- `AIR_GAPPED=1`: Bypasses external Gemini API calls and uses deterministic template answers.
- `ALLOW_BROWSER_APPROVAL=1`: Enables the "Simulate badge tap" dropdown on the Hardware page as a live demo fallback if hardware is disconnected.

---

## 3. Verification & Oracle Numbers

Unit tests assert the exact analytical outcomes specified in `docs/SOFTWARE_SPEC.md` Section 2:
- **EduCloud Scenario**:
  - Paths: 3 &rarr; 0
  - Risk: 88 &rarr; 12
  - Choke Point: `role_overpriv` (Over-privileged Role)
  - Smallest Fix: `scope_passrole` (removes edge `role_overpriv -> role_admin`)
  - Blast Radius: 7 nodes (22 weighted) &rarr; 4 nodes (4 weighted) (−82%)

Run all tests:
```bash
cd backend
python -m pytest -v
```
