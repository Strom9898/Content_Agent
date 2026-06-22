from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.postgres import PostgresSaver
from sqlalchemy import inspect, text

from app.api import router
from app.config import get_settings
from app.database import Base, engine
from app.graph import build_content_graph

settings = get_settings()
settings.generated_images_path.mkdir(parents=True, exist_ok=True)


def migrate_legacy_schema() -> None:
    # create_all 不会修改已存在的表，因此为旧项目表补充用户归属字段。
    inspector = inspect(engine)
    if "projects" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("projects")}
    if "user_id" not in columns:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE projects ADD COLUMN user_id VARCHAR(36)"))
            if engine.dialect.name == "postgresql":
                connection.execute(
                    text(
                        "ALTER TABLE projects ADD CONSTRAINT "
                        "fk_projects_user_id FOREIGN KEY (user_id) REFERENCES users(id)"
                    )
                )
                connection.execute(
                    text("CREATE INDEX ix_projects_user_id ON projects (user_id)")
                )


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_legacy_schema()
    if settings.database_sync_url.startswith("postgresql"):
        with PostgresSaver.from_conn_string(settings.checkpoint_url) as checkpointer:
            checkpointer.setup()
            app.state.content_graph = build_content_graph(checkpointer)
            yield
    else:
        app.state.content_graph = build_content_graph(MemorySaver())
        yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount(
    "/api/generated",
    StaticFiles(directory=settings.generated_images_path),
    name="generated-images",
)
app.include_router(router)
