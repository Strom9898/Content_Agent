from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import ProjectStatus


class UserCredentials(BaseModel):
    username: str = Field(
        min_length=3, max_length=30, pattern=r"^[A-Za-z0-9_\-\u4e00-\u9fff]+$"
    )
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: str
    username: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ProjectCreate(BaseModel):
    source_topic: str = Field(min_length=2, max_length=500)


class TopicSelect(BaseModel):
    topic: str = Field(min_length=2, max_length=1000)


class ReviewSubmit(BaseModel):
    approved: bool
    feedback: str = Field(default="", max_length=3000)


class ReviewPreferenceOut(BaseModel):
    id: str
    feedback: str
    source_project_id: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ArticleOut(BaseModel):
    version: int
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectOut(BaseModel):
    id: str
    source_topic: str
    selected_topic: str | None
    status: ProjectStatus
    topic_options: list[dict]
    latest_article: ArticleOut | None = None
    final_package: dict | None
    revision_count: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class WorkflowStateOut(BaseModel):
    project_id: str
    business_status: ProjectStatus
    phase: str
    next_nodes: list[str]
    waiting_for_human: bool
    waiting_type: str | None
    checkpoint_id: str | None
    checkpoint_created_at: datetime | None
    revision_count: int


class GenerationProgressOut(BaseModel):
    stage: str
    progress: int = Field(ge=0, le=100)
    message: str
