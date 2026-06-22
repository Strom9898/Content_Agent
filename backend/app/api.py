from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from langgraph.types import Command
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.config import get_settings
from app.database import get_db
from app.generation_progress import (
    clear_generation_progress,
    get_generation_progress,
    set_generation_progress,
)
from app.graph import thread_config
from app.models import (
    ArticleVersion,
    Project,
    ProjectStatus,
    Review,
    ReviewPreference,
    User,
)
from app.mcp_client import run_mcp_demo
from app.review_memory import (
    list_review_preferences,
    remember_review_feedback,
    review_preference_texts,
)
from app.schemas import (
    ProjectCreate,
    GenerationProgressOut,
    ProjectOut,
    ReviewPreferenceOut,
    ReviewSubmit,
    TokenOut,
    TopicSelect,
    UserCredentials,
    UserOut,
    WorkflowStateOut,
)
from app.services.content_generator import get_content_generator

router = APIRouter(prefix="/api")


def serialize_project(project: Project) -> ProjectOut:
    latest = max(project.articles, key=lambda item: item.version, default=None)
    return ProjectOut(
        id=project.id,
        source_topic=project.source_topic,
        selected_topic=project.selected_topic,
        status=project.status,
        topic_options=project.topic_options,
        latest_article=latest,
        final_package=project.final_package,
        revision_count=project.revision_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def find_project(project_id: str, user: User, db: Session) -> Project:
    # 使用项目 ID 和用户 ID 双重过滤，避免通过猜测 UUID 访问他人内容。
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.user_id == user.id,
        )
    )
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


def delete_project_images(project: Project) -> None:
    settings = get_settings()
    image_root = settings.generated_images_path.resolve()
    images = (project.final_package or {}).get("images", [])
    for image in images:
        if not isinstance(image, str) or not image.startswith("/api/generated/"):
            continue
        candidate = (image_root / Path(image).name).resolve()
        if candidate.parent == image_root:
            candidate.unlink(missing_ok=True)


def get_graph(request: Request):
    return request.app.state.content_graph


def describe_phase(next_nodes: tuple[str, ...]) -> tuple[str, str | None]:
    if "wait_for_topic" in next_nodes:
        return "waiting_topic_selection", "topic_selection"
    if "wait_for_review" in next_nodes:
        return "waiting_article_review", "article_review"
    if not next_nodes:
        return "completed", None
    return "processing", None


@router.get("/health")
def health(request: Request) -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "checkpointer": type(request.app.state.content_graph.checkpointer).__name__,
        "llm_provider": settings.llm_provider,
        "llm_model": settings.openai_model,
        "image_model": settings.openai_model_image or None,
        "content_generator": type(get_content_generator()).__name__,
    }


@router.get("/mcp/demo")
def mcp_demo() -> dict:
    return run_mcp_demo()


@router.post("/auth/register", response_model=TokenOut, status_code=201)
def register(payload: UserCredentials, db: Session = Depends(get_db)):
    username = payload.username.strip()
    user = User(username=username, password_hash=hash_password(payload.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="用户名已存在")
    db.refresh(user)
    return TokenOut(access_token=create_access_token(user), user=user)


@router.post("/auth/login", response_model=TokenOut)
def login(payload: UserCredentials, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username.strip()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    return TokenOut(access_token=create_access_token(user), user=user)


@router.get("/auth/me", response_model=UserOut)
def current_user(user: User = Depends(get_current_user)):
    return user


@router.get(
    "/memories/review-feedback",
    response_model=list[ReviewPreferenceOut],
)
def get_review_feedback_memories(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_review_preferences(db, user.id)


@router.delete("/memories/review-feedback", status_code=204)
def clear_review_feedback_memories(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    memories = db.scalars(
        select(ReviewPreference).where(ReviewPreference.user_id == user.id)
    ).all()
    for memory in memories:
        db.delete(memory)
    db.commit()
    return Response(status_code=204)


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    projects = db.scalars(
        select(Project)
        .where(Project.user_id == user.id)
        .order_by(Project.updated_at.desc())
    ).all()
    return [serialize_project(project) for project in projects]


@router.post("/projects", response_model=ProjectOut, status_code=201)
def create_project(
    payload: ProjectCreate,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = Project(
        user_id=user.id,
        source_topic=payload.source_topic,
        status=ProjectStatus.NEW,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    graph = get_graph(request)
    result = graph.invoke(
        {
            "project_id": project.id,
            "source_topic": payload.source_topic,
            "review_preferences": review_preference_texts(db, user.id),
        },
        config=thread_config(project.id),
    )
    project.topic_options = result["topic_options"]
    project.status = ProjectStatus.WAITING_TOPIC
    db.commit()
    db.refresh(project)
    return serialize_project(project)


@router.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return serialize_project(find_project(project_id, user, db))


@router.get(
    "/projects/{project_id}/generation-progress",
    response_model=GenerationProgressOut,
)
def generation_progress(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    find_project(project_id, user, db)
    return get_generation_progress(project_id)


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(
    project_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = find_project(project_id, user, db)
    get_graph(request).checkpointer.delete_thread(project.id)
    db.delete(project)
    db.commit()
    clear_generation_progress(project.id)
    delete_project_images(project)
    return Response(status_code=204)


@router.get(
    "/projects/{project_id}/workflow-state",
    response_model=WorkflowStateOut,
)
def get_workflow_state(
    project_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = find_project(project_id, user, db)
    snapshot = get_graph(request).get_state(thread_config(project_id))
    next_nodes = tuple(snapshot.next)
    phase, waiting_type = describe_phase(next_nodes)
    checkpoint_id = snapshot.config.get("configurable", {}).get("checkpoint_id")
    return WorkflowStateOut(
        project_id=project.id,
        business_status=project.status,
        phase=phase,
        next_nodes=list(next_nodes),
        waiting_for_human=waiting_type is not None,
        waiting_type=waiting_type,
        checkpoint_id=checkpoint_id,
        checkpoint_created_at=snapshot.created_at,
        revision_count=project.revision_count,
    )


@router.post("/projects/{project_id}/select-topic", response_model=ProjectOut)
def select_topic(
    project_id: str,
    payload: TopicSelect,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = find_project(project_id, user, db)
    if project.status != ProjectStatus.WAITING_TOPIC:
        raise HTTPException(status_code=409, detail="当前状态不能选择选题")
    if payload.topic not in {item["title"] for item in project.topic_options}:
        raise HTTPException(status_code=422, detail="请选择模型生成的选题")

    result = get_graph(request).invoke(
        Command(resume={"topic": payload.topic}),
        config=thread_config(project.id),
    )
    project.selected_topic = result["selected_topic"]
    project.status = ProjectStatus.WAITING_REVIEW
    project.articles.append(ArticleVersion(version=1, content=result["article"]))
    db.commit()
    db.refresh(project)
    return serialize_project(project)


@router.post("/projects/{project_id}/review", response_model=ProjectOut)
def review_project(
    project_id: str,
    payload: ReviewSubmit,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = find_project(project_id, user, db)
    if project.status != ProjectStatus.WAITING_REVIEW or not project.articles:
        raise HTTPException(status_code=409, detail="当前没有待审核文章")
    if not payload.approved and not payload.feedback.strip():
        raise HTTPException(status_code=422, detail="未通过时必须填写修改意见")

    project.reviews.append(
        Review(approved=payload.approved, feedback=payload.feedback)
    )
    if payload.approved:
        set_generation_progress(
            project.id,
            "article",
            6,
            "正在确认最终版文章",
        )
    result = get_graph(request).invoke(
        Command(
            resume={"approved": payload.approved, "feedback": payload.feedback}
        ),
        config=thread_config(project.id),
    )

    if payload.approved:
        project.final_package = result["final_package"]
        project.status = ProjectStatus.COMPLETED
    else:
        remember_review_feedback(
            db,
            user.id,
            project.id,
            payload.feedback,
        )
        latest = max(project.articles, key=lambda item: item.version)
        project.revision_count = result["revision_count"]
        project.articles.append(
            ArticleVersion(version=latest.version + 1, content=result["article"])
        )
    db.commit()
    db.refresh(project)
    return serialize_project(project)
