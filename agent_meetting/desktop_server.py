from __future__ import annotations

import json
import mimetypes
import errno
import html
import os
import shutil
import subprocess
import threading
import traceback
import webbrowser
from dataclasses import asdict, dataclass, field
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from .meeting_rules import MeetingRules
from .models import AgentSpec
from .agents import create_agent
from .orchestrator import MainOrchestrator
from .registry import AgentRegistry
from .research_tools import generate_keywords, search_research_context
from .services.openclaw_service import (
    getOpenClawAgent,
    listOpenClawAgents,
    sendMessageToOpenClawAgent,
)
from .services.environment_service import get_environment_status
from .services.run_queue_service import RunQueueItem, status_from_job
from .workspace import ProjectWorkspace


REPO_ROOT = Path(__file__).resolve().parent.parent
APP_HOME = Path(os.getenv("AGENTMEETING_HOME", Path.cwd()))
CONFIG_DIR = Path(__file__).resolve().parent / "config"
AGENTS_PATH = CONFIG_DIR / "agents.json"
RULES_PATH = CONFIG_DIR / "meeting_rules.json"
PROJECTS_DIR = APP_HOME / "projects"
STATIC_DIR = Path(__file__).resolve().parent / "desktop"


@dataclass
class DesktopJob:
    job_id: str
    goal: str
    status: str = "queued"
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    search_mode: str = "auto"
    search_backend: str = "hybrid"
    project_id: str = ""
    project_dir: str = ""
    report_path: str = ""
    error: str = ""
    participants: list[str] = field(default_factory=list)
    rounds: int = 1
    events: list[dict[str, Any]] = field(default_factory=list)


class DesktopState:
    def __init__(self) -> None:
        self.jobs: dict[str, DesktopJob] = {}
        self.cancellations: dict[str, threading.Event] = {}
        self.lock = threading.Lock()

    def add_job(self, job: DesktopJob) -> None:
        with self.lock:
            self.jobs[job.job_id] = job
            self.cancellations[job.job_id] = threading.Event()

    def update_job(self, job_id: str, **updates: Any) -> None:
        with self.lock:
            job = self.jobs[job_id]
            for key, value in updates.items():
                setattr(job, key, value)
            job.updated_at = datetime.now().isoformat()

    def get_job(self, job_id: str) -> DesktopJob | None:
        with self.lock:
            return self.jobs.get(job_id)

    def all_jobs(self) -> list[DesktopJob]:
        with self.lock:
            return sorted(self.jobs.values(), key=lambda job: job.created_at, reverse=True)

    def append_event(self, job_id: str, event: dict[str, Any]) -> None:
        with self.lock:
            job = self.jobs[job_id]
            job.events.append(event)
            job.events = job.events[-80:]
            job.updated_at = datetime.now().isoformat()

    def cancel_job(self, job_id: str) -> bool:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return False
            event = self.cancellations.setdefault(job_id, threading.Event())
            event.set()
            if job.status in {"queued", "running"}:
                job.status = "cancelled"
                job.error = "Meeting cancelled by user"
                job.updated_at = datetime.now().isoformat()
                job.events.append({
                    "type": "meeting_cancelled",
                    "created_at": datetime.now().isoformat(),
                    "agent_id": "main",
                    "title": "会议已终止",
                    "content": "用户点击了一键终止会议，后续 agent round 和模型请求已停止。",
                })
            return True

    def is_cancelled(self, job_id: str) -> bool:
        with self.lock:
            event = self.cancellations.get(job_id)
            return bool(event and event.is_set())


STATE = DesktopState()


def run_desktop_server(
    host: str = "127.0.0.1",
    port: int = 8765,
    open_browser: bool = True,
    app_window: bool = False,
) -> None:
    server, actual_port = bind_desktop_server(host, port)
    url = f"http://{host}:{port}"
    if actual_port != port:
        url = f"http://{host}:{actual_port}"
        print(f"Port {port} is busy; using {actual_port} instead.")
    if open_browser:
        open_desktop_url(url, app_window=app_window)
    print(f"Agent Meeting Desktop running at {url}")
    server.serve_forever()


def open_desktop_url(url: str, app_window: bool = False) -> None:
    if app_window and shutil.which("open"):
        chrome_apps = ["Google Chrome", "Chromium", "Microsoft Edge"]
        for app_name in chrome_apps:
            try:
                subprocess.Popen(
                    ["open", "-na", app_name, "--args", f"--app={url}"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
            except OSError:
                continue
    webbrowser.open(url)


def bind_desktop_server(host: str, port: int, attempts: int = 20) -> tuple[ThreadingHTTPServer, int]:
    for offset in range(attempts):
        candidate = port + offset
        try:
            return ThreadingHTTPServer((host, candidate), DesktopRequestHandler), candidate
        except OSError as exc:
            if exc.errno not in {errno.EADDRINUSE, 48}:
                raise
    raise OSError(f"Could not bind Agent Meeting Desktop on ports {port}-{port + attempts - 1}")


class DesktopRequestHandler(BaseHTTPRequestHandler):
    server_version = "AgentMeetingDesktop/0.1"

    def do_GET(self) -> None:
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/":
                self._send_file(STATIC_DIR / "index.html")
            elif path.startswith("/assets/"):
                self._send_file(STATIC_DIR / path.removeprefix("/assets/"))
            elif path == "/api/health":
                environment = get_environment_status()
                self._send_json({"ok": True, "environment": environment, "openclaw": detect_openclaw()})
            elif path == "/api/environment/status":
                self._send_json(get_environment_status())
            elif path == "/api/agents":
                self._send_json({"agents": list_agents()})
            elif path == "/api/projects":
                self._send_json({"projects": list_projects()})
            elif path.startswith("/api/projects/"):
                self._handle_project_get(path)
            elif path == "/api/jobs":
                self._send_json({"jobs": [asdict(job) for job in STATE.all_jobs()]})
            elif path == "/api/run-queue":
                self._send_json({"runQueue": build_run_queue()})
            elif path.startswith("/api/jobs/"):
                job_id = unquote(path.removeprefix("/api/jobs/"))
                job = STATE.get_job(job_id)
                if not job:
                    self._send_error(404, "Job not found")
                else:
                    self._send_json(asdict(job))
            elif path == "/api/meeting-rules":
                self._send_json(read_json(RULES_PATH))
            else:
                self._send_error(404, "Not found")
        except Exception as exc:
            self._send_error(500, f"{exc}\n{traceback.format_exc()}")

    def do_POST(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/meetings":
                self._create_meeting()
            elif parsed.path == "/api/agents":
                self._create_agent()
            elif parsed.path.startswith("/api/jobs/") and parsed.path.endswith("/cancel"):
                self._cancel_job(parsed.path)
            elif parsed.path.startswith("/api/agents/") and parsed.path.endswith("/chat"):
                self._chat_with_agent(parsed.path)
            else:
                self._send_error(404, "Not found")
        except Exception as exc:
            self._send_error(500, f"{exc}\n{traceback.format_exc()}")

    def _create_meeting(self) -> None:
        payload = self._read_json()
        goal = str(payload.get("goal", "")).strip()
        if not goal:
            self._send_error(400, "goal is required")
            return
        search_mode = str(payload.get("search_mode", "auto"))
        search_backend = str(payload.get("search_backend", "hybrid"))
        references_text = ""
        participants = normalize_string_list(payload.get("participants"), [])
        try:
            rounds = max(1, int(str(payload.get("rounds", "1") or "1")))
        except ValueError:
            rounds = 1
        references_path = None
        job_id = datetime.now().strftime("job-%Y%m%d-%H%M%S-%f")

        if references_text:
            input_dir = PROJECTS_DIR / "_desktop_inputs"
            input_dir.mkdir(parents=True, exist_ok=True)
            references_path = input_dir / f"{job_id}-references.md"
            references_path.write_text(references_text, encoding="utf-8")

        job = DesktopJob(
            job_id=job_id,
            goal=goal,
            search_mode=search_mode,
            search_backend=search_backend,
            participants=participants,
            rounds=rounds,
        )
        STATE.add_job(job)
        thread = threading.Thread(
            target=run_meeting_job,
            args=(job_id, goal, search_mode, search_backend, references_path, participants, rounds),
            daemon=True,
        )
        thread.start()
        self._send_json(asdict(job), status=202)

    def _cancel_job(self, path: str) -> None:
        job_id = unquote(path.removeprefix("/api/jobs/").removesuffix("/cancel"))
        if not STATE.cancel_job(job_id):
            self._send_error(404, "Job not found")
            return
        job = STATE.get_job(job_id)
        self._send_json({"ok": True, "job": asdict(job) if job else None})

    def _chat_with_agent(self, path: str) -> None:
        agent_id = normalize_agent_id(unquote(path.removeprefix("/api/agents/").removesuffix("/chat")))
        payload = self._read_json()
        message = str(payload.get("message", "")).strip()
        if not agent_id or not message:
            self._send_error(400, "agent_id and message are required")
            return
        search_context = build_direct_chat_search_context(message, agent_id)
        prompt = (
            "Respond to this direct user chat message. Keep the reply concise and stay in your configured role. "
            "If the search context contains papers or datasets, cite real identifiers such as PMID, DOI, or GEO accession. "
            "If the search context is empty, say what still needs to be searched instead of inventing references.\n\n"
            f"{search_context}\n\nUser message:\n{message}"
        )
        response = sendMessageToOpenClawAgent(
            agent_id,
            prompt,
            session_key=f"agent:{agent_id}:direct-chat-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}",
        )
        self._send_json({
            "agentId": agent_id,
            "role": "assistant",
            "content": response,
            "timestamp": datetime.now().isoformat(),
        })

    def _create_agent(self) -> None:
        payload = self._read_json()
        agent_id = normalize_agent_id(str(payload.get("agent_id", "")))
        if not agent_id:
            self._send_error(400, "agent_id is required")
            return
        name = str(payload.get("name") or agent_id.title())
        role = str(payload.get("role") or "Specialized Agent")
        responsibilities = normalize_string_list(payload.get("responsibilities"), ["专项分析"])
        output_format = normalize_string_list(payload.get("output_format"), ["结构化结论"])
        triggers = normalize_string_list(payload.get("triggers"), [agent_id])

        agents_config = read_json(AGENTS_PATH)
        agents = [item for item in agents_config.get("agents", []) if item.get("agent_id") != agent_id]
        agents.append({
            "agent_id": agent_id,
            "name": name,
            "role": role,
            "responsibilities": responsibilities,
            "output_format": output_format,
            "triggers": triggers,
        })
        agents_config["agents"] = agents
        write_json(AGENTS_PATH, agents_config)

        rules = read_json(RULES_PATH)
        task_rules = rules.setdefault("task_rules", {})
        task_rules[agent_id] = {
            "title": str(payload.get("task_title") or f"{name} 专项分析"),
            "context_agents": normalize_string_list(payload.get("context_agents"), ["research"]),
            "instruction": str(payload.get("task_instruction") or default_task_instruction(agent_id, role)),
        }
        write_json(RULES_PATH, rules)

        self._send_json({"ok": True, "agent": next(item for item in agents if item["agent_id"] == agent_id)})

    def _handle_project_get(self, path: str) -> None:
        suffix = unquote(path.removeprefix("/api/projects/"))
        if suffix.endswith("/report.html"):
            project_id = suffix.removesuffix("/report.html")
            report_path = PROJECTS_DIR / project_id / "final_report" / "final_report.md"
            if not report_path.exists():
                self._send_error(404, "Report not found")
                return
            self._send_text(
                render_report_html(project_id, report_path.read_text(encoding="utf-8")),
                "text/html; charset=utf-8",
            )
            return
        if suffix.endswith("/report"):
            project_id = suffix.removesuffix("/report")
            report_path = PROJECTS_DIR / project_id / "final_report" / "final_report.md"
            if not report_path.exists():
                self._send_error(404, "Report not found")
                return
            self._send_text(report_path.read_text(encoding="utf-8"), "text/markdown; charset=utf-8")
            return

        project_dir = PROJECTS_DIR / suffix
        if not project_dir.exists():
            self._send_error(404, "Project not found")
            return
        self._send_json(read_project(project_dir))

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _send_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self._send_error(404, "File not found")
            return
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text: str, content_type: str = "text/plain; charset=utf-8") -> None:
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: int, message: str) -> None:
        self._send_json({"error": message}, status=status)

    def log_message(self, format: str, *args: Any) -> None:
        return


def run_meeting_job(
    job_id: str,
    goal: str,
    search_mode: str,
    search_backend: str,
    references_path: Path | None,
    participants: list[str] | None = None,
    rounds: int = 1,
) -> None:
    STATE.update_job(job_id, status="running")
    try:
        def on_event(event: dict[str, Any]) -> None:
            if STATE.is_cancelled(job_id):
                return
            STATE.append_event(job_id, event)

        registry = AgentRegistry.load(AGENTS_PATH)
        rules = MeetingRules.load(RULES_PATH)
        workspace = ProjectWorkspace(PROJECTS_DIR)
        project, _report = MainOrchestrator(
            registry,
            workspace,
            rules=rules,
            search_mode=search_mode,
            search_backend=search_backend,
            references_path=references_path,
            team_override=participants or None,
            event_callback=on_event,
            cancel_checker=lambda: STATE.is_cancelled(job_id),
        ).run(goal)
        if STATE.is_cancelled(job_id):
            STATE.update_job(job_id, status="cancelled", error="Meeting cancelled by user")
            return
        report_path = project.project_dir / "final_report" / "final_report.md"
        STATE.update_job(
            job_id,
            status="done",
            project_id=project.project_id,
            project_dir=str(project.project_dir),
            report_path=str(report_path),
        )
    except Exception:
        if STATE.is_cancelled(job_id):
            STATE.update_job(job_id, status="cancelled", error="Meeting cancelled by user")
        else:
            STATE.update_job(job_id, status="error", error=traceback.format_exc())


def list_agents() -> list[dict[str, Any]]:
    openclaw_agents = listOpenClawAgents()
    registry = AgentRegistry.load(AGENTS_PATH)
    agents = []
    by_id = {agent["id"]: agent for agent in openclaw_agents}
    for spec in registry.all():
        openclaw = by_id.get(spec.agent_id, {})
        item = asdict(spec)
        item["id"] = spec.agent_id
        item["description"] = openclaw.get("description", ", ".join(spec.responsibilities))
        item["status"] = openclaw.get("status", "available" if openclaw else "missing")
        item["registered"] = True
        item["openclaw_exists"] = bool(openclaw)
        item["source"] = "openclaw" if openclaw else "config"
        item["model"] = openclaw.get("model", "")
        agents.append(item)
    known = {item["agent_id"] for item in agents}
    for openclaw in openclaw_agents:
        agent_id = openclaw["id"]
        if agent_id not in known:
            agents.append({
                "agent_id": agent_id,
                "id": agent_id,
                "name": openclaw.get("name") or agent_id,
                "role": openclaw.get("role") or "OpenClaw Agent",
                "description": openclaw.get("description", ""),
                "responsibilities": [],
                "output_format": [],
                "triggers": [],
                "registered": False,
                "openclaw_exists": True,
                "source": "openclaw",
                "status": openclaw.get("status", "available"),
                "model": openclaw.get("model", ""),
            })
    return agents


def build_run_queue() -> list[dict[str, Any]]:
    items: list[RunQueueItem] = []
    for job in STATE.all_jobs():
        logs = []
        messages = []
        current_round = ""
        for event in job.events:
            entry = {
                "type": event.get("type", ""),
                "agentId": event.get("agent_id", ""),
                "title": event.get("title", ""),
                "content": event.get("content", ""),
                "createdAt": event.get("created_at", ""),
                "phase": event.get("phase", ""),
            }
            if event.get("type") == "agent_message":
                messages.append(entry)
            else:
                logs.append(entry)
            if event.get("phase"):
                current_round = str(event.get("phase"))
        final_result = ""
        if job.project_id:
            report_path = PROJECTS_DIR / job.project_id / "final_report" / "final_report.md"
            if report_path.exists():
                final_result = report_path.read_text(encoding="utf-8")
        item = RunQueueItem(
            id=job.job_id,
            type="meeting",
            title=job.goal,
            status=status_from_job(job.status),
            createdAt=job.created_at,
            updatedAt=job.updated_at,
            participants=job.participants,
            topic=job.goal,
            rounds=job.rounds,
            logs=logs,
            messages=messages,
            finalResult=final_result,
            error=job.error,
            projectId=job.project_id,
            reportPath=job.report_path,
        ).to_dict()
        item["currentRound"] = current_round
        item["terminated"] = job.status == "cancelled"
        items.append(item)
    return items


def discover_openclaw_agents() -> dict[str, Path]:
    roots = [Path.home() / ".openclaw" / "agents"]
    discovered: dict[str, Path] = {}
    for root in roots:
        if not root.exists():
            continue
        for path in root.iterdir():
            if path.is_dir() and not path.name.startswith("."):
                discovered[path.name] = path
    return discovered


def detect_openclaw() -> dict[str, Any]:
    configured = Path("/opt/homebrew/bin/openclaw")
    executable = shutil.which("openclaw")
    return {
        "configured_path": str(configured),
        "configured_exists": configured.exists(),
        "path_executable": executable or "",
    }


def list_projects() -> list[dict[str, Any]]:
    workspace = ProjectWorkspace(PROJECTS_DIR)
    projects = []
    for path in workspace.list_projects():
        if path.name.startswith("_"):
            continue
        meta_path = path / "project.json"
        if not meta_path.exists():
            continue
        meta = read_json(meta_path)
        report_path = path / "final_report" / "final_report.md"
        meta["has_report"] = report_path.exists()
        meta["report_path"] = str(report_path) if report_path.exists() else ""
        projects.append(meta)
    return projects


def read_project(project_dir: Path) -> dict[str, Any]:
    data = {
        "meta": read_json(project_dir / "project.json"),
        "tasks": [],
        "messages": [],
        "files": [],
        "report": "",
    }
    tasks_path = project_dir / "tasks" / "tasks.json"
    if tasks_path.exists():
        data["tasks"] = read_json(tasks_path)
    meeting_path = project_dir / "discussions" / "meeting.jsonl"
    if meeting_path.exists():
        data["messages"] = [
            json.loads(line)
            for line in meeting_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    files_dir = project_dir / "files"
    if files_dir.exists():
        data["files"] = [
            str(path.relative_to(project_dir))
            for path in sorted(files_dir.rglob("*"))
            if path.is_file()
        ]
    report_path = project_dir / "final_report" / "final_report.md"
    if report_path.exists():
        data["report"] = report_path.read_text(encoding="utf-8")
    return data


def markdown_to_basic_html(markdown: str) -> str:
    escaped = html.escape(markdown)
    lines = []
    for raw_line in escaped.splitlines():
        line = raw_line.strip()
        if line.startswith("### "):
            lines.append(f"<h3>{line[4:]}</h3>")
        elif line.startswith("## "):
            lines.append(f"<h2>{line[3:]}</h2>")
        elif line.startswith("# "):
            lines.append(f"<h1>{line[2:]}</h1>")
        elif line.startswith("- "):
            lines.append(f"<li>{line[2:]}</li>")
        elif not line:
            lines.append("<br>")
        else:
            line = line.replace("**", "")
            lines.append(f"<p>{line}</p>")
    return "\n".join(lines)


def render_report_html(project_id: str, markdown: str) -> str:
    title = html.escape(project_id)
    body = markdown_to_basic_html(markdown)
    raw = html.escape(markdown)
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Meeting Report - {title}</title>
  <style>
    body {{ margin: 0; background: #f4f7f6; color: #1c2b30; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    header {{ position: sticky; top: 0; padding: 14px 22px; background: rgba(255,255,255,.94); border-bottom: 1px solid #d8e1de; backdrop-filter: blur(10px); }}
    h1 {{ margin: 0 0 6px; font-size: 22px; }}
    main {{ max-width: 980px; margin: 0 auto; padding: 24px; }}
    article {{ padding: 24px; background: #fff; border: 1px solid #d8e1de; border-radius: 8px; box-shadow: 0 18px 55px rgba(24,40,45,.08); }}
    h2, h3 {{ margin: 22px 0 8px; }}
    p, li {{ line-height: 1.65; font-size: 15px; }}
    .actions {{ display: flex; gap: 8px; flex-wrap: wrap; }}
    button, a {{ border: 1px solid #b8cdc6; border-radius: 6px; padding: 7px 10px; background: #fff; color: #1f7a68; font-weight: 700; text-decoration: none; cursor: pointer; }}
    pre {{ white-space: pre-wrap; display: none; padding: 16px; background: #f7faf9; border: 1px solid #d8e1de; border-radius: 6px; }}
  </style>
</head>
<body>
  <header>
    <h1>最终报告</h1>
    <div class="actions">
      <button onclick="navigator.clipboard.writeText(document.getElementById('raw').textContent)">复制 Markdown</button>
      <a href="./report" target="_blank" rel="noopener">打开 .md</a>
      <button onclick="document.getElementById('raw').style.display = document.getElementById('raw').style.display === 'block' ? 'none' : 'block'">显示原文</button>
    </div>
  </header>
  <main>
    <article>{body}</article>
    <pre id="raw">{raw}</pre>
  </main>
</body>
</html>"""


def normalize_agent_id(value: str) -> str:
    value = value.strip().lower().replace(" ", "-")
    return "".join(ch for ch in value if ch.isalnum() or ch in {"-", "_"}).strip("-_")


def normalize_string_list(value: Any, default: list[str]) -> list[str]:
    if value is None:
        return default
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()] or default
    if isinstance(value, str):
        items = [item.strip() for item in value.replace("\n", ",").split(",")]
        return [item for item in items if item] or default
    return default


def build_direct_chat_search_context(message: str, agent_id: str) -> str:
    search_terms = (
        "文献", "论文", "pubmed", "pmid", "doi", "scholar", "paper", "literature",
        "数据", "数据集", "geo", "gse", "tcga", "single-cell", "单细胞", "dataset",
    )
    should_search = agent_id in {"literature", "paper", "bio"} or any(
        term in message.lower() for term in search_terms
    )
    if not should_search:
        return ""

    try:
        context = search_research_context(
            message,
            generate_keywords(message),
            paper_limit=8,
            dataset_limit=5,
            search_mode="auto",
            search_backend="hybrid",
        )
    except Exception as exc:
        return f"## Real Search Context\nSearch failed before this direct chat: {exc}\n"

    return (
        "## Real Search Context For This Direct Chat\n"
        "The app performed live PubMed / Europe PMC / CrossRef / GEO lookup before calling this agent. "
        "Use these results as evidence and do not invent papers or datasets.\n\n"
        f"{context.to_markdown()}"
    )


def default_task_instruction(agent_id: str, role: str) -> str:
    return (
        "Research goal: {goal}\n\n"
        f"You are {agent_id}, acting as {role}. Use the search context, "
        "and previous agent outputs to produce a concrete contribution to this meeting. "
        "For literature or data claims, cite real identifiers from the search context whenever possible "
        "(PMID, DOI, GEO accession, dataset URL). If evidence is missing, state that it was not found "
        "instead of fabricating references. "
        "End with questions or recommendations for the other agents."
    )


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
