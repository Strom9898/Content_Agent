from app.mcp_client import run_mcp_demo


def test_mcp_demo_endpoint(client):
    response = client.get("/api/mcp/demo")

    assert response.status_code == 200
    payload = response.json()
    assert payload["server"]["name"] == "xhs-agent-demo-mcp"
    assert payload["protocol_version"] == "2024-11-05"
    assert payload["tools"][0]["name"] == "read_project_file"
    assert payload["sample_call"]["tool"] == "read_project_file"
    assert payload["sample_call"]["result"]["content"][0]["type"] == "text"


def test_mcp_client_lists_and_calls_tool():
    payload = run_mcp_demo()

    assert payload["tools"][0]["inputSchema"]["properties"]["filename"]["enum"] == [
        ".env.example",
        "README.md",
    ]
    assert payload["sample_call"]["result"]["content"][0]["text"]
