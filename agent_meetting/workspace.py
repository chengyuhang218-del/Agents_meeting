from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from .models import Message, Project, Task


class ProjectWorkspace:
    def __init__(self, root: Path = Path("projects")) -> None:
        self.root = root

    def create(self, project: Project) -> None:
        for subdir in ["tasks", "discussions", "files", "files/references", "final_report"]:
            (project.project_dir / subdir).mkdir(parents=True, exist_ok=True)
        self.write_json(project.project_dir / "project.json", project.to_json())

    def write_tasks(self, project: Project, tasks: Iterable[Task]) -> None:
        self.write_json(project.project_dir / "tasks" / "tasks.json", [task.__dict__ for task in tasks])

    def append_message(self, project: Project, message: Message) -> None:
        path = project.project_dir / "discussions" / "meeting.jsonl"
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(message.__dict__, ensure_ascii=False) + "\n")

    def write_agent_result(self, project: Project, agent_id: str, content: str) -> str:
        rel_path = f"files/{agent_id}_result.md"
        (project.project_dir / rel_path).write_text(content, encoding="utf-8")
        return rel_path

    def write_research_context(self, project: Project, content: str) -> str:
        rel_path = "files/references/research_context.md"
        (project.project_dir / rel_path).write_text(content, encoding="utf-8")
        return rel_path

    def write_final_report(self, project: Project, content: str) -> str:
        rel_path = "final_report/final_report.md"
        (project.project_dir / rel_path).write_text(content, encoding="utf-8")
        return rel_path

    def list_projects(self) -> list[Path]:
        if not self.root.exists():
            return []
        return sorted([path for path in self.root.iterdir() if path.is_dir()], reverse=True)

    @staticmethod
    def write_json(path: Path, data: object) -> None:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
