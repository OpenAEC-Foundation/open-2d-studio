bl_info = {
    "name": "Open 2D Studio Live Sync",
    "author": "OpenAEC Foundation",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > Open2D",
    "description": "Live IFC sync with Open 2D Studio via WebSocket or file watching",
    "category": "Import-Export",
}

import bpy
import os
import sys
import json
import tempfile
import threading
import time
from bpy.props import StringProperty, BoolProperty, IntProperty, EnumProperty

# =============================================================================
# Global state
# =============================================================================

_ws_thread = None
_ws_client = None
_should_run = False
_connected = False
_reload_count = 0
_pending_ifc = None
_pending_lock = threading.Lock()
_last_mtime = 0.0
_file_watch_active = False

TEMP_IFC = os.path.join(tempfile.gettempdir(), "open2d_bonsai_sync.ifc")

# =============================================================================
# WebSocket client
# =============================================================================

def _ensure_websocket():
    try:
        import websocket
        return True
    except ImportError:
        try:
            import subprocess
            subprocess.check_call(
                [sys.executable, '-m', 'pip', 'install', 'websocket-client'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
            return True
        except:
            return False

def _ws_loop():
    global _ws_client, _should_run, _pending_ifc, _connected
    import websocket

    props = bpy.context.scene.open2d_sync
    url = f"ws://localhost:{props.ws_port}"

    while _should_run:
        try:
            print(f"[Open2D] Connecting to {url}...")
            ws = websocket.WebSocket()
            ws.connect(url, timeout=5)
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

                    if msg.get("type") == "ifc_update":
                        content = msg.get("content", "")
                        if content:
                            with _pending_lock:
                                _pending_ifc = content
                            print(f"[Open2D] IFC received ({len(content)} bytes)")

                    elif msg.get("type") == "connected":
                        print(f"[Open2D] {msg.get('message', 'Connected')}")

                except websocket.WebSocketTimeoutException:
                    continue
                except websocket.WebSocketConnectionClosedException:
                    break
                except Exception as e:
                    print(f"[Open2D] Error: {e}")
                    break
        except Exception as e:
            if _should_run:
                print(f"[Open2D] Connection failed: {e}")

        _connected = False
        _ws_client = None
        if _should_run:
            time.sleep(3)

# =============================================================================
# File watcher (fallback)
# =============================================================================

def _file_watch_check():
    global _last_mtime, _pending_ifc, _file_watch_active

    if not _file_watch_active:
        return None  # Unregister

    props = bpy.context.scene.open2d_sync
    path = props.ifc_file_path

    if not path or not os.path.isfile(path):
        return 1.0

    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return 1.0

    if _last_mtime == 0.0:
        _last_mtime = mtime
        return 1.0

    if mtime > _last_mtime:
        _last_mtime = mtime
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            with _pending_lock:
                _pending_ifc = content
            print(f"[Open2D] File changed, loading...")
        except Exception as e:
            print(f"[Open2D] Read error: {e}")

    return 1.0

# =============================================================================
# Reload timer (runs on main thread)
# =============================================================================

def _reload_timer():
    global _pending_ifc, _reload_count

    content = None
    with _pending_lock:
        if _pending_ifc:
            content = _pending_ifc
            _pending_ifc = None

    if content:
        try:
            with open(TEMP_IFC, 'w', encoding='utf-8') as f:
                f.write(content)

            _reload_count += 1
            print(f"[Open2D] Loading IFC #{_reload_count}...")

            if hasattr(bpy.ops, "bim"):
                try:
                    import blenderbim.tool as tool
                    if tool.Ifc.get():
                        try:
                            bpy.ops.bim.unload_project()
                        except:
                            pass
                except:
                    pass

                bpy.ops.bim.load_project(filepath=TEMP_IFC)
                print(f"[Open2D] Loaded!")
            else:
                print("[Open2D] Bonsai add-on not found!")

        except Exception as e:
            print(f"[Open2D] Load error: {e}")

    if not _should_run and not _file_watch_active:
        return None
    return 0.5

# =============================================================================
# Properties
# =============================================================================

class Open2DSyncProperties(bpy.types.PropertyGroup):
    mode: EnumProperty(
        name="Mode",
        items=[
            ('WEBSOCKET', 'WebSocket', 'Direct connection to Open 2D Studio'),
            ('FILE', 'File Watch', 'Watch an IFC file for changes'),
        ],
        default='WEBSOCKET'
    )
    ws_port: IntProperty(name="Port", default=9876, min=1024, max=65535)
    ifc_file_path: StringProperty(name="IFC File", subtype='FILE_PATH', default="")
    is_running: BoolProperty(name="Running", default=False)

# =============================================================================
# Operators
# =============================================================================

class OPEN2D_OT_start_sync(bpy.types.Operator):
    bl_idname = "open2d.start_sync"
    bl_label = "Start Sync"
    bl_description = "Start live sync with Open 2D Studio"

    def execute(self, context):
        global _should_run, _ws_thread, _file_watch_active, _last_mtime

        props = context.scene.open2d_sync

        if props.is_running:
            self.report({'WARNING'}, "Already running")
            return {'CANCELLED'}

        _should_run = True
        props.is_running = True

        # Start reload timer
        if not bpy.app.timers.is_registered(_reload_timer):
            bpy.app.timers.register(_reload_timer, first_interval=1.0, persistent=True)

        if props.mode == 'WEBSOCKET':
            if not _ensure_websocket():
                self.report({'ERROR'}, "websocket-client not available. Install: pip install websocket-client")
                _should_run = False
                props.is_running = False
                return {'CANCELLED'}

            _ws_thread = threading.Thread(target=_ws_loop, daemon=True)
            _ws_thread.start()
            self.report({'INFO'}, f"WebSocket sync started on port {props.ws_port}")

        elif props.mode == 'FILE':
            if not props.ifc_file_path:
                self.report({'ERROR'}, "Set an IFC file path first")
                _should_run = False
                props.is_running = False
                return {'CANCELLED'}

            _last_mtime = 0.0
            _file_watch_active = True
            if not bpy.app.timers.is_registered(_file_watch_check):
                bpy.app.timers.register(_file_watch_check, first_interval=1.0, persistent=True)
            self.report({'INFO'}, f"File watch started: {props.ifc_file_path}")

        return {'FINISHED'}


class OPEN2D_OT_stop_sync(bpy.types.Operator):
    bl_idname = "open2d.stop_sync"
    bl_label = "Stop Sync"
    bl_description = "Stop live sync"

    def execute(self, context):
        global _should_run, _ws_client, _file_watch_active, _connected

        _should_run = False
        _file_watch_active = False
        _connected = False

        if _ws_client:
            try:
                _ws_client.close()
            except:
                pass

        context.scene.open2d_sync.is_running = False
        self.report({'INFO'}, "Sync stopped")
        return {'FINISHED'}


class OPEN2D_OT_load_ifc(bpy.types.Operator):
    bl_idname = "open2d.load_ifc"
    bl_label = "Load IFC Now"
    bl_description = "Manually load an IFC file in Bonsai"

    filepath: StringProperty(subtype='FILE_PATH')

    def execute(self, context):
        if not self.filepath:
            props = context.scene.open2d_sync
            self.filepath = props.ifc_file_path

        if not self.filepath or not os.path.isfile(self.filepath):
            self.report({'ERROR'}, "File not found")
            return {'CANCELLED'}

        if hasattr(bpy.ops, "bim"):
            try:
                import blenderbim.tool as tool
                if tool.Ifc.get():
                    bpy.ops.bim.unload_project()
            except:
                pass
            bpy.ops.bim.load_project(filepath=self.filepath)
            self.report({'INFO'}, f"Loaded: {self.filepath}")
        else:
            self.report({'ERROR'}, "Bonsai add-on not installed")

        return {'FINISHED'}

# =============================================================================
# Panel
# =============================================================================

class OPEN2D_PT_sync_panel(bpy.types.Panel):
    bl_label = "Open 2D Studio"
    bl_idname = "OPEN2D_PT_sync_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Open2D'

    def draw(self, context):
        layout = self.layout
        props = context.scene.open2d_sync

        # Mode selector
        layout.prop(props, "mode", text="Mode")

        if props.mode == 'WEBSOCKET':
            row = layout.row()
            row.prop(props, "ws_port")
            row.enabled = not props.is_running

            # Status
            box = layout.box()
            if _connected:
                box.label(text="● Connected", icon='LINKED')
            elif props.is_running:
                box.label(text="○ Connecting...", icon='TIME')
            else:
                box.label(text="○ Disconnected", icon='UNLINKED')

        elif props.mode == 'FILE':
            row = layout.row()
            row.prop(props, "ifc_file_path", text="")
            row.enabled = not props.is_running

        # Reload count
        if _reload_count > 0:
            layout.label(text=f"Reloads: {_reload_count}")

        # Start/Stop
        if props.is_running:
            layout.operator("open2d.stop_sync", text="Stop Sync", icon='PAUSE')
        else:
            layout.operator("open2d.start_sync", text="Start Sync", icon='PLAY')

        layout.separator()
        layout.operator("open2d.load_ifc", text="Load IFC File", icon='IMPORT')

# =============================================================================
# Registration
# =============================================================================

classes = (
    Open2DSyncProperties,
    OPEN2D_OT_start_sync,
    OPEN2D_OT_stop_sync,
    OPEN2D_OT_load_ifc,
    OPEN2D_PT_sync_panel,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.open2d_sync = bpy.props.PointerProperty(type=Open2DSyncProperties)
    print("[Open2D] Add-on registered")

def unregister():
    global _should_run, _file_watch_active
    _should_run = False
    _file_watch_active = False

    if hasattr(bpy.types.Scene, 'open2d_sync'):
        del bpy.types.Scene.open2d_sync

    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    print("[Open2D] Add-on unregistered")

if __name__ == "__main__":
    register()
