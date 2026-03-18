# =============================================================================
# Open 2D Studio — Bonsai Live Sync (WebSocket Client)
# =============================================================================
#
# This script connects to Open 2D Studio's WebSocket server and receives
# IFC model updates in real-time.
#
# REQUIREMENTS:
#   pip install websocket-client
#
# HOW TO USE:
#   1. Open Blender with the Bonsai add-on enabled
#   2. Paste this script in Scripting workspace → Alt+P
#   3. The script connects to ws://localhost:9876
#   4. IFC updates are received and loaded in Bonsai automatically
#
# =============================================================================

import bpy
import os
import sys
import json
import tempfile
import threading
import time

WS_HOST = "localhost"
WS_PORT = 9876
WS_URL = f"ws://{WS_HOST}:{WS_PORT}"
RECONNECT_DELAY = 3.0
TEMP_IFC_PATH = os.path.join(tempfile.gettempdir(), "open2d_bonsai_sync.ifc")

_ws_client = None
_ws_thread = None
_should_run = True
_reload_count = 0
_pending_ifc_content = None
_pending_lock = threading.Lock()
_connected = False

def _ensure_websocket_installed():
    try:
        import websocket
        return True
    except ImportError:
        print("[Open2D] Installing websocket-client...")
        import subprocess
        try:
            subprocess.check_call(
                [sys.executable, '-m', 'pip', 'install', 'websocket-client'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            print("[Open2D] websocket-client installed.")
            return True
        except Exception as e:
            print(f"[Open2D] Install failed: {e}")
            return False

def _ws_thread_func():
    global _ws_client, _should_run, _pending_ifc_content, _connected
    import websocket

    while _should_run:
        try:
            print(f"[Open2D] Connecting to {WS_URL}...")
            ws = websocket.WebSocket()
            ws.connect(WS_URL, timeout=5)
            _ws_client = ws
            _connected = True
            print(f"[Open2D] Connected!")

            while _should_run:
                try:
                    ws.settimeout(1.0)
                    data = ws.recv()
                    if not data:
                        continue
                    msg = json.loads(data)
                    msg_type = msg.get("type", "")

                    if msg_type == "connected":
                        print(f"[Open2D] Server: {msg.get('message', '')}")
                    elif msg_type == "ifc_update":
                        ifc_content = msg.get("content", "")
                        if ifc_content:
                            with _pending_lock:
                                global _pending_ifc_content
                                _pending_ifc_content = ifc_content
                            print(f"[Open2D] IFC update received ({len(ifc_content)} bytes)")
                    elif msg_type == "pong":
                        pass
                except websocket.WebSocketTimeoutException:
                    continue
                except websocket.WebSocketConnectionClosedException:
                    print("[Open2D] Connection closed.")
                    break
                except Exception as e:
                    print(f"[Open2D] Error: {e}")
                    break

        except Exception as e:
            print(f"[Open2D] Connection failed: {e}")

        _connected = False
        _ws_client = None
        if _should_run:
            print(f"[Open2D] Reconnecting in {RECONNECT_DELAY}s...")
            time.sleep(RECONNECT_DELAY)

def _check_pending_reload():
    global _pending_ifc_content, _reload_count
    content = None
    with _pending_lock:
        if _pending_ifc_content:
            content = _pending_ifc_content
            _pending_ifc_content = None

    if content:
        try:
            with open(TEMP_IFC_PATH, 'w', encoding='utf-8') as f:
                f.write(content)

            _reload_count += 1
            print(f"[Open2D] Reloading IFC in Bonsai (#{_reload_count})...")

            if not hasattr(bpy.ops, "bim"):
                print("[Open2D] Bonsai not installed!")
                return 0.5

            try:
                import blenderbim.tool as tool
                ifc_file = tool.Ifc.get()
                if ifc_file:
                    try:
                        bpy.ops.bim.unload_project()
                    except:
                        pass
            except:
                pass

            bpy.ops.bim.load_project(filepath=TEMP_IFC_PATH)
            print(f"[Open2D] Reload complete.")
        except Exception as e:
            print(f"[Open2D] Reload error: {e}")

    return 0.5  # Check every 500ms

def open2d_ws_stop():
    global _should_run, _ws_client, _ws_thread
    _should_run = False
    if _ws_client:
        try:
            _ws_client.close()
        except:
            pass
    if bpy.app.timers.is_registered(_check_pending_reload):
        bpy.app.timers.unregister(_check_pending_reload)
    print("[Open2D] Stopped.")

def open2d_ws_status():
    print(f"[Open2D] Connected: {_connected}")
    print(f"[Open2D] Reloads: {_reload_count}")
    print(f"[Open2D] URL: {WS_URL}")

# --- Start ---
if not _ensure_websocket_installed():
    raise RuntimeError("websocket-client not available")

# Stop previous instance
if bpy.app.timers.is_registered(_check_pending_reload):
    bpy.app.timers.unregister(_check_pending_reload)

_should_run = True
_ws_thread = threading.Thread(target=_ws_thread_func, daemon=True)
_ws_thread.start()

bpy.app.timers.register(_check_pending_reload, first_interval=1.0, persistent=True)
print(f"[Open2D] WebSocket client started. Target: {WS_URL}")
print(f"[Open2D] Temp IFC: {TEMP_IFC_PATH}")
