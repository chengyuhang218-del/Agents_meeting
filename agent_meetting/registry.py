from __future__ import annotations

import json
from pathlib import Path

from .models import AgentSpec


DEFAULT_REGISTRY_PATH = Path(__file__).resolve().parent / "config" / "agents.json"


class AgentRegistry:
    def __init__(self, specs: dict[str, AgentSpec]) -> None:
        self._specs = specs

    @classmethod
    def load(cls, path: Path = DEFAULT_REGISTRY_PATH) -> "AgentRegistry":
        raw = json.loads(path.read_text(encoding="utf-8"))
        specs = {
            item["agent_id"]: AgentSpec(
                agent_id=item["agent_id"],
                name=item["name"],
                role=item["role"],
                responsibilities=item["responsibilities"],
                output_format=item["output_format"],
                triggers=item.get("triggers", []),
            )
            for item in raw["agents"]
        }
        return cls(specs)

    def get(self, agent_id: str) -> AgentSpec:
        return self._specs[agent_id]

    def all(self) -> list[AgentSpec]:
        return list(self._specs.values())

    def selectable_agents(self) -> list[AgentSpec]:
        return [spec for spec in self._specs.values() if spec.agent_id != "main"]

    def select_team(self, goal: str) -> list[str]:
        normalized = goal.lower()
        selected: list[str] = []

        for spec in self.selectable_agents():
            if any(trigger.lower() in normalized for trigger in spec.triggers):
                selected.append(spec.agent_id)

        research_words = ["研究", "作用", "机制", "通路", "肿瘤", "癌", "gene", "protein"]
        if any(word in normalized for word in research_words):
            selected.extend(["literature", "paper", "bio"])

        if "代码" in normalized or "插件" in normalized or "开发" in normalized:
            selected.append("coding")

        ordered = []
        for agent_id in self._specs:
            if agent_id in selected and agent_id not in ordered:
                ordered.append(agent_id)
        return ordered or ["literature", "paper"]
