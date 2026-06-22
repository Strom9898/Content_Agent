from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app.generation_progress import set_generation_progress
from app.services.content_generator import get_content_generator


class ContentState(TypedDict, total=False):
    project_id: str
    source_topic: str
    topic_options: list[dict]
    selected_topic: str
    article: str
    feedback: str
    review_preferences: list[str]
    review_approved: bool
    revision_count: int
    final_package: dict


def generate_topics(state: ContentState) -> dict:
    return {
        "topic_options": get_content_generator().generate_topics(
            state["source_topic"]
        ),
        "revision_count": 0,
    }


def wait_for_topic(state: ContentState) -> dict:
    selection = interrupt(
        {
            "type": "topic_selection",
            "message": "请选择一个选题方向",
            "options": state["topic_options"],
        }
    )
    topic = selection["topic"] if isinstance(selection, dict) else str(selection)
    return {"selected_topic": topic}


def write_draft(state: ContentState) -> dict:
    return {
        "article": get_content_generator().write_article(
            state["selected_topic"],
            preferences=state.get("review_preferences", []),
        )
    }


def wait_for_review(state: ContentState) -> dict:
    review = interrupt(
        {
            "type": "article_review",
            "message": "请审核当前文章",
            "article": state["article"],
            "revision_count": state.get("revision_count", 0),
        }
    )
    if not isinstance(review, dict) or "approved" not in review:
        raise ValueError("审核恢复数据必须包含 approved")
    return {
        "review_approved": bool(review["approved"]),
        "feedback": str(review.get("feedback", "")),
    }


def route_review(state: ContentState) -> str:
    return "finalize" if state["review_approved"] else "revise"


def revise_draft(state: ContentState) -> dict:
    feedback = state.get("feedback", "").strip()
    if not feedback:
        raise ValueError("审核不通过时必须提供修改意见")
    return {
        "article": get_content_generator().write_article(
            state["selected_topic"],
            previous=state["article"],
            feedback=feedback,
            preferences=state.get("review_preferences", []),
        ),
        "revision_count": state.get("revision_count", 0) + 1,
    }


def finalize(state: ContentState) -> dict:
    project_id = state["project_id"]
    return {
        "final_package": get_content_generator().build_package(
            state["selected_topic"],
            state["article"],
            progress_callback=lambda stage, progress, message: set_generation_progress(
                project_id,
                stage,
                progress,
                message,
            ),
        )
    }


def build_content_graph(checkpointer):
    builder = StateGraph(ContentState)
    builder.add_node("generate_topics", generate_topics)
    builder.add_node("wait_for_topic", wait_for_topic)
    builder.add_node("write_draft", write_draft)
    builder.add_node("wait_for_review", wait_for_review)
    builder.add_node("revise_draft", revise_draft)
    builder.add_node("finalize", finalize)

    builder.add_edge(START, "generate_topics")
    builder.add_edge("generate_topics", "wait_for_topic")
    builder.add_edge("wait_for_topic", "write_draft")
    builder.add_edge("write_draft", "wait_for_review")
    builder.add_conditional_edges(
        "wait_for_review",
        route_review,
        {"revise": "revise_draft", "finalize": "finalize"},
    )
    builder.add_edge("revise_draft", "wait_for_review")
    builder.add_edge("finalize", END)
    return builder.compile(checkpointer=checkpointer)


def thread_config(project_id: str) -> dict:
    return {"configurable": {"thread_id": project_id}}
