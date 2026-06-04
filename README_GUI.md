# Agent Meeting GUI

This is the desktop MVP for Agent Meetting.

It keeps the original CLI working and provides two GUI surfaces:

```bash
# 3D web workbench, recommended
python3 -m agent_meetting serve

# App-like desktop window
python3 -m agent_meetting app

# Lightweight Tkinter 2D fallback
python3 -m agent_meetting.gui
```

## What It Does

The web workbench uses a local Three.js scene:

- Six 3D office workstations in a 2x3 layout.
- Each active agent has a desk, monitor, simple chair, local brick-style minifigure worker, coffee cup, and color badge.
- The sixth desk is an empty "待入职" workstation and does not show a reviewer worker.
- Agents have unsynchronized idle motions: typing, looking around, coffee, away-from-desk posture, gym breaks, and occasional 英雄联盟-style screen idle.
- Monitors redraw live canvas screens for each role:
  - Literature: PubMed / Nature / Cell / Science search motion.
  - Paper: PDF reading, DOI panel, highlighted paper lines.
  - Bio: UMAP, volcano-style points, heatmap blocks.
  - Coding: VSCode / terminal / Python code scrolling.
- Current speaker is highlighted through a glowing ring, pulsing badge, raised posture, larger avatar, active monitor, and speech bubble.
- Meeting events from the orchestrator drive the active speaker.
- The room includes lightweight office props: whiteboard, bookshelf, plant, wall clock, door, and gym area.

The Tkinter fallback uses a simpler 2D canvas:

- Input a research question.
- Select participating agents:
  - Literature
  - Paper
  - Bio
  - Coding
- Click "一键开会".
- Watch a 2D office meeting room:
  - Agents sit around a table.
  - Current speaker is highlighted.
  - Speaking agent avatar flashes.
  - Short speech bubble appears above the speaker.
  - Right panel streams meeting notes.
- When complete, the final report path is shown.
- "打开项目目录" opens the generated project folder.

## Requirements

The GUI uses Python standard library `tkinter`.

On macOS with the system Python or conda/miniforge Python, this is usually available already.

Check it with:

```bash
python3 - <<'PY'
import tkinter
print("tkinter ok")
PY
```

If `tkinter` is missing in a custom Python environment, use a Python distribution that includes Tk support.

## Start GUI

Recommended 3D mode:

```bash
cd agent-meetting
python3 -m agent_meetting serve
```

Open the URL printed in the terminal, usually:

```text
http://127.0.0.1:8765
```

App-like desktop window:

```bash
cd agent-meetting
python3 -m agent_meetting app
```

This starts the same local workbench but opens it in a browser app window when Chrome, Chromium, or Microsoft Edge is available.

2D fallback mode:

```bash
cd agent-meetting
python3 -m agent_meetting.gui
```

## Original CLI Still Works

```bash
cd agent-meetting
python3 -m agent_meetting run "NF1突变在黑色素瘤中的作用机制"
```

## Recommended Search Settings

For stable GUI demos, use:

- Search mode: `off`
- Search backend: `api`
- Enter a meeting topic and let Main decide which agents to call.

This avoids unstable PubMed/NCBI network calls and lets the agents discuss your curated evidence.

If you want network supplementation:

- Search mode: `strict`
- Search backend: `api` or `browser`

Browser search requires Playwright and local Chrome, but it still depends on whether PubMed loads reliably on the machine.

## Output

Each meeting creates:

```text
projects/YYYYMMDD-HHMMSS-topic/
  project.json
  tasks/tasks.json
  discussions/meeting.jsonl
  files/*_result.md
  final_report/final_report.md
```

The GUI displays the final report path after `final_report_ready`.

## Event Stream

The GUI consumes events emitted by `MainOrchestrator`:

- `meeting_started`
- `phase_changed`
- `agent_started`
- `agent_message`
- `round_finished`
- `final_report_ready`
- `error`

These events are additive. They do not remove or change the existing project files.
