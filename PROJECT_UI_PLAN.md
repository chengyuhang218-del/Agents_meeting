# Agent Meeting GUI MVP Plan

## Current Project Structure

- `agent_meetting/cli.py`
  - Main command entry.
  - Existing CLI remains: `python3 -m agent_meetting run "研究问题"`.
  - Existing local web workbench command remains: `python3 -m agent_meetting serve`.

- `agent_meetting/orchestrator.py`
  - Core meeting pipeline.
  - Creates a project folder, generates keywords, prepares research context, assigns tasks, calls agents, runs discussion rounds, writes final report.
  - This should remain the single source of truth for meeting logic.

- `agent_meetting/agents.py`
  - OpenClaw adapter.
  - Calls real agents through `openclaw agent --agent <id> --message ... --json --thinking off`.
  - Includes retry/timeout handling.

- `agent_meetting/workspace.py`
  - Project output writer.
  - Writes:
    - `project.json`
    - `tasks/tasks.json`
    - `discussions/meeting.jsonl`
    - `files/*_result.md`
    - `final_report/final_report.md`

- `config/agents.json`
  - Agent registry.
  - Defines Literature / Paper / Bio / Coding and any future agents.

- `config/meeting_rules.json`
  - Task templates and discussion rules.
  - Lets new agents join the meeting without rewriting the pipeline.

## MVP GUI Choice

Use `tkinter` from the Python standard library.

Reasons:
- Python-first project.
- No heavy desktop dependency for MVP.
- Can run with `python3 -m agent_meetting.gui`.
- Easy 2D canvas animation for an "office meeting room" scene.
- Keeps the original CLI untouched.

PySide6/Tauri can be added later when the product shape is validated.

## Required Backend Changes

Keep `MainOrchestrator.run()` behavior but add optional parameters:

- `team_override: list[str] | None`
  - GUI can choose participating agents.
  - CLI can continue using automatic team selection.

- `event_callback: Callable[[dict], None] | None`
  - Emits streaming GUI events:
    - `meeting_started`
    - `phase_changed`
    - `agent_started`
    - `agent_message`
    - `round_finished`
    - `final_report_ready`
    - `error`

These events are additive and should not break CLI behavior.

## GUI Layout

Left/top controls:
- Research question input.
- Agent checkboxes:
  - Literature
  - Paper
  - Bio
  - Coding
- Search options:
  - `off`, `strict`, `auto`
  - `api`, `browser`, `hybrid`
- One-click meeting button.

Center:
- 2D office meeting room canvas.
- Meeting table and seats.
- Each agent has:
  - avatar circle
  - nameplate
  - seat highlight
  - speaking pulse animation
  - typing indicator while waiting.

Right:
- Live meeting minutes stream.
- Each event appended as text.

Bottom:
- Progress status:
  - preparing
  - round 1
  - discussion
  - summarizing
  - complete
- Final report path.
- Button to open output folder.

## Delivery Commands

Existing CLI:

```bash
python3 -m agent_meetting run "研究问题"
```

New GUI:

```bash
python3 -m agent_meetting.gui
```

## First-Stage Scope

Implement a working 2D MVP only:
- No 3D.
- No game engine.
- No complex packaging yet.
- Preserve project output format.
- Preserve existing CLI.
- Add `README_GUI.md` with setup and usage.
