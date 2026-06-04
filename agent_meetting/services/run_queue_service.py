from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any


@dataclass
class RunQueueItem:
    id: str
    type: str
    title: str
    status: str
    createdAt: str
    updatedAt: str
    participants: list[str] = field(default_factory=list)
    topic: str = ""
    rounds: int = 1
    logs: list[dict[str, Any]] = field(default_factory=list)
    messages: list[dict[str, Any]] = field(default_factory=list)
    finalResult: str = ""
    error: str = ""
    projectId: str = ""
    reportPath: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def now_iso() -> str:
    return datetime.now().isoformat()


def status_from_job(status: str) -> str:
    return {
        "queued": "pending",
        "running": "running",
        "done": "completed",
        "cancelled": "stopped",
        "error": "failed",
    }.get(status, status or "pending")

