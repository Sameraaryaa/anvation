"""
AEGIS-Graph Mock Server
Reference standalone implementation of the Section 4 Device API.
"""
import time
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

DEVICE_KEY = "aegis-demo-key-change-me"

state = {
    "state": "idle",
    "path_count": 0,
    "risk": 0,
    "scenario": "",
    "choke_point": None,
    "pending_fix": False,
    "seq": 1,
    "updated_at": int(time.time()),
}

pending_fix = None
cards = {"04A1B2C3": "Security Lead"}
recent_scans = []
commands = {}

class MockAegisHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Device-Key, X-Device-Id")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Device-Key, X-Device-Id")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        global state, pending_fix
        if self.path == "/api/health":
            self._send_json(200, {"ok": True, "ts": int(time.time()), "service": "aegis", "version": "1.0"})
        elif self.path == "/api/status":
            self._send_json(200, state)
        elif self.path == "/api/pending_fix":
            if not pending_fix:
                self._send_json(200, {"fix_id": None})
            else:
                self._send_json(200, pending_fix)
        else:
            self._send_json(404, {"error": "not_found"})

    def do_POST(self):
        global state, pending_fix, cards, recent_scans, commands
        key = self.headers.get("X-Device-Key", "")
        if key != DEVICE_KEY:
            self._send_json(401, {"error": "bad_device_key"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length)
        body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}

        if self.path == "/api/approve":
            card_id = body.get("card_id", "").replace(":", "").replace(" ", "").upper()
            fix_id = body.get("fix_id")
            device_id = body.get("device_id", "esp32-console-01")

            if not card_id or not fix_id:
                self._send_json(400, {"applied": False, "reason": "card_id_and_fix_id_required"})
                return

            if not pending_fix or not pending_fix.get("fix_id"):
                self._send_json(409, {"applied": False, "reason": "no_pending_fix"})
                return

            if pending_fix.get("fix_id") != fix_id:
                self._send_json(409, {"applied": False, "reason": "fix_mismatch", "pending_fix_id": pending_fix.get("fix_id")})
                return

            if card_id not in cards:
                recent_scans.insert(0, {"card_id": card_id, "device_id": device_id, "known": False, "name": None, "context": "approve_denied", "ts": int(time.time())})
                self._send_json(403, {"applied": False, "reason": "unknown_card", "card_id": card_id})
                return

            # Successful approval
            approver = cards[card_id]
            state["state"] = "safe"
            state["path_count"] = 0
            state["risk"] = pending_fix.get("risk_after", 12)
            state["pending_fix"] = False
            state["seq"] += 1
            state["updated_at"] = int(time.time())
            pending_fix = None

            self._send_json(200, {
                "applied": True,
                "approver": approver,
                "fix_id": fix_id,
                "state": "safe",
                "path_count": 0,
                "risk": state["risk"]
            })

        elif self.path == "/api/rfid/scan":
            card_id = body.get("card_id", "").replace(":", "").replace(" ", "").upper()
            device_id = body.get("device_id", "esp32-console-01")
            known = card_id in cards
            name = cards.get(card_id)
            recent_scans.insert(0, {
                "card_id": card_id,
                "device_id": device_id,
                "known": known,
                "name": name,
                "context": "scan",
                "ts": int(time.time())
            })
            self._send_json(200, {"known": known, "name": name, "card_id": card_id})

        elif self.path == "/api/device/heartbeat":
            device_id = body.get("device_id", "unknown")
            cmd = commands.pop(device_id, "none")
            self._send_json(200, {"ok": True, "command": cmd, "server_time": int(time.time())})

        else:
            self._send_json(404, {"error": "not_found"})

def run_server(port=8000):
    server = HTTPServer(("0.0.0.0", port), MockAegisHandler)
    print(f"Mock AEGIS Server running on http://0.0.0.0:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    run_server(args.port)
