/**
 * Blender/Bonsai WebSocket Client Script Generator
 *
 * Generates a Python script that can be run inside Blender to connect
 * to Open 2D Studio's WebSocket server and receive IFC updates in real-time.
 *
 * The script connects to the local WebSocket server, receives IFC data
 * when the model changes, writes it to a temp file, and reloads it in Bonsai.
 * No file polling needed — updates are pushed instantly.
 */

/**
 * Generate a Blender Python WebSocket client script.
 *
 * @param wsPort - The WebSocket server port (default 9876)
 * @returns The complete Python script as a string
 */
export function generateBlenderWatcherScript(
  wsPort: number = 9877
): string {
  return `# =============================================================================
# Open 2D Studio — Bonsai Live Sync (WebSocket Client)
# =============================================================================
#
# This script connects to Open 2D Studio's WebSocket server and receives
# IFC model updates in real-time. When the model changes, the IFC data is
# pushed directly to Blender — no file polling needed.
#
# REQUIREMENTS:
#   pip install websocket-client
#   (Run in Blender's Python: import subprocess; subprocess.check_call(
#       [sys.executable, '-m', 'pip', 'install', 'websocket-client']))
#
# HOW TO USE:
#   1. Open Blender with the Bonsai add-on enabled
#   2. Open the Scripting workspace (or any Text Editor area)
#   3. Click "New" to create a new text block, paste this script
#   4. Click "Run Script" (or press Alt+P)
#   5. The script will connect to Open 2D Studio on ws://localhost:${wsPort}
#   6. IFC updates will be received and loaded automatically in Bonsai
#
# TO STOP:
#   Run this in Blender's Python console:
#     open2d_ws_stop()
#
# =============================================================================

import bpy
import os
import sys
import json
import tempfile
import threading
import time

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WS_HOST = "localhost"
WS_PORT = ${wsPort}
WS_URL = f"ws://{WS_HOST}:{WS_PORT}"
RECONNECT_DELAY = 3.0  # seconds between reconnection attempts
TEMP_IFC_PATH = os.path.join(tempfile.gettempdir(), "open2d_bonsai_sync.ifc")

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

_ws_client = None
_ws_thread = None
_should_run = True
_reload_count = 0
_pending_ifc_content = None
_pending_lock = threading.Lock()
_connected = False

# ---------------------------------------------------------------------------
# Install websocket-client if needed
# ---------------------------------------------------------------------------

def _ensure_websocket_installed():
    """Install websocket-client if not available."""
    try:
        import websocket
        return True
    except ImportError:
        print("[Open2D Bonsai Sync] Installing websocket-client...")
        import subprocess
        try:
            subprocess.check_call(
                [sys.executable, '-m', 'pip', 'install', 'websocket-client'],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            print("[Open2D Bonsai Sync] websocket-client installed successfully.")
            return True
        except Exception as e:
            print(f"[Open2D Bonsai Sync] Failed to install websocket-client: {e}")
            print("[Open2D Bonsai Sync] Please install manually:")
            print(f"  {sys.executable} -m pip install websocket-client")
            return False

# ---------------------------------------------------------------------------
# WebSocket client (runs in background thread)
# ---------------------------------------------------------------------------

def _ws_thread_func():
    """Background thread: connect to WebSocket server and receive IFC updates."""
    global _ws_client, _should_run, _pending_ifc_content, _connected

    import websocket

    while _should_run:
        try:
            print(f"[Open2D Bonsai Sync] Connecting to {WS_URL}...")
            ws = websocket.WebSocket()
            ws.connect(WS_URL, timeout=5)
            _ws_client = ws
            _connected = True
            print(f"[Open2D Bonsai Sync] Connected to {WS_URL}")

            while _should_run:
                try:
                    ws.settimeout(1.0)
                    data = ws.recv()
                    if not data:
                        continue

                    msg = json.loads(data)
                    msg_type = msg.get("type", "")

                    if msg_type == "connected":
                        print(f"[Open2D Bonsai Sync] Server: {msg.get('message', '')}")

                    elif msg_type == "ifc_update":
                        ifc_content = msg.get("content", "")
                        if ifc_content:
                            with _pending_lock:
                                _pending_ifc_content = ifc_content
                            print(f"[Open2D Bonsai Sync] Received IFC update ({len(ifc_content)} bytes)")

                    elif msg_type == "pong":
                        pass  # heartbeat response

                except websocket.WebSocketTimeoutException:
                    continue
                except websocket.WebSocketConnectionClosedException:
                    print("[Open2D Bonsai Sync] Connection closed by server.")
                    break
                except Exception as e:
                    print(f"[Open2D Bonsai Sync] Receive error: {e}")
                    break

        except Exception as e:
            print(f"[Open2D Bonsai Sync] Connection failed: {e}")

        _connected = False
        _ws_client = None

        if _should_run:
            print(f"[Open2D Bonsai Sync] Reconnecting in {RECONNECT_DELAY}s...")
            time.sleep(RECONNECT_DELAY)

    _connected = False
    print("[Open2D Bonsai Sync] WebSocket thread stopped.")

# ---------------------------------------------------------------------------
# Blender timer: check for pending IFC updates (runs on main thread)
# ---------------------------------------------------------------------------

def _open2d_ws_timer():
    """Blender timer callback: process pending IFC updates on the main thread."""
    global _pending_ifc_content, _reload_count

    content = None
    with _pending_lock:
        if _pending_ifc_content is not None:
            content = _pending_ifc_content
            _pending_ifc_content = None

    if content is not None:
        _reload_count += 1
        print(f"[Open2D Bonsai Sync] Loading IFC update #{_reload_count}...")
        try:
            # Write IFC content to temp file
            with open(TEMP_IFC_PATH, 'w', encoding='utf-8') as f:
                f.write(content)

            # Reload in Bonsai
            _reload_ifc(TEMP_IFC_PATH)
            print(f"[Open2D Bonsai Sync] Reload #{_reload_count} complete.")
        except Exception as e:
            print(f"[Open2D Bonsai Sync] Reload error: {e}")

    if _should_run:
        return 0.25  # check 4 times per second
    return None  # unregister timer

# ---------------------------------------------------------------------------
# IFC reload logic
# ---------------------------------------------------------------------------

def _reload_ifc(filepath):
    """Reload the IFC file in Bonsai."""
    if not hasattr(bpy.ops, "bim"):
        raise RuntimeError("Bonsai/BlenderBIM add-on is not installed or enabled")

    # Check if a project is already loaded
    ifc_file = None
    try:
        import blenderbim.tool as tool
        ifc_file = tool.Ifc.get()
    except Exception:
        pass

    if ifc_file is None:
        # No project loaded yet — do a fresh load
        bpy.ops.bim.load_project(filepath=filepath)
    else:
        # Project already loaded — close and re-open
        try:
            bpy.ops.bim.unload_project()
        except Exception:
            pass
        bpy.ops.bim.load_project(filepath=filepath)

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def open2d_ws_stop():
    """Stop the WebSocket client and timer."""
    global _should_run, _ws_client, _connected
    _should_run = False
    _connected = False
    if _ws_client:
        try:
            _ws_client.close()
        except Exception:
            pass
        _ws_client = None
    # Timer will self-unregister when _should_run is False
    print("[Open2D Bonsai Sync] Stopped.")

def open2d_ws_status():
    """Print connection status."""
    status = "Connected" if _connected else "Disconnected"
    print(f"[Open2D Bonsai Sync] Status: {status}")
    print(f"[Open2D Bonsai Sync] Server: {WS_URL}")
    print(f"[Open2D Bonsai Sync] Reloads: {_reload_count}")
    print(f"[Open2D Bonsai Sync] Temp file: {TEMP_IFC_PATH}")

# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

def _start():
    """Start the WebSocket client."""
    global _should_run, _ws_thread

    if not _ensure_websocket_installed():
        return

    _should_run = True

    # Start background WebSocket thread
    _ws_thread = threading.Thread(target=_ws_thread_func, daemon=True)
    _ws_thread.start()

    # Register Blender timer to process IFC updates on main thread
    if bpy.app.timers.is_registered(_open2d_ws_timer):
        bpy.app.timers.unregister(_open2d_ws_timer)
    bpy.app.timers.register(_open2d_ws_timer, first_interval=0.5, persistent=True)

    print("[Open2D Bonsai Sync] WebSocket client started.")
    print(f"[Open2D Bonsai Sync] Connecting to {WS_URL}")
    print("[Open2D Bonsai Sync] To stop: open2d_ws_stop()")
    print("[Open2D Bonsai Sync] To check status: open2d_ws_status()")

# Start!
_start()
`;
}
