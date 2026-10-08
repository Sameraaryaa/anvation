"""
AEGIS-Graph Device Simulator
Simulates esp32-console-01 and unoq-status-01 sending heartbeats and badge taps.
"""
import sys
import time
import argparse
import threading
import requests

def send_heartbeat(api_base, key, device_id, device_type, components, rssi=-50):
    url = f"{api_base.rstrip('/')}/api/device/heartbeat"
    headers = {
        "Content-Type": "application/json",
        "X-Device-Key": key,
        "X-Device-Id": device_id
    }
    payload = {
        "device_id": device_id,
        "device_type": device_type,
        "fw": "1.0.0",
        "ip": "192.168.1.150",
        "rssi": rssi,
        "uptime_s": 420,
        "components": components
    }
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=2.0)
        return r.status_code, r.json()
    except Exception as e:
        return 0, str(e)

def get_status(api_base):
    try:
        r = requests.get(f"{api_base.rstrip('/')}/api/status", timeout=2.0)
        return r.status_code, r.json()
    except Exception as e:
        return 0, str(e)

def get_pending_fix(api_base):
    try:
        r = requests.get(f"{api_base.rstrip('/')}/api/pending_fix", timeout=2.0)
        return r.status_code, r.json()
    except Exception as e:
        return 0, str(e)

def tap_badge(api_base, key, card_id, device_id="esp32-console-01"):
    # Check if there is a pending fix
    _, pfix = get_pending_fix(api_base)
    if isinstance(pfix, dict) and pfix.get("fix_id"):
        # Fix is pending: POST /api/approve
        url = f"{api_base.rstrip('/')}/api/approve"
        headers = {
            "Content-Type": "application/json",
            "X-Device-Key": key,
            "X-Device-Id": device_id
        }
        payload = {
            "fix_id": pfix["fix_id"],
            "card_id": card_id,
            "device_id": device_id
        }
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=2.0)
            return "approve", r.status_code, r.json()
        except Exception as e:
            return "approve", 0, str(e)
    else:
        # No fix pending: POST /api/rfid/scan
        url = f"{api_base.rstrip('/')}/api/rfid/scan"
        headers = {
            "Content-Type": "application/json",
            "X-Device-Key": key,
            "X-Device-Id": device_id
        }
        payload = {
            "card_id": card_id,
            "device_id": device_id
        }
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=2.0)
            return "scan", r.status_code, r.json()
        except Exception as e:
            return "scan", 0, str(e)

def main():
    parser = argparse.ArgumentParser(description="AEGIS Hardware Simulator")
    parser.add_argument("--api", default="http://127.0.0.1:8000", help="AEGIS API Base URL")
    parser.add_argument("--key", default="aegis-demo-key-change-me", help="Device key")
    parser.add_argument("--auto", action="store_true", help="Run background heartbeats automatically")
    args = parser.parse_args()

    api_base = args.api
    key = args.key

    esp32_comp = {"tft": "ok", "rfid": "ok", "rfid_version": "0x92", "wifi": "ok"}
    unoq_comp = {"led_matrix": "ok", "rgb_leds": "ok", "bridge": "ok"}

    print(f"AEGIS Device Simulator connected to {api_base}")
    print("Commands: status | tap <UID> | heartbeat | loop | exit")

    def run_heartbeats():
        s1, res1 = send_heartbeat(api_base, key, "esp32-console-01", "esp32_console", esp32_comp, -48)
        s2, res2 = send_heartbeat(api_base, key, "unoq-status-01", "unoq_status", unoq_comp, None)
        print(f"[Heartbeat] esp32-console-01 -> {s1} {res1.get('command') if isinstance(res1, dict) else res1}")
        print(f"[Heartbeat] unoq-status-01   -> {s2} {res2.get('command') if isinstance(res2, dict) else res2}")

    if args.auto:
        def background_loop():
            while True:
                send_heartbeat(api_base, key, "esp32-console-01", "esp32_console", esp32_comp, -48)
                send_heartbeat(api_base, key, "unoq-status-01", "unoq_status", unoq_comp, None)
                time.sleep(10)
        t = threading.Thread(target=background_loop, daemon=True)
        t.start()

    # Initial heartbeats to mark devices online
    run_heartbeats()

    while True:
        try:
            line = input("sim> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting simulator.")
            break

        if not line:
            continue
        parts = line.split()
        cmd = parts[0].lower()

        if cmd in ("exit", "quit", "q"):
            break
        elif cmd == "status":
            code, data = get_status(api_base)
            print(f"Status ({code}): {data}")
            p_code, p_data = get_pending_fix(api_base)
            print(f"Pending fix ({p_code}): {p_data}")
        elif cmd == "heartbeat":
            run_heartbeats()
        elif cmd == "tap":
            if len(parts) < 2:
                print("Usage: tap <CARD_UID> (e.g. tap 04A1B2C3 or tap DEADBEEF)")
                continue
            card_id = parts[1]
            act, code, res = tap_badge(api_base, key, card_id)
            print(f"Action: {act} | Response {code}: {res}")
        elif cmd == "loop":
            print("Entering continuous simulation loop. Press Ctrl+C to stop.")
            try:
                hb_timer = 0
                while True:
                    if hb_timer % 5 == 0:  # every 10s (5 * 2s)
                        run_heartbeats()
                    code, st = get_status(api_base)
                    print(f"[Poll] state={st.get('state')} paths={st.get('path_count')} risk={st.get('risk')} pending={st.get('pending_fix')}")
                    time.sleep(2)
                    hb_timer += 1
            except KeyboardInterrupt:
                print("\nStopped loop.")
        else:
            print(f"Unknown command: {cmd}. Commands: status | tap <UID> | heartbeat | loop | exit")

if __name__ == "__main__":
    main()
