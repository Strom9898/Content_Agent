import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["LLM_PROVIDER"] = "mock"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


@pytest.fixture()
def client():
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as test_client:
        yield test_client
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def auth_client(client):
    response = client.post(
        "/api/auth/register",
        json={"username": "test_user", "password": "password123"},
    )
    token = response.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client
