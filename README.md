# Agent Meetting

Agent Meetting is a local OpenClaw multi-agent office. It reads agents already created on your machine, shows them in a browser UI, and lets you start multi-agent meetings, chat with one agent, stop running meetings, and review run results.

The app runs locally. It does not require committing OpenClaw credentials, API keys, Telegram config, sessions, or private workspace files.

## Features

- Read local OpenClaw agents automatically with `openclaw agents list --json`
- Browser-based 3D office view for meeting status
- One-click meeting where Main decides which agents to call
- Individual agent chat through OpenClaw CLI
- Run Queue for meetings, logs, agent messages, errors, and final reports
- Real literature/data search context through PubMed, Europe PMC, CrossRef, and GEO
- Real cancellation: stop button cancels the backend job and terminates OpenClaw subprocesses

## Screenshots

Place screenshots in:

```text
docs/screenshots/
```

Suggested files before publishing:

- `docs/screenshots/office.png`
- `docs/screenshots/run-queue.png`
- `docs/screenshots/agent-chat.png`

Screenshots are ignored by default except the folder placeholder. Remove or adjust `.gitignore` if you want to commit selected images.

## Install

```bash
git clone https://github.com/your-name/agent-meetting.git
cd agent-meetting
python3 -m pip install -e .
```

Optional browser-backed PubMed search:

```bash
python3 -m pip install "playwright>=1.44"
```

## Configure

Copy the example env file if you want explicit settings:

```bash
cp .env.example .env
```

Useful variables:

```bash
OPENCLAW_BIN=openclaw
OPENCLAW_AGENT_CONFIG_PATH=
SERVER_PORT=8765
FRONTEND_PORT=
DEFAULT_MEETING_ROUNDS=1
ENABLE_BROWSER_SEARCH=false
```

The current Python server reads `OPENCLAW_BIN` or `AGENT_MEETTING_OPENCLAW_BIN` when calling OpenClaw.

## Run

```bash
python3 -m agent_meetting serve --host 127.0.0.1 --port 8765
```

Then open the printed URL, usually:

```text
http://127.0.0.1:8765
```

App-like browser window:

```bash
python3 -m agent_meetting app --host 127.0.0.1 --port 8765
```

CLI meeting:

```bash
python3 -m agent_meetting run "Your research question"
```

## Connect Local OpenClaw

Install and configure OpenClaw first. Confirm it works:

```bash
openclaw status
openclaw agents list --json
```

Agent Meetting discovers agents in this order:

1. `openclaw agents list --json`
2. fallback to `~/.openclaw/agents/*`

The integration code lives in:

```text
agent_meetting/services/openclaw_service.py
```

Functions provided:

- `listOpenClawAgents()`
- `getOpenClawAgent(agentId)`
- `sendMessageToOpenClawAgent(agentId, message)`
- `startMeeting(participants, topic)`
- `stopMeeting(meetingId)`

Each agent is normalized to:

```json
{
  "id": "literature",
  "name": "LiteratureAgent",
  "role": "OpenClaw Agent",
  "description": "LiteratureAgent",
  "source": "openclaw",
  "status": "available"
}
```

## One-Click Meeting

1. Open the web UI.
2. Enter a meeting topic / research question.
3. Choose meeting rounds and search mode.
4. Main selects the participating agents automatically.
5. Click `启动会议`.

When a meeting starts, Main brings the required agents to the meeting room for task briefing, then agents return to workstations while OpenClaw calls run.

## Individual Agent Chat

1. Click an agent in the left sidebar.
2. Type a message in the single-agent chat panel.
3. The backend calls:

```bash
openclaw agent --agent <id> --message "<message>" --json
```

Chat history is stored in the current browser session state and also appears as a run type target for future extension.

## Run Queue

Run Queue shows:

- title
- status
- created time
- participants
- round count/current phase
- stopped/completed state
- logs
- agent messages
- final result
- error text

Click a run item to view details. Final reports render as Markdown and can be copied or opened as `.md` through the report endpoint.

## Stop A Meeting

Click `终止会议` or the Run Queue stop button.

The backend will:

- mark the job as cancelled/stopped
- set the job cancellation token
- terminate active OpenClaw subprocesses
- prevent later rounds from starting
- write a log event: `会议已被用户终止`

This is not just a UI hide operation.

## Outputs

Meetings write local project artifacts under:

```text
projects/YYYYMMDD-HHMMSS-topic/
  project.json
  tasks/tasks.json
  discussions/meeting.jsonl
  files/*_result.md
  final_report/final_report.md
```

`projects/` is ignored by Git because it contains local run output.

## Common Questions

### The UI says OpenClaw is missing

Check:

```bash
which openclaw
openclaw status
```

Set `OPENCLAW_BIN` if needed.

### Agents do not appear

Run:

```bash
openclaw agents list --json
```

If this fails, fix OpenClaw first. The app will fallback to `~/.openclaw/agents`, but CLI JSON is preferred.

### Literature/data search returns weak results

Use `search_mode=strict` for stronger filtering. Use `search_backend=hybrid` to combine browser PubMed and API search.

### Stop button does not stop immediately

The current OpenClaw subprocess is terminated by the backend cancellation token. A short delay can occur while the process receives SIGTERM/SIGKILL.

### Can I commit my OpenClaw config?

No. Never commit `~/.openclaw`, tokens, credentials, Telegram config, sessions, cache, or generated projects.

## Privacy Checklist Before GitHub

Check that these are not committed:

- `.env` and any API keys
- `projects/`
- `openclaw_workspace/`
- `~/.openclaw` or copied OpenClaw configs
- Telegram credentials or channel IDs
- session/transcript/cache files
- personal screenshots unless intentionally selected
- `.DS_Store`
