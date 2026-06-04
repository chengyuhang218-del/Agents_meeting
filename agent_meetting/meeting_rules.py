from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_RULES_PATH = Path(__file__).resolve().parent.parent / "config" / "meeting_rules.json"


@dataclass(frozen=True)
class TaskRule:
    title: str
    instruction: str
    context_agents: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class DiscussionRule:
    sender: str
    recipient: str
    instruction: str


class MeetingRules:
    def __init__(
        self,
        task_rules: dict[str, TaskRule],
        discussion_rounds: list[DiscussionRule],
        final_instruction: str,
    ) -> None:
        self.task_rules = task_rules
        self.discussion_rounds = discussion_rounds
        self.final_instruction = final_instruction

    @classmethod
    def load(cls, path: Path = DEFAULT_RULES_PATH) -> "MeetingRules":
        raw = json.loads(path.read_text(encoding="utf-8"))
        task_rules = {
            agent_id: TaskRule(
                title=item["title"],
                instruction=item["instruction"],
                context_agents=item.get("context_agents", []),
            )
            for agent_id, item in raw.get("task_rules", {}).items()
        }
        discussion_rounds = [
            DiscussionRule(
                sender=item["sender"],
                recipient=item["recipient"],
                instruction=item["instruction"],
            )
            for item in raw.get("discussion_rounds", [])
        ]
        return cls(
            task_rules=task_rules,
            discussion_rounds=discussion_rounds,
            final_instruction=raw.get(
                "final_instruction",
                "As {agent_id}, provide your final summary and key recommendations for: {goal}.",
            ),
        )

    def task_for_agent(self, agent_id: str, variables: dict[str, Any]) -> TaskRule | None:
        rule = self.task_rules.get(agent_id)
        if not rule:
            return None
        return TaskRule(
            title=rule.title.format(**variables),
            instruction=rule.instruction.format(**variables),
            context_agents=rule.context_agents,
        )
