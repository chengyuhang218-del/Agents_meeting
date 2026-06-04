from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Callable


OPENCLAW_BIN = os.getenv("OPENCLAW_BIN") or os.getenv("AGENT_MEETTING_OPENCLAW_BIN") or "openclaw"


@dataclass
class OpenClawAgent:
    id: str
    name: str
    role: str = "OpenClaw Agent"
    description: str = ""
    source: str = "openclaw"
    status: str = "available"
    model: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _run_openclaw(args: list[str], timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [OPENCLAW_BIN, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        env={**os.environ, "OPENCLAW_CLI_DISABLE_FANCY": "1"},
    )


def _agent_from_cli_item(item: dict[str, Any]) -> OpenClawAgent:
    agent_id = str(item.get("id") or item.get("name") or "").strip()
    display_name = str(item.get("identityName") or item.get("name") or agent_id).strip()
    emoji = str(item.get("identityEmoji") or "").strip()
    model = str(item.get("model") or "").strip()
    description = f"{emoji} {display_name}".strip() if emoji and emoji != "—" else display_name
    return OpenClawAgent(
        id=agent_id,
        name=display_name or agent_id,
        role="OpenClaw Agent",
        description=description,
        status="available",
        model=model,
    )


def _list_agents_from_cli() -> list[OpenClawAgent]:
    result = _run_openclaw(["agents", "list", "--json"], timeout=30)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "openclaw agents list failed")
    parsed = json.loads(result.stdout)
    return [_agent_from_cli_item(item) for item in parsed if item.get("id")]


def _list_agents_from_local_dirs() -> list[OpenClawAgent]:
    root = Path.home() / ".openclaw" / "agents"
    if not root.exists():
        return []
    agents = []
    for path in sorted(root.iterdir()):
        if path.is_dir() and not path.name.startswith("."):
            agents.append(OpenClawAgent(id=path.name, name=path.name, status="available"))
    return agents


def listOpenClawAgents() -> list[dict[str, Any]]:
    """Return OpenClaw agents from CLI, with local directory fallback."""
    if not shutil.which(OPENCLAW_BIN) and not Path(OPENCLAW_BIN).exists():
        return []
    try:
        agents = _list_agents_from_cli()
    except Exception:
        agents = _list_agents_from_local_dirs()
    seen: set[str] = set()
    output = []
    for agent in agents:
        if not agent.id or agent.id in seen:
            continue
        seen.add(agent.id)
        output.append(agent.to_dict())
    return output


def getOpenClawAgent(agentId: str) -> dict[str, Any] | None:
    agent_id = agentId.strip()
    for agent in listOpenClawAgents():
        if agent["id"] == agent_id:
            return agent
    return None


def sendMessageToOpenClawAgent(agentId: str, message: str, session_key: str = "") -> str:
    args = ["agent", "--agent", agentId, "--message", message, "--json", "--thinking", "off"]
    if session_key:
        args.extend(["--session-key", session_key])
    result = _run_openclaw(args, timeout=int(os.getenv("AGENT_MEETTING_OPENCLAW_TIMEOUT", "300")))
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "OpenClaw agent call failed")
    try:
        parsed = json.loads(result.stdout[result.stdout.find("{"): result.stdout.rfind("}") + 1])
        payloads = parsed.get("result", {}).get("payloads", [])
        if payloads:
            return payloads[0].get("text", "")
    except Exception:
        pass
    return result.stdout.strip()


def startMeeting(participants: list[str], topic: str) -> dict[str, Any]:
    return {
        "participants": participants,
        "topic": topic,
        "status": "created",
    }


def stopMeeting(meetingId: str, cancel_callback: Callable[[str], bool] | None = None) -> bool:
    if cancel_callback:
        return cancel_callback(meetingId)
    return False

