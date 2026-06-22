import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
ALLOWED_FILES = {
    "README.md": ROOT / "README.md",
    ".env.example": ROOT / ".env.example",
}


def read_message() -> dict[str, Any] | None:
    header = b""
    while b"\r\n\r\n" not in header:
        chunk = sys.stdin.buffer.read(1)
        if not chunk:
            return None
        header += chunk

    length = 0
    for line in header.decode("ascii").split("\r\n"):
        if line.lower().startswith("content-length:"):
            length = int(line.split(":", 1)[1].strip())
            break
    if not length:
        raise ValueError("Missing Content-Length header")

    body = sys.stdin.buffer.read(length)
    return json.loads(body.decode("utf-8"))


def write_message(payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii"))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def tool_list() -> list[dict[str, Any]]:
    return [
        {
            "name": "read_project_file",
            "description": "Read a small allow-listed project file for demo purposes.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "filename": {
                        "type": "string",
                        "enum": sorted(ALLOWED_FILES),
                        "description": "The project file to read.",
                    }
                },
                "required": ["filename"],
                "additionalProperties": False,
            },
        }
    ]


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name != "read_project_file":
        return {
            "isError": True,
            "content": [{"type": "text", "text": f"Unknown tool: {name}"}],
        }

    filename = str(arguments.get("filename", ""))
    path = ALLOWED_FILES.get(filename)
    if path is None:
        return {
            "isError": True,
            "content": [{"type": "text", "text": f"File is not allowed: {filename}"}],
        }

    text = path.read_text(encoding="utf-8")
    return {
        "content": [
            {
                "type": "text",
                "text": text[:1200],
            }
        ]
    }


def handle_request(message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    request_id = message.get("id")

    if method == "notifications/initialized":
        return None
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "xhs-agent-demo-mcp", "version": "0.1.0"},
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": tool_list()}}
    if method == "tools/call":
        params = message.get("params") or {}
        result = call_tool(str(params.get("name", "")), params.get("arguments") or {})
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"},
    }


def main() -> None:
    while True:
        message = read_message()
        if message is None:
            break
        response = handle_request(message)
        if response is not None:
            write_message(response)


if __name__ == "__main__":
    main()
