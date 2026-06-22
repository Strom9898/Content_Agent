import json
import subprocess
import sys
from pathlib import Path
from typing import Any


class McpStdioClient:
    def __init__(self) -> None:
        backend_dir = Path(__file__).resolve().parents[1]
        self.process = subprocess.Popen(
            [sys.executable, "-m", "app.mcp_server"],
            cwd=backend_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._next_id = 1

    def close(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()

    def _write_message(self, payload: dict[str, Any]) -> None:
        if self.process.stdin is None:
            raise RuntimeError("MCP server stdin is closed")
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.process.stdin.write(
            f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body
        )
        self.process.stdin.flush()

    def _read_message(self) -> dict[str, Any]:
        if self.process.stdout is None:
            raise RuntimeError("MCP server stdout is closed")

        header = b""
        while b"\r\n\r\n" not in header:
            chunk = self.process.stdout.read(1)
            if not chunk:
                error = ""
                if self.process.stderr is not None:
                    error = self.process.stderr.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"MCP server closed stdout. {error}".strip())
            header += chunk

        content_length = 0
        for line in header.decode("ascii").split("\r\n"):
            if line.lower().startswith("content-length:"):
                content_length = int(line.split(":", 1)[1].strip())
                break
        if not content_length:
            raise RuntimeError("MCP response is missing Content-Length")

        body = self.process.stdout.read(content_length)
        return json.loads(body.decode("utf-8"))

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        request_id = self._next_id
        self._next_id += 1
        message: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params

        self._write_message(message)
        response = self._read_message()
        if "error" in response:
            raise RuntimeError(response["error"]["message"])
        return response["result"]

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        message: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self._write_message(message)


def run_mcp_demo() -> dict[str, Any]:
    client = McpStdioClient()
    try:
        initialized = client.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "xhs-agent-backend", "version": "0.1.0"},
            },
        )
        client.notify("notifications/initialized")
        tools = client.request("tools/list")["tools"]
        result = client.request(
            "tools/call",
            {
                "name": "read_project_file",
                "arguments": {"filename": "README.md"},
            },
        )
        return {
            "server": initialized["serverInfo"],
            "protocol_version": initialized["protocolVersion"],
            "tools": tools,
            "sample_call": {
                "tool": "read_project_file",
                "arguments": {"filename": "README.md"},
                "result": result,
            },
        }
    finally:
        client.close()
