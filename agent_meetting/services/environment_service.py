from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from .openclaw_service import listOpenClawAgents


@dataclass
class CheckResult:
    id: str
    label: str
    ok: bool
    status: str
    detail: str = ""
    path: str = ""
    version: str = ""
    actions: list[dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def get_environment_status() -> dict[str, Any]:
    runtime = detect_bundled_runtime()
    python = detect_python()
    openclaw = detect_openclaw()
    config = detect_openclaw_config(openclaw.path)
    agents = detect_agents(openclaw.ok)
    api = detect_api_config(openclaw.path)
    ready = python.ok and openclaw.ok and config.ok and api.ok and agents.ok
    return {
        "ready": ready,
        "runtime": runtime,
        "summary": build_summary(python, openclaw, config, agents, api),
        "checks": {
            "python": python.to_dict(),
            "openclaw": openclaw.to_dict(),
            "config": config.to_dict(),
            "api": api.to_dict(),
            "agents": agents.to_dict(),
        },
        "nextSteps": build_next_steps(python, openclaw, config, agents, api),
    }


def detect_python() -> CheckResult:
    if version_tuple(".".join(map(str, sys.version_info[:3]))) >= (3, 10):
        bundled = bool(getattr(sys, "frozen", False))
        return CheckResult(
            id="python",
            label="Python Runtime",
            ok=True,
            status="App 内嵌" if bundled else "已就绪",
            detail="当前后端运行在 App 内置 Python runtime 中。" if bundled else "当前 Python 可用于运行本地后端。",
            path=sys.executable,
            version=".".join(map(str, sys.version_info[:3])),
        )
    bundled_python = os.getenv("AGENTMEETING_BUNDLED_PYTHON", "")
    candidates = [
        bundled_python,
        sys.executable,
        str(Path.home() / "miniforge3" / "bin" / "python3"),
        str(Path.home() / "miniconda3" / "bin" / "python3"),
        str(Path.home() / "anaconda3" / "bin" / "python3"),
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        shutil.which("python3") or "",
        "/usr/bin/python3",
    ]
    seen: set[str] = set()
    found = []
    for candidate in candidates:
        if not candidate or candidate in seen or not Path(candidate).exists():
            continue
        seen.add(candidate)
        version = read_python_version(candidate)
        if version:
            found.append((candidate, version))
    for path, version in found:
        if version_tuple(version) >= (3, 10):
            return CheckResult(
                id="python",
                label="Python 3.10+",
                ok=True,
                status="已就绪",
                detail="App 会使用该 Python 创建私有运行环境。",
                path=path,
                version=version,
            )
    detail = "未找到 Python 3.10 或更高版本。" if not found else "找到 Python，但版本低于 3.10。"
    return CheckResult(
        id="python",
        label="Python 3.10+",
        ok=False,
        status="需要安装",
        detail=detail,
        path=found[0][0] if found else "",
        version=found[0][1] if found else "",
        actions=[
            {"label": "安装 Python 3", "type": "guide", "command": "brew install python"},
            {"label": "下载 Python", "type": "link", "url": "https://www.python.org/downloads/"},
        ],
    )


def detect_openclaw() -> CheckResult:
    env_path = os.getenv("OPENCLAW_BIN") or os.getenv("AGENT_MEETTING_OPENCLAW_BIN") or ""
    candidates = [
        env_path,
        shutil.which("openclaw") or "",
        "/opt/homebrew/bin/openclaw",
        "/usr/local/bin/openclaw",
    ]
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        if shutil.which(candidate) or Path(candidate).exists():
            version = read_command_version([candidate, "--version"])
            return CheckResult(
                id="openclaw",
                label="OpenClaw CLI",
                ok=True,
                status="已检测到",
                detail="可以通过后端统一调用 OpenClaw。",
                path=candidate,
                version=version,
            )
    return CheckResult(
        id="openclaw",
        label="OpenClaw CLI",
        ok=False,
        status="未安装",
        detail="后续会提供 App 内一键安装；当前版本请先按提示安装 OpenClaw。",
        actions=[
            {"label": "一键安装 OpenClaw", "type": "future", "command": "openclaw install"},
            {"label": "查看安装文档", "type": "guide", "command": "openclaw onboard"},
        ],
    )


def detect_openclaw_config(openclaw_path: str) -> CheckResult:
    config_roots = openclaw_config_roots()
    existing = [path for path in config_roots if path.exists()]
    status_result = run_openclaw(openclaw_path, ["status"], timeout=12) if openclaw_path else None
    if status_result and status_result.returncode == 0:
        return CheckResult(
            id="config",
            label="OpenClaw 配置",
            ok=True,
            status="可用",
            detail="openclaw status 运行成功。",
            path=str(existing[0]) if existing else "",
        )
    if existing:
        detail = "检测到配置目录，但 openclaw status 未成功。"
        if status_result:
            detail += f" 错误：{trim_output(status_result.stderr or status_result.stdout)}"
        return CheckResult(
            id="config",
            label="OpenClaw 配置",
            ok=False,
            status="需要检查",
            detail=detail,
            path=str(existing[0]),
            actions=[{"label": "重新初始化 OpenClaw", "type": "guide", "command": "openclaw onboard"}],
        )
    return CheckResult(
        id="config",
        label="OpenClaw 配置",
        ok=False,
        status="未初始化",
        detail="未找到 ~/.openclaw 或 ~/.config/openclaw。",
        actions=[{"label": "开始首次配置", "type": "future", "command": "openclaw onboard"}],
    )


def detect_api_config(openclaw_path: str) -> CheckResult:
    env_keys = ["OPENAI_API_KEY", "DEEPSEEK_API_KEY", "KIMI_API_KEY", "MOONSHOT_API_KEY"]
    configured_env = [key for key in env_keys if os.getenv(key)]
    likely_config_files = []
    for config_root in openclaw_config_roots():
        if not config_root.exists():
            continue
        likely_config_files.extend([
            path for path in config_root.rglob("*")
            if path.is_file()
            and path.suffix.lower() in {".json", ".toml", ".yaml", ".yml", ".env"}
            and looks_like_api_config(path)
        ][:20])
    if configured_env:
        return CheckResult(
            id="api",
            label="模型/API 配置",
            ok=True,
            status="已检测到环境变量",
            detail=f"检测到 {', '.join(mask_key_name(key) for key in configured_env)}。",
        )
    if likely_config_files:
        return CheckResult(
            id="api",
            label="模型/API 配置",
            ok=True,
            status="可能已配置",
            detail="检测到 OpenClaw 配置文件。后续 API 配置页会读取/写入具体 provider。",
            path=str(likely_config_files[0]),
        )
    return CheckResult(
        id="api",
        label="模型/API 配置",
        ok=False,
        status="未配置",
        detail="未检测到 API Key。下一阶段会提供 App 内配置页。",
        actions=[{"label": "配置 API Key", "type": "future", "command": "打开模型/API 配置页"}],
    )


def detect_agents(openclaw_ok: bool) -> CheckResult:
    if not openclaw_ok:
        return CheckResult(
            id="agents",
            label="Agents",
            ok=False,
            status="无法读取",
            detail="OpenClaw 未就绪，暂时不能读取 agents。",
        )
    try:
        agents = listOpenClawAgents()
    except Exception as exc:
        return CheckResult(
            id="agents",
            label="Agents",
            ok=False,
            status="读取失败",
            detail=f"读取 OpenClaw agents 失败：{exc}",
        )
    if agents:
        return CheckResult(
            id="agents",
            label="Agents",
            ok=True,
            status=f"{len(agents)} 个",
            detail="已读取本机 OpenClaw agents。",
        )
    return CheckResult(
        id="agents",
        label="Agents",
        ok=False,
        status="暂无 Agent",
        detail="后续 Agent 管理页会支持直接创建第一个 Agent。",
        actions=[{"label": "创建第一个 Agent", "type": "future", "command": "打开 Agent 管理页"}],
    )


def build_summary(*checks: CheckResult) -> str:
    failed = [check.label for check in checks if not check.ok]
    if not failed:
        return "环境已就绪，可以创建 Agent 或启动会议。"
    return "还需要处理：" + "、".join(failed)


def build_next_steps(*checks: CheckResult) -> list[str]:
    steps = []
    for check in checks:
        if check.ok:
            continue
        if check.id == "python":
            steps.append("安装 Python 3.10+，或让 App 能找到 Miniforge/Conda/Homebrew Python。")
        elif check.id == "openclaw":
            steps.append("安装 OpenClaw CLI。")
        elif check.id == "config":
            steps.append("初始化 OpenClaw 配置。")
        elif check.id == "api":
            steps.append("配置模型 provider、API Key、Base URL 和默认模型。")
        elif check.id == "agents":
            steps.append("创建第一个 Agent。")
    return steps


def run_openclaw(path: str, args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str] | None:
    if not path:
        return None


def detect_bundled_runtime() -> dict[str, Any]:
    app_home = os.getenv("AGENTMEETING_HOME", "")
    bundled_python = os.getenv("AGENTMEETING_BUNDLED_PYTHON", "")
    bundled_node = os.getenv("AGENTMEETING_BUNDLED_NODE", "")
    bundled_openclaw = os.getenv("AGENT_MEETING_OPENCLAW_BIN") or os.getenv("AGENT_MEETTING_OPENCLAW_BIN", "")
    return {
        "appHome": app_home,
        "bundledPython": bundled_python,
        "bundledPythonExists": bool(bundled_python and Path(bundled_python).exists()),
        "bundledNode": bundled_node,
        "bundledNodeExists": bool(bundled_node and Path(bundled_node).exists()),
        "bundledOpenClaw": bundled_openclaw,
        "bundledOpenClawExists": bool(bundled_openclaw and Path(bundled_openclaw).exists()),
    }


def openclaw_config_roots() -> list[Path]:
    roots: list[Path] = []
    config_path = os.getenv("OPENCLAW_CONFIG_PATH", "").strip()
    state_dir = os.getenv("OPENCLAW_STATE_DIR", "").strip()
    openclaw_home = os.getenv("OPENCLAW_HOME", "").strip()
    app_home = os.getenv("AGENTMEETING_HOME", "").strip()
    if config_path:
        roots.append(Path(config_path).expanduser().parent)
    if state_dir:
        roots.append(Path(state_dir).expanduser())
    if openclaw_home:
        roots.append(Path(openclaw_home).expanduser())
    if app_home:
        roots.append(Path(app_home).expanduser() / "openclaw")
    if not app_home:
        roots.extend([
            Path.home() / ".openclaw",
            Path.home() / ".config" / "openclaw",
        ])
    unique = []
    seen = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            unique.append(root)
            seen.add(key)
    return unique
    try:
        return subprocess.run(
            [path, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "OPENCLAW_CLI_DISABLE_FANCY": "1"},
        )
    except Exception:
        return None


def read_python_version(path: str) -> str:
    try:
        result = subprocess.run(
            [path, "-c", "import sys; print('.'.join(map(str, sys.version_info[:3])))"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def read_command_version(command: list[str]) -> str:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=8)
    except Exception:
        return ""
    return trim_output(result.stdout or result.stderr)


def version_tuple(version: str) -> tuple[int, ...]:
    parts = []
    for item in version.split("."):
        try:
            parts.append(int(item))
        except ValueError:
            break
    return tuple(parts)


def trim_output(text: str, limit: int = 240) -> str:
    cleaned = " ".join((text or "").split())
    return cleaned[:limit]


def mask_key_name(name: str) -> str:
    if len(name) <= 6:
        return name
    return f"{name[:3]}...{name[-4:]}"


def looks_like_api_config(path: Path) -> bool:
    name = path.name.lower()
    if any(marker in name for marker in ["exec-approval", "session", "transcript", "cache"]):
        return False
    if any(marker in name for marker in ["api", "model", "provider", "gateway", "config", ".env"]):
        return True
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")[:4000].lower()
    except Exception:
        return False
    return any(marker in text for marker in ["api_key", "apikey", "base_url", "openai", "deepseek", "moonshot", "kimi"])
