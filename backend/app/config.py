from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    app_name: str = "XHS Content Agent"
    database_url: str = "sqlite:///./data/xhs_agent.db"
    llm_provider: str = "mock"
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    openai_model_image: str = ""
    openai_base_url: str = ""
    llm_timeout: float = 180.0
    llm_max_retries: int = 2
    image_size: str = "2K"
    image_count: int = 3
    generated_images_dir: str = "data/generated"
    cors_origins: str = "http://localhost:5173"
    jwt_secret: str = "dev-only-change-me-use-at-least-32-bytes"
    jwt_expire_minutes: int = 10080

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def llm_base_url(self) -> str | None:
        if self.openai_base_url:
            return self.openai_base_url.rstrip("/")
        if self.llm_provider.lower() in {"doubao", "ark"}:
            return "https://ark.cn-beijing.volces.com/api/v3"
        return None

    @property
    def generated_images_path(self) -> Path:
        path = Path(self.generated_images_dir)
        if path.is_absolute():
            return path
        return Path(__file__).resolve().parents[1] / path

    @property
    def database_sync_url(self) -> str:
        if not self.database_url.startswith("postgresql"):
            return self.database_url
        return make_url(self.database_url).set(
            drivername="postgresql+psycopg"
        ).render_as_string(hide_password=False)

    @property
    def checkpoint_url(self) -> str:
        return self.database_sync_url.replace(
            "postgresql+psycopg://", "postgresql://", 1
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
