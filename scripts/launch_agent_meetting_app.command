#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

OPENCLAW_BIN="${AGENT_MEETTING_OPENCLAW_BIN:-/opt/homebrew/bin/openclaw}"
if [[ ! -x "$OPENCLAW_BIN" ]]; then
  OPENCLAW_BIN="$(command -v openclaw || true)"
fi

if [[ -z "$OPENCLAW_BIN" ]]; then
  osascript -e 'display alert "OpenClaw 未检测到" message "请先安装或配置 openclaw，再启动 Agent Meeting。"'
  exit 1
fi

export AGENT_MEETTING_OPENCLAW_BIN="$OPENCLAW_BIN"
python3 -m agent_meetting app --host 127.0.0.1 --port 8765
