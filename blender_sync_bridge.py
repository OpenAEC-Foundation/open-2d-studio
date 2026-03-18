"""
Open 2D Studio → Blender Sync Bridge

Simpel Python script dat:
1. Draait als achtergrondproces
2. Pollt het IFC bestand voor wijzigingen
3. Wanneer het bestand wijzigt, laadt het in Blender via bpy

Start dit script IN Blender (Scripting → Open → Alt+P)
"""

import bpy
import os
import time

# === CONFIGURATIE ===
IFC_FILE = os.path.join(
    os.environ.get("APPDATA", ""),
    "com.open2dstudio.app",
    "bonsai_sync.ifc"
)

# Fallback paden
FALLBACK_PATHS = [
    IFC_FILE,
    r"C:\Users\rickd\Documents\GitHub\open-2d-studio\sync_model.ifc",
    os.path.join(os.environ.get("APPDATA", ""), "com.open2dstudio.app", "export.ifc"),
]

_last_mtime = 0.0
_reload_count = 0
_active_path = None

def _find_ifc_file():
    """Find the first existing IFC file from the list of paths."""
    for path in FALLBACK_PATHS:
        if os.path.isfile(path):
            return path
    return None

def _sync_check():
    """Timer callback: check if IFC file changed and reload in Bonsai."""
    global _last_mtime, _reload_count, _active_path

    # Find the IFC file
    path = _find_ifc_file()
    if not path:
        return 2.0  # Check again in 2 seconds

    if path != _active_path:
        _active_path = path
        _last_mtime = 0.0
        print(f"[Open2D Sync] Watching: {path}")

    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return 1.0

    if _last_mtime == 0.0:
        _last_mtime = mtime
        # Initial load
        _load_ifc(path)
        return 1.0

    if mtime > _last_mtime:
        _last_mtime = mtime
        _reload_count += 1
        print(f"[Open2D Sync] File changed! Reloading #{_reload_count}...")
        _load_ifc(path)

    return 1.0  # Check every second

def _load_ifc(path):
    """Load/reload IFC file in Bonsai."""
    global _reload_count

    if not hasattr(bpy.ops, "bim"):
        print("[Open2D Sync] ERROR: Bonsai add-on not installed!")
        return

    try:
        # Unload current project if one is loaded
        try:
            import blenderbim.tool as tool
            if tool.Ifc.get():
                bpy.ops.bim.unload_project()
        except:
            pass

        # Load the new IFC
        bpy.ops.bim.load_project(filepath=path)
        print(f"[Open2D Sync] Loaded: {path}")
    except Exception as e:
        print(f"[Open2D Sync] Load error: {e}")

# === START ===
# Unregister previous instance if running
if bpy.app.timers.is_registered(_sync_check):
    bpy.app.timers.unregister(_sync_check)
    print("[Open2D Sync] Stopped previous instance.")

bpy.app.timers.register(_sync_check, first_interval=2.0, persistent=True)
print("=" * 60)
print("[Open2D Sync] Started!")
print(f"[Open2D Sync] Looking for IFC files in:")
for p in FALLBACK_PATHS:
    exists = "EXISTS" if os.path.isfile(p) else "not found"
    print(f"  - {p} [{exists}]")
print("=" * 60)
