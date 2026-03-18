#!/usr/bin/env python3
"""
Blender MCP Bridge Server

Bridges between Claude Code (MCP stdio protocol) and Blender's MCP socket server.
Exposes Blender operations as MCP tools.
"""

import sys
import json
import socket
import os

BLENDER_HOST = "localhost"
BLENDER_PORT = 9876

def send_to_blender(command: dict) -> dict:
    """Send a command to Blender's MCP socket server and get the response."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(30)
        s.connect((BLENDER_HOST, BLENDER_PORT))
        s.sendall(json.dumps(command).encode('utf-8'))

        # Receive response
        chunks = []
        while True:
            try:
                chunk = s.recv(65536)
                if not chunk:
                    break
                chunks.append(chunk)
                # Try to parse - if valid JSON, we're done
                try:
                    json.loads(b''.join(chunks))
                    break
                except json.JSONDecodeError:
                    continue
            except socket.timeout:
                break
        s.close()

        data = b''.join(chunks)
        if data:
            return json.loads(data)
        return {"status": "error", "message": "No response from Blender"}
    except ConnectionRefusedError:
        return {"status": "error", "message": "Blender MCP server not running. Start Blender and enable the MCP addon."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def handle_initialize(msg_id):
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "blender-bridge", "version": "1.0.0"}
        }
    }

def handle_tools_list(msg_id):
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "result": {
            "tools": [
                {
                    "name": "blender_execute",
                    "description": "Execute Python code in Blender. Use bpy module. Returns the result.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "code": {"type": "string", "description": "Python code to execute in Blender"}
                        },
                        "required": ["code"]
                    }
                },
                {
                    "name": "blender_load_ifc",
                    "description": "Load an IFC file in Blender via Bonsai add-on",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "filepath": {"type": "string", "description": "Path to the IFC file"}
                        },
                        "required": ["filepath"]
                    }
                },
                {
                    "name": "blender_get_scene_info",
                    "description": "Get information about the current Blender scene (objects, materials, etc.)",
                    "inputSchema": {
                        "type": "object",
                        "properties": {}
                    }
                }
            ]
        }
    }

def handle_tool_call(msg_id, tool_name, arguments):
    if tool_name == "blender_execute":
        code = arguments.get("code", "")
        result = send_to_blender({"type": "execute_code", "params": {"code": code}})
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result, indent=2)}]
            }
        }

    elif tool_name == "blender_load_ifc":
        filepath = arguments.get("filepath", "").replace("\\", "\\\\")
        code = f"""
import bpy
filepath = r"{arguments.get('filepath', '')}"
if hasattr(bpy.ops, 'bim'):
    try:
        import blenderbim.tool as tool
        if tool.Ifc.get():
            bpy.ops.bim.unload_project()
    except:
        pass
    bpy.ops.bim.load_project(filepath=filepath)
    result = f"Loaded: {{filepath}}"
else:
    result = "Bonsai add-on not installed"
"""
        result = send_to_blender({"type": "execute_code", "params": {"code": code}})
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result, indent=2)}]
            }
        }

    elif tool_name == "blender_get_scene_info":
        code = """
import bpy
objects = [{"name": o.name, "type": o.type} for o in bpy.data.objects[:50]]
result = f"Scene: {bpy.context.scene.name}, Objects: {len(bpy.data.objects)}, Details: {objects}"
"""
        result = send_to_blender({"type": "execute_code", "params": {"code": code}})
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps(result, indent=2)}]
            }
        }

    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}
    }

def main():
    """Main MCP stdio loop."""
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break

            line = line.strip()
            if not line:
                continue

            msg = json.loads(line)
            method = msg.get("method", "")
            msg_id = msg.get("id")

            if method == "initialize":
                response = handle_initialize(msg_id)
            elif method == "notifications/initialized":
                continue  # No response needed
            elif method == "tools/list":
                response = handle_tools_list(msg_id)
            elif method == "tools/call":
                params = msg.get("params", {})
                response = handle_tool_call(msg_id, params.get("name"), params.get("arguments", {}))
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "error": {"code": -32601, "message": f"Unknown method: {method}"}
                }

            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()

        except json.JSONDecodeError:
            continue
        except Exception as e:
            sys.stderr.write(f"Error: {e}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
