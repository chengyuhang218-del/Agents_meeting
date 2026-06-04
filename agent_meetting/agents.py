from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from typing import Callable

from .models import AgentResult, AgentSpec, Task
from .registry import AgentRegistry

OPENCLAW_BIN = os.getenv("AGENT_MEETTING_OPENCLAW_BIN") or os.getenv("OPENCLAW_BIN") or "openclaw"
OPENCLAW_TIMEOUT = int(os.getenv("AGENT_MEETTING_OPENCLAW_TIMEOUT", "300"))
OPENCLAW_RETRIES = int(os.getenv("AGENT_MEETTING_OPENCLAW_RETRIES", "2"))
OPENCLAW_RETRY_DELAY = float(os.getenv("AGENT_MEETTING_OPENCLAW_RETRY_DELAY", "8"))
OPENCLAW_CALL_COOLDOWN = float(os.getenv("AGENT_MEETTING_OPENCLAW_CALL_COOLDOWN", "2"))
OPENCLAW_SESSION_MODE = os.getenv("AGENT_MEETTING_OPENCLAW_SESSION_MODE", "project").lower()

TRANSIENT_ERROR_MARKERS = (
    "request was aborted",
    "gateway closed (1012)",
    "service restart",
    "gatewaytransporterror",
)


def _is_transient_failure(text: str) -> bool:
    normalized = text.lower()
    return any(marker in normalized for marker in TRANSIENT_ERROR_MARKERS)


def _extract_agent_text(output: str) -> str:
    """Parse OpenClaw JSON output, falling back to raw stdout."""
    output = output.strip()
    json_start = output.find("{")
    json_end = output.rfind("}") + 1
    if json_start >= 0 and json_end > json_start:
        try:
            parsed = json.loads(output[json_start:json_end])
            payloads = parsed.get("result", {}).get("payloads", [])
            if payloads:
                text = payloads[0].get("text", "")
                if text:
                    return text
        except json.JSONDecodeError:
            pass
    return output[:8000]


def _call_agent(
    agent_id: str,
    instruction: str,
    context: str = "",
    role_context: str = "",
    session_key: str = "",
    cancel_checker: Callable[[], bool] | None = None,
) -> str:
    """Call an OpenClaw agent via CLI and return its response text."""
    if cancel_checker and cancel_checker():
        return f"[Agent {agent_id} cancelled before request]"
    full_prompt = f"""{role_context}

{context}

{'=' * 40}

TASK: {instruction}

Please provide your professional analysis and findings. Use the supplied real search context first. If your OpenClaw agent has web, browser, PubMed, CrossRef, GEO, or dataset-search tools available, you may use them to supplement missing evidence. Never invent papers or datasets: include real DOI/PMID/GEO accession/URL for literature or data claims, and clearly say when no reliable result was found."""
    cmd = [
        OPENCLAW_BIN,
        "agent",
        "--agent",
        agent_id,
        "--message",
        full_prompt,
        "--json",
        "--thinking",
        "off",
    ]
    if session_key:
        cmd.extend(["--session-key", f"agent:{agent_id}:{session_key}"])
    env = {**os.environ, "OPENCLAW_CLI_DISABLE_FANCY": "1"}
    max_attempts = max(1, OPENCLAW_RETRIES + 1)
    last_error = ""

    for attempt in range(1, max_attempts + 1):
        if cancel_checker and cancel_checker():
            return f"[Agent {agent_id} cancelled]"
        if OPENCLAW_CALL_COOLDOWN > 0:
            slept = 0.0
            while slept < OPENCLAW_CALL_COOLDOWN:
                if cancel_checker and cancel_checker():
                    return f"[Agent {agent_id} cancelled]"
                step = min(0.2, OPENCLAW_CALL_COOLDOWN - slept)
                time.sleep(step)
                slept += step
        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                start_new_session=True,
            )
            start = time.monotonic()
            while True:
                if process.poll() is not None:
                    break
                if cancel_checker and cancel_checker():
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except Exception:
                        process.terminate()
                    try:
                        process.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except Exception:
                            process.kill()
                    return f"[Agent {agent_id} cancelled]"
                if time.monotonic() - start > OPENCLAW_TIMEOUT:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except Exception:
                        process.terminate()
                    last_error = f"[Agent {agent_id} timeout after {OPENCLAW_TIMEOUT}s]"
                    if attempt < max_attempts:
                        time.sleep(OPENCLAW_RETRY_DELAY * attempt)
                        break
                    return last_error
                time.sleep(0.2)
            else:
                continue
            if process.poll() is None:
                continue
            stdout, stderr_text = process.communicate()
            result_returncode = process.returncode
        except Exception as e:
            return f"[Agent {agent_id} exception: {e}]"

        output = _extract_agent_text(stdout)
        combined = f"{output}\n{stderr_text}"
        if result_returncode == 0 and not _is_transient_failure(combined):
            return output

        stderr = stderr_text.strip()
        if result_returncode != 0:
            last_error = (
                f"[Agent {agent_id} error] returncode={result_returncode}, "
                f"attempt={attempt}/{max_attempts}\n"
                f"stderr: {stderr[-1200:]}"
            )
        else:
            last_error = (
                f"[Agent {agent_id} transient failure] attempt={attempt}/{max_attempts}\n"
                f"{output[:1200]}"
            )

        if attempt < max_attempts and _is_transient_failure(combined):
            time.sleep(OPENCLAW_RETRY_DELAY * attempt)
            continue
        return last_error

    return last_error or f"[Agent {agent_id} failed with no output]"


class BaseAgent:
    agent_id = "base"
    openclaw_agent_id = ""

    def __init__(
        self,
        agent_id: str | None = None,
        spec: AgentSpec | None = None,
        meeting_id: str = "",
        goal: str = "",
        cancel_checker: Callable[[], bool] | None = None,
    ) -> None:
        if agent_id:
            self.agent_id = agent_id
            self.openclaw_agent_id = agent_id
        self.spec = spec
        self.meeting_id = meeting_id
        self.goal = goal
        self.cancel_checker = cancel_checker

    def run(self, goal: str, task: Task, context: dict[str, AgentResult]) -> AgentResult:
        raise NotImplementedError

    def _build_context(self, context: dict[str, AgentResult], include_ids: list[str] | None = None) -> str:
        """Build cross-agent context from previous results."""
        if not context:
            return ""
        lines = ["## Previous Agents' Results"]
        for aid in (include_ids or list(context.keys())):
            if aid in context:
                lines.append(f"\n--- {context[aid].title} ({aid}) ---")
                lines.append(context[aid].content[:2000])
        return "\n".join(lines)

    def _call(self, instruction: str, context_str: str = "") -> str:
        return _call_agent(
            self.openclaw_agent_id,
            instruction,
            context_str,
            role_context=self._role_context(),
            session_key=self._session_key(),
            cancel_checker=self.cancel_checker,
        )

    def _task_context(self, task: Task, context: dict[str, AgentResult]) -> str:
        return self._build_context(context, include_ids=task.context_agents or None)

    def _role_context(self) -> str:
        spec = self.spec
        lines = [
            "## Current Agent Meeting Contract",
            f"Meeting ID: {self.meeting_id or 'unspecified'}",
            f"Current user goal: {self.goal or 'unspecified'}",
            "Scope rule: prioritize this current meeting packet, the supplied real search context, and the supplied agent outputs.",
            "Research rule: for literature/data tasks, use real sources only. Cite PMID/DOI/GEO accession/URLs. If your OpenClaw tools can browse/search, you may do fresh searches to fill gaps; otherwise rely on the supplied app search context.",
            "Ignore previous conversations, old projects, and unrelated session memory.",
            "Stay inside your assigned role. Do not take over another agent's responsibilities unless explicitly asked.",
        ]
        if spec:
            lines.extend(
                [
                    f"Agent: {spec.name} ({spec.agent_id})",
                    f"Role: {spec.role}",
                    "Responsibilities:",
                    *[f"- {item}" for item in spec.responsibilities],
                    "Expected output format:",
                    *[f"- {item}" for item in spec.output_format],
                ]
            )
        else:
            lines.extend(
                [
                    f"Agent ID: {self.agent_id}",
                    "Role: follow the current task title and instructions strictly.",
                ]
            )
        return "\n".join(lines)

    def _session_key(self) -> str:
        if self.agent_id == "main" or not self.meeting_id or OPENCLAW_SESSION_MODE in {"", "none", "off"}:
            return ""
        if OPENCLAW_SESSION_MODE == "call":
            return f"meeting-{self.meeting_id}-{self.agent_id}-{time.time_ns()}"
        return f"meeting-{self.meeting_id}-{self.agent_id}"


class GenericOpenClawAgent(BaseAgent):
    def run(self, goal: str, task: Task, context: dict[str, AgentResult]) -> AgentResult:
        self.goal = goal
        response = self._call(task.instruction, self._task_context(task, context))
        return AgentResult(self.agent_id, task.title, response)


class LiteratureAgent(BaseAgent):
    agent_id = "literature"
    openclaw_agent_id = "literature"

    def run(self, goal: str, task: Task, context: dict[str, AgentResult]) -> AgentResult:
        self.goal = goal
        ctx = self._task_context(task, context)
        response = self._call(task.instruction, ctx)
        return AgentResult(self.agent_id, "文献检索结果", response)


class PaperAgent(BaseAgent):
    agent_id = "paper"
    openclaw_agent_id = "paper"

    def run(self, goal: str, task: Task, context: dict[str, AgentResult]) -> AgentResult:
        self.goal = goal
        ctx = self._task_context(task, context)
        response = self._call(task.instruction, ctx)
        return AgentResult(self.agent_id, "论文分析与阅读报告", response)


class BioAgent(BaseAgent):
    agent_id = "bio"
    openclaw_agent_id = "bio"

    def run(self, goal: str, task: Task, context: dict[str, AgentResult]) -> AgentResult:
        self.goal = goal
        ctx = self._task_context(task, context)
        response = self._call(task.instruction, ctx)
        return AgentResult(self.agent_id, "生信分析与验证方案", response)


class CodingAgent(BaseAgent):
    agent_id = "coding"
    openclaw_agent_id = "coding"

    def run(self, goal: str, task: Task, context: dict[str, AgentResult]) -> AgentResult:
        self.goal = goal
        ctx = self._task_context(task, context)
        response = self._call(task.instruction, ctx)
        return AgentResult(self.agent_id, "开发实现方案", response)


AGENT_CLASSES = {
    "literature": LiteratureAgent,
    "paper": PaperAgent,
    "bio": BioAgent,
    "coding": CodingAgent,
}


def _load_agent_spec(agent_id: str, registry: AgentRegistry | None = None) -> AgentSpec | None:
    try:
        return (registry or AgentRegistry.load()).get(agent_id)
    except Exception:
        return None


def create_agent(
    agent_id: str,
    meeting_id: str = "",
    registry: AgentRegistry | None = None,
    goal: str = "",
    cancel_checker: Callable[[], bool] | None = None,
) -> BaseAgent:
    agent_class = AGENT_CLASSES.get(agent_id)
    spec = _load_agent_spec(agent_id, registry)
    if agent_class:
        return agent_class(spec=spec, meeting_id=meeting_id, goal=goal, cancel_checker=cancel_checker)
    return GenericOpenClawAgent(agent_id, spec=spec, meeting_id=meeting_id, goal=goal, cancel_checker=cancel_checker)
