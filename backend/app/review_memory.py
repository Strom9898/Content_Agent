from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ReviewPreference


MAX_REVIEW_PREFERENCES = 20
MAX_INJECTED_PREFERENCES = 10
MAX_INJECTED_PREFERENCE_LENGTH = 500


def list_review_preferences(
    db: Session,
    user_id: str,
    limit: int = MAX_REVIEW_PREFERENCES,
) -> list[ReviewPreference]:
    return list(
        db.scalars(
            select(ReviewPreference)
            .where(ReviewPreference.user_id == user_id)
            .order_by(ReviewPreference.created_at.desc())
            .limit(limit)
        ).all()
    )


def review_preference_texts(db: Session, user_id: str) -> list[str]:
    memories = list_review_preferences(db, user_id, MAX_INJECTED_PREFERENCES)
    return [
        memory.feedback[:MAX_INJECTED_PREFERENCE_LENGTH]
        for memory in reversed(memories)
    ]


def remember_review_feedback(
    db: Session,
    user_id: str,
    project_id: str,
    feedback: str,
) -> ReviewPreference | None:
    normalized = " ".join(feedback.split())
    if not normalized:
        return None

    existing = db.scalar(
        select(ReviewPreference).where(
            ReviewPreference.user_id == user_id,
            ReviewPreference.feedback == normalized,
        )
    )
    if existing:
        return existing

    memory = ReviewPreference(
        user_id=user_id,
        source_project_id=project_id,
        feedback=normalized,
    )
    db.add(memory)
    return memory
