from typing import Protocol


class KnowledgeRetriever(Protocol):
    def retrieve(self, query: str, limit: int = 5) -> list[str]: ...


class NullRetriever:
    """RAG extension point. Replace with a pgvector-backed implementation."""

    def retrieve(self, query: str, limit: int = 5) -> list[str]:
        return []

