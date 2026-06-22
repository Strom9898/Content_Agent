from threading import Lock


_progress: dict[str, dict] = {}
_lock = Lock()


def set_generation_progress(
    project_id: str,
    stage: str,
    progress: int,
    message: str,
) -> None:
    with _lock:
        _progress[project_id] = {
            "stage": stage,
            "progress": max(0, min(progress, 100)),
            "message": message,
        }


def get_generation_progress(project_id: str) -> dict:
    with _lock:
        return _progress.get(
            project_id,
            {
                "stage": "idle",
                "progress": 0,
                "message": "等待生成",
            },
        ).copy()


def clear_generation_progress(project_id: str) -> None:
    with _lock:
        _progress.pop(project_id, None)
