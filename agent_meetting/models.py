from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AgentStatus(str, Enum):
    OFFLINE = "offline"
    ONLINE = "online"
    WORKING = "working"
    DONE = "done"


@dataclass(frozen=True)
class AgentSpec:
    agent_id: str
    name: str
    role: str
    responsibilities: list[str]
    output_format: list[str]
    triggers: list[str] = field(default_factory=list)


@dataclass
class AgentState:
    agent_id: str
    status: AgentStatus = AgentStatus.OFFLINE
    current_task: str = ""
    recent_message: str = ""
    progress: int = 0


@dataclass
class Task:
    task_id: str
    agent_id: str
    title: str
    instruction: str
    context_agents: list[str] = field(default_factory=list)
    status: str = "pending"
    created_at: str = field(default_factory=utc_now)
    completed_at: str | None = None


@dataclass
class Message:
    sender: str
    recipient: str
    content: str
    message_type: str = "discussion"
    created_at: str = field(default_factory=utc_now)


@dataclass
class AgentResult:
    agent_id: str
    title: str
    content: str
    artifacts: list[str] = field(default_factory=list)


@dataclass
class Project:
    project_id: str
    goal: str
    project_dir: Path
    team: list[str]
    created_at: str = field(default_factory=utc_now)
    status: str = "running"

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["project_dir"] = str(self.project_dir)
        return data
