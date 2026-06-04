from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass
class LLMProvider:
    enabled: bool = False

    def complete(self, system: str, user: str) -> str:
        raise NotImplementedError


class DisabledLLM(LLMProvider):
    def __init__(self) -> None:
        super().__init__(enabled=False)

    def complete(self, system: str, user: str) -> str:
        return ""


class OpenAIChatLLM(LLMProvider):
    def __init__(self, model: str | None = None, timeout: int = 60) -> None:
        super().__init__(enabled=True)
        self.api_key = os.getenv("OPENAI_API_KEY", "")
        self.base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.timeout = timeout

    def complete(self, system: str, user: str) -> str:
        if not self.api_key:
            return "LLM 未启用：缺少 OPENAI_API_KEY。"

        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
        }
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                data = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            return f"LLM 调用失败：{exc}"

        return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()


def build_llm(enabled: bool, model: str | None = None) -> LLMProvider:
    if enabled:
        return OpenAIChatLLM(model=model)
    return DisabledLLM()

