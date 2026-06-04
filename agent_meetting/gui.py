from __future__ import annotations

import queue
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, ttk
from typing import Any

from .meeting_rules import MeetingRules
from .orchestrator import MainOrchestrator
from .registry import AgentRegistry
from .workspace import ProjectWorkspace


REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECTS_DIR = REPO_ROOT / "projects"
AGENT_IDS = ["literature", "paper", "bio", "coding"]
AGENT_LABELS = {
    "literature": "Literature",
    "paper": "Paper",
    "bio": "Bio",
    "coding": "Coding",
    "main": "Main",
}
AGENT_COLORS = {
    "literature": "#2f7d68",
    "paper": "#456aa8",
    "bio": "#9a6b13",
    "coding": "#7a4e91",
    "main": "#2d3b42",
}


class AgentMeetingGUI(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Agent Meeting Office")
        self.geometry("1220x780")
        self.minsize(1080, 700)

        self.event_queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self.agent_vars: dict[str, tk.BooleanVar] = {}
        self.agent_items: dict[str, dict[str, int]] = {}
        self.current_agent = ""
        self.pulse = 0
        self.running = False
        self.report_path = ""
        self.project_dir = ""

        self._build_ui()
        self._draw_room()
        self.after(120, self._drain_events)
        self.after(180, self._animate)

    def _build_ui(self) -> None:
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        header = ttk.Frame(self, padding=(14, 12))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="Agent Meeting Office", font=("Helvetica", 20, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(header, text="一句话发起任务，多 Agent 在办公室里开会协作").grid(row=1, column=0, sticky="w")
        ttk.Button(header, text="打开项目目录", command=self._open_project_dir).grid(row=0, column=1, rowspan=2, padx=(10, 0))

        body = ttk.Frame(self, padding=(14, 0, 14, 12))
        body.grid(row=1, column=0, sticky="nsew")
        body.columnconfigure(1, weight=1)
        body.columnconfigure(2, weight=1)
        body.rowconfigure(0, weight=1)

        controls = ttk.Frame(body, padding=12)
        controls.grid(row=0, column=0, sticky="nsw", padx=(0, 12))
        controls.columnconfigure(0, weight=1)

        ttk.Label(controls, text="研究问题", font=("Helvetica", 13, "bold")).grid(row=0, column=0, sticky="w")
        self.goal_text = tk.Text(controls, width=34, height=6, wrap="word")
        self.goal_text.grid(row=1, column=0, sticky="ew", pady=(6, 12))
        self.goal_text.insert("1.0", "NF1突变在黑色素瘤中的作用机制")

        ttk.Label(controls, text="搜索设置", font=("Helvetica", 13, "bold")).grid(row=2, column=0, sticky="w")
        self.search_mode = tk.StringVar(value="off")
        self.search_backend = tk.StringVar(value="api")
        ttk.Combobox(
            controls,
            textvariable=self.search_mode,
            values=["off", "strict", "auto"],
            state="readonly",
            width=16,
        ).grid(row=3, column=0, sticky="ew", pady=(6, 6))
        ttk.Combobox(
            controls,
            textvariable=self.search_backend,
            values=["api", "browser", "hybrid"],
            state="readonly",
            width=16,
        ).grid(row=4, column=0, sticky="ew", pady=(0, 12))

        self.start_button = ttk.Button(controls, text="一键开会", command=self._start_meeting)
        self.start_button.grid(row=5, column=0, sticky="ew")

        room_frame = ttk.Frame(body)
        room_frame.grid(row=0, column=1, sticky="nsew", padx=(0, 12))
        room_frame.rowconfigure(0, weight=1)
        room_frame.columnconfigure(0, weight=1)
        self.canvas = tk.Canvas(room_frame, bg="#eef2f1", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        notes_frame = ttk.Frame(body, padding=12)
        notes_frame.grid(row=0, column=2, sticky="nsew")
        notes_frame.rowconfigure(1, weight=1)
        notes_frame.columnconfigure(0, weight=1)
        ttk.Label(notes_frame, text="会议纪要流", font=("Helvetica", 13, "bold")).grid(row=0, column=0, sticky="w")
        self.notes = tk.Text(notes_frame, width=42, wrap="word", state="disabled")
        self.notes.grid(row=1, column=0, sticky="nsew", pady=(8, 0))

        footer = ttk.Frame(self, padding=(14, 0, 14, 12))
        footer.grid(row=2, column=0, sticky="ew")
        footer.columnconfigure(1, weight=1)
        ttk.Label(footer, text="进度").grid(row=0, column=0, sticky="w")
        self.progress_var = tk.StringVar(value="准备中")
        ttk.Label(footer, textvariable=self.progress_var).grid(row=0, column=1, sticky="w", padx=(8, 0))
        self.report_var = tk.StringVar(value="最终报告：尚未生成")
        ttk.Label(footer, textvariable=self.report_var).grid(row=1, column=0, columnspan=2, sticky="w", pady=(6, 0))

    def _draw_room(self) -> None:
        self.canvas.delete("all")
        width = max(self.canvas.winfo_width(), 620)
        height = max(self.canvas.winfo_height(), 560)
        self.canvas.create_rectangle(0, 0, width, height, fill="#eef2f1", outline="")
        self.canvas.create_rectangle(44, 44, width - 44, height - 44, fill="#ffffff", outline="#d8e0dd", width=2)
        self.canvas.create_text(64, 66, anchor="w", text="Office Meeting Room", font=("Helvetica", 18, "bold"), fill="#1b2428")

        cx, cy = width // 2, height // 2 + 20
        self.canvas.create_oval(cx - 170, cy - 82, cx + 170, cy + 82, fill="#d7e4df", outline="#b5c7c0", width=3)
        self.canvas.create_oval(cx - 124, cy - 52, cx + 124, cy + 52, fill="#f7faf9", outline="#c8d6d1")

        seats = {
            "literature": (cx - 230, cy - 110),
            "paper": (cx + 230, cy - 110),
            "bio": (cx - 230, cy + 118),
            "coding": (cx + 230, cy + 118),
            "main": (cx, cy - 170),
        }
        self.agent_items.clear()
        for agent_id, (x, y) in seats.items():
            self._draw_agent(agent_id, x, y)

    def _draw_agent(self, agent_id: str, x: int, y: int) -> None:
        color = AGENT_COLORS.get(agent_id, "#456")
        seat = self.canvas.create_oval(x - 50, y - 42, x + 50, y + 42, fill="#edf3f1", outline="#cbd9d5", width=2)
        avatar = self.canvas.create_oval(x - 30, y - 34, x + 30, y + 26, fill=color, outline="#ffffff", width=3)
        name = self.canvas.create_text(x, y + 49, text=AGENT_LABELS.get(agent_id, agent_id), font=("Helvetica", 12, "bold"), fill="#1b2428")
        bubble = self.canvas.create_text(
            x,
            y - 66,
            text="",
            width=170,
            font=("Helvetica", 10),
            fill="#1b2428",
            justify="center",
        )
        self.agent_items[agent_id] = {"seat": seat, "avatar": avatar, "name": name, "bubble": bubble}

    def _start_meeting(self) -> None:
        if self.running:
            return
        goal = self.goal_text.get("1.0", "end").strip()
        if not goal:
            messagebox.showwarning("缺少研究问题", "请先输入研究问题。")
            return
        self.running = True
        self.start_button.configure(state="disabled")
        self.notes.configure(state="normal")
        self.notes.delete("1.0", "end")
        self.notes.configure(state="disabled")
        self.progress_var.set("准备中")
        self.report_var.set("最终报告：生成中")
        self.report_path = ""
        self.project_dir = ""
        self._append_note("Main", f"会议启动：{goal}")

        thread = threading.Thread(
            target=self._run_meeting_thread,
            args=(goal, []),
            daemon=True,
        )
        thread.start()

    def _run_meeting_thread(self, goal: str, selected_agents: list[str]) -> None:
        try:
            registry = AgentRegistry.load()
            workspace = ProjectWorkspace(PROJECTS_DIR)
            orchestrator = MainOrchestrator(
                registry,
                workspace,
                rules=MeetingRules.load(),
                search_mode=self.search_mode.get(),
                search_backend=self.search_backend.get(),
                team_override=selected_agents,
                event_callback=self.event_queue.put,
            )
            orchestrator.run(goal)
        except Exception as exc:
            self.event_queue.put({"type": "error", "content": str(exc)})

    def _drain_events(self) -> None:
        while True:
            try:
                event = self.event_queue.get_nowait()
            except queue.Empty:
                break
            self._handle_event(event)
        self.after(120, self._drain_events)

    def _handle_event(self, event: dict[str, Any]) -> None:
        event_type = event.get("type", "")
        if event_type == "meeting_started":
            self.progress_var.set("准备中")
            self._append_note("Main", f"项目已创建：{event.get('project_id')}")
        elif event_type == "phase_changed":
            phase = str(event.get("phase", ""))
            labels = {
                "preparing": "准备中",
                "discussion": "交叉讨论中",
                "summarizing": "汇总中",
            }
            self.progress_var.set(labels.get(phase, phase))
            self._append_note("Main", str(event.get("content", "")))
        elif event_type == "agent_started":
            agent_id = str(event.get("agent_id", "main"))
            self.current_agent = agent_id
            self.progress_var.set(str(event.get("title", "发言中")))
            self._set_bubble(agent_id, "typing...")
        elif event_type == "agent_message":
            agent_id = str(event.get("agent_id", "main"))
            title = str(event.get("title", agent_id))
            content = str(event.get("content", ""))
            self.current_agent = agent_id
            self._set_bubble(agent_id, self._shorten(content))
            self._append_note(title, content)
        elif event_type == "round_finished":
            self.progress_var.set("本轮讨论完成")
        elif event_type == "final_report_ready":
            self.running = False
            self.start_button.configure(state="normal")
            self.current_agent = ""
            self.report_path = str(event.get("report_path", ""))
            self.project_dir = str(event.get("project_dir", ""))
            self.progress_var.set("完成")
            self.report_var.set(f"最终报告：{self.report_path}")
            self._append_note("Main", f"最终报告已生成：{self.report_path}")
        elif event_type == "error":
            self.running = False
            self.start_button.configure(state="normal")
            self.current_agent = ""
            self.progress_var.set("错误")
            self._append_note("Error", str(event.get("content", "")))

    def _animate(self) -> None:
        self.pulse = (self.pulse + 1) % 12
        for agent_id, items in self.agent_items.items():
            active = agent_id == self.current_agent
            seat_color = "#d3eee5" if active else "#edf3f1"
            outline = AGENT_COLORS.get(agent_id, "#456") if active else "#cbd9d5"
            width = 4 if active else 2
            avatar_width = 5 if active and self.pulse < 6 else 3
            self.canvas.itemconfigure(items["seat"], fill=seat_color, outline=outline, width=width)
            self.canvas.itemconfigure(items["avatar"], width=avatar_width)
        self.after(180, self._animate)

    def _set_bubble(self, agent_id: str, text: str) -> None:
        if agent_id not in self.agent_items:
            return
        self.canvas.itemconfigure(self.agent_items[agent_id]["bubble"], text=text)

    def _append_note(self, title: str, content: str) -> None:
        self.notes.configure(state="normal")
        self.notes.insert("end", f"\n[{title}]\n{content[:1600]}\n")
        self.notes.see("end")
        self.notes.configure(state="disabled")

    def _shorten(self, text: str) -> str:
        clean = " ".join(text.split())
        return clean[:120] + ("..." if len(clean) > 120 else "")

    def _open_project_dir(self) -> None:
        path = self.project_dir or str(PROJECTS_DIR)
        subprocess.run(["open", path], check=False)


def main() -> None:
    app = AgentMeetingGUI()
    app.mainloop()


if __name__ == "__main__":
    main()
