def test_complete_content_workflow(auth_client):
    client = auth_client
    created = client.post("/api/projects", json={"source_topic": "居家收纳"})
    assert created.status_code == 201
    project = created.json()
    assert project["status"] == "waiting_topic"
    assert len(project["topic_options"]) == 3
    graph = client.app.state.content_graph
    config = {"configurable": {"thread_id": project["id"]}}
    assert graph.get_state(config).next == ("wait_for_topic",)
    state = client.get(f"/api/projects/{project['id']}/workflow-state")
    assert state.status_code == 200
    assert state.json()["phase"] == "waiting_topic_selection"
    assert state.json()["waiting_type"] == "topic_selection"
    assert state.json()["checkpoint_id"]

    selected = client.post(
        f"/api/projects/{project['id']}/select-topic",
        json={"topic": project["topic_options"][0]["title"]},
    )
    assert selected.status_code == 200
    assert selected.json()["latest_article"]["version"] == 1
    assert graph.get_state(config).next == ("wait_for_review",)
    state = client.get(f"/api/projects/{project['id']}/workflow-state").json()
    assert state["phase"] == "waiting_article_review"
    assert state["waiting_for_human"] is True

    revised = client.post(
        f"/api/projects/{project['id']}/review",
        json={"approved": False, "feedback": "语气更生活化"},
    )
    assert revised.status_code == 200
    assert revised.json()["latest_article"]["version"] == 2
    assert graph.get_state(config).next == ("wait_for_review",)

    approved = client.post(
        f"/api/projects/{project['id']}/review",
        json={"approved": True, "feedback": ""},
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "completed"
    package = approved.json()["final_package"]
    assert package["tags"]
    assert package["title"] in package["copy_text"]
    assert "#成长干货" in package["copy_text"]
    assert "\n# " not in package["copy_text"]
    progress = client.get(
        f"/api/projects/{project['id']}/generation-progress"
    ).json()
    assert progress["stage"] == "completed"
    assert progress["progress"] == 100
    assert graph.get_state(config).next == ()
    state = client.get(f"/api/projects/{project['id']}/workflow-state").json()
    assert state["phase"] == "completed"
    assert state["next_nodes"] == []
    assert state["waiting_for_human"] is False


def test_accounts_only_see_their_own_history(client):
    first = client.post(
        "/api/auth/register",
        json={"username": "first_user", "password": "password123"},
    ).json()
    client.headers["Authorization"] = f"Bearer {first['access_token']}"
    project = client.post(
        "/api/projects", json={"source_topic": "第一个账号的选题"}
    ).json()

    second = client.post(
        "/api/auth/register",
        json={"username": "second_user", "password": "password123"},
    ).json()
    client.headers["Authorization"] = f"Bearer {second['access_token']}"

    assert client.get("/api/projects").json() == []
    assert client.get(f"/api/projects/{project['id']}").status_code == 404
    assert (
        client.get(f"/api/projects/{project['id']}/workflow-state").status_code
        == 404
    )
    assert client.delete(f"/api/projects/{project['id']}").status_code == 404


def test_delete_project_removes_history_and_checkpoint(auth_client):
    client = auth_client
    project = client.post(
        "/api/projects", json={"source_topic": "待删除的项目"}
    ).json()
    graph = client.app.state.content_graph
    config = {"configurable": {"thread_id": project["id"]}}
    assert graph.get_state(config).next == ("wait_for_topic",)

    deleted = client.delete(f"/api/projects/{project['id']}")

    assert deleted.status_code == 204
    assert client.get(f"/api/projects/{project['id']}").status_code == 404
    assert client.get("/api/projects").json() == []
    assert graph.get_state(config).next == ()


def test_review_feedback_becomes_cross_project_memory(auth_client):
    client = auth_client
    feedback = "标题更克制，正文多给具体步骤"

    first = client.post(
        "/api/projects", json={"source_topic": "第一个长期记忆项目"}
    ).json()
    client.post(
        f"/api/projects/{first['id']}/select-topic",
        json={"topic": first["topic_options"][0]["title"]},
    )
    revised = client.post(
        f"/api/projects/{first['id']}/review",
        json={"approved": False, "feedback": feedback},
    )
    assert revised.status_code == 200

    memories = client.get("/api/memories/review-feedback")
    assert memories.status_code == 200
    assert [item["feedback"] for item in memories.json()] == [feedback]

    second = client.post(
        "/api/projects", json={"source_topic": "第二个长期记忆项目"}
    ).json()
    graph = client.app.state.content_graph
    config = {"configurable": {"thread_id": second["id"]}}
    assert graph.get_state(config).values["review_preferences"] == [feedback]

    selected = client.post(
        f"/api/projects/{second['id']}/select-topic",
        json={"topic": second["topic_options"][0]["title"]},
    )
    assert feedback in selected.json()["latest_article"]["content"]

    assert client.delete(f"/api/projects/{first['id']}").status_code == 204
    assert client.get("/api/memories/review-feedback").json()[0]["feedback"] == feedback

    assert client.delete("/api/memories/review-feedback").status_code == 204
    assert client.get("/api/memories/review-feedback").json() == []
