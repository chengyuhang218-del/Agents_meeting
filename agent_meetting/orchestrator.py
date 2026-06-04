from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Callable, Any

from .agents import create_agent
from .meeting_rules import MeetingRules
from .models import AgentResult, AgentState, AgentStatus, Message, Project, Task
from .registry import AgentRegistry
from .research_tools import (
    Paper,
    build_search_instruction,
    extract_references,
    generate_keywords,
    search_research_context,
)
from .workspace import ProjectWorkspace


class MainOrchestrator:
    def __init__(
        self,
        registry: AgentRegistry,
        workspace: ProjectWorkspace,
        rules: MeetingRules | None = None,
        search_mode: str = "auto",
        search_backend: str = "api",
        references_path: Path | None = None,
        team_override: list[str] | None = None,
        event_callback: Callable[[dict[str, Any]], None] | None = None,
        cancel_checker: Callable[[], bool] | None = None,
    ) -> None:
        self.registry = registry
        self.workspace = workspace
        self.rules = rules or MeetingRules.load()
        self.search_mode = search_mode
        self.search_backend = search_backend
        self.references_path = references_path
        self.team_override = team_override
        self.event_callback = event_callback
        self.cancel_checker = cancel_checker

    def _check_cancelled(self) -> None:
        if self.cancel_checker and self.cancel_checker():
            raise RuntimeError("Meeting cancelled")

    def run(self, goal: str) -> tuple[Project, str]:
        self._check_cancelled()
        project = self._new_project(goal)
        self.workspace.create(project)
        self._emit("meeting_started", project_id=project.project_id, goal=goal, team=project.team)
        self._say(project, "boss", "main", goal, "request")
        self._say(project, "main", "boss",
                   f"已创建项目组：{'、'.join(project.team)}。\n"
                   f"系统将自动分派任务给各 Agent。Literature Agent 将在任务中搜索真实文献。",
                   "status")

        # ── Phase 0: Generate search keywords (no HTTP required) ──
        self._check_cancelled()
        keywords = generate_keywords(goal)
        self._emit("phase_changed", phase="preparing", content="关键词已生成，准备检索上下文")
        self._say(project, "main", "team",
                  "📡 关键词已生成，开始分派任务……",
                  "search_start")

        trusted_references = self._load_trusted_references()
        if self.search_mode == "off":
            search_message = "🔎 联网检索已关闭；Main Agent 将使用会议上下文。"
        else:
            search_message = (
                f"🔎 Main Agent 正在通过 PubMed / Europe PMC / CrossRef / GEO 做真实检索"
                f"（mode={self.search_mode}, backend={self.search_backend}）……"
            )
        self._say(project, "main", "team", search_message, "search_start")
        self._check_cancelled()
        research_context = search_research_context(
            goal,
            keywords,
            search_mode=self.search_mode,
            search_backend=self.search_backend,
            trusted_references=trusted_references,
        )
        research_markdown = research_context.to_markdown()
        research_artifact = self.workspace.write_research_context(project, research_markdown)
        results: dict[str, AgentResult] = {
            "research": AgentResult("research", "真实文献与数据检索上下文", research_markdown, [research_artifact])
        }
        self._say(project, "main", "team",
                  f"🔎 检索上下文完成：联网论文 {len(research_context.papers)} 篇，GEO 数据集 {len(research_context.datasets)} 个，"
                  f"过滤弱相关结果 {research_context.excluded_papers} 条。\n文件：{research_artifact}",
                  "search_done")
        self._emit(
            "agent_message",
            agent_id="main",
            title="检索上下文完成",
            content=f"联网论文 {len(research_context.papers)} 篇，GEO 数据集 {len(research_context.datasets)} 个。",
            artifact=research_artifact,
        )

        tasks = self._assign_tasks(goal, project.team, keywords)
        self.workspace.write_tasks(project, tasks)
        states = {agent_id: AgentState(agent_id, AgentStatus.ONLINE) for agent_id in project.team}

        # ── Round 1: 各 Agent 按顺序执行任务 ──
        for task in tasks:
            self._check_cancelled()
            self._emit("agent_started", agent_id=task.agent_id, phase="round_1", title=task.title)
            states[task.agent_id].status = AgentStatus.WORKING
            states[task.agent_id].current_task = task.instruction[:60]
            states[task.agent_id].progress = 20

            self._say(project, "main", task.agent_id,
                      f"任务：{task.title}\n{task.instruction}", "task")

            agent = create_agent(task.agent_id, project.project_id, self.registry, goal, self.cancel_checker)
            result = agent.run(goal, task, results)
            self._check_cancelled()
            artifact = self.workspace.write_agent_result(project, result.agent_id, result.content)
            result.artifacts.append(artifact)
            results[result.agent_id] = result

            task.status = "done"
            task.completed_at = datetime.now().isoformat()
            states[task.agent_id].status = AgentStatus.DONE
            states[task.agent_id].recent_message = result.title
            states[task.agent_id].progress = 100

            self._say(project, task.agent_id, "main",
                      f"✅ 完成：{result.title}\n文件：{artifact}", "result")
            self._emit(
                "agent_message",
                agent_id=result.agent_id,
                title=result.title,
                content=result.content,
                artifact=artifact,
            )

        # ── Extract references from literature agent's output ──
        self._check_cancelled()
        papers = self._extract_papers(project, results)
        self._save_references(project, papers)
        if papers:
            self._say(project, "main", "team",
                      f"📚 从 Literature Agent 输出中提取到 {len(papers)} 篇引用文献", "search_done")

        # ── Round 2: 多轮会议讨论 ──
        if len(project.team) >= 2:
            self._check_cancelled()
            self._emit("phase_changed", phase="discussion", content="进入交叉讨论")
            self._run_meeting_rounds(project, goal, project.team, results, tasks, states)

        self.workspace.write_tasks(project, tasks)
        self._check_cancelled()
        self._emit("phase_changed", phase="summarizing", content="正在生成最终报告")
        report = self._final_report(goal, project, tasks, results, states, papers)
        report_artifact = self.workspace.write_final_report(project, report)
        self._say(project, "main", "boss",
                  "🎯 所有 Agent 已完成任务和会议讨论，最终报告已生成。", "final")
        self._emit(
            "final_report_ready",
            project_id=project.project_id,
            report_path=str(project.project_dir / report_artifact),
            project_dir=str(project.project_dir),
            content="最终报告已生成",
        )
        return project, report

    def _extract_papers(self, project: Project, results: dict[str, AgentResult]) -> list[Paper]:
        """Extract paper references from all agent outputs."""
        papers: list[Paper] = []
        for aid, result in results.items():
            extracted = extract_references(result.content)
            papers.extend(extracted)
        # Deduplicate by DOI/PMID
        seen_doi: set[str] = set()
        seen_pmid: set[str] = set()
        seen_title: set[str] = set()
        unique: list[Paper] = []
        for p in papers:
            key = ""
            if p.doi and p.doi.lower() not in seen_doi:
                seen_doi.add(p.doi.lower())
                key = p.doi.lower()
            elif p.pmid and p.pmid not in seen_pmid:
                seen_pmid.add(p.pmid)
                key = p.pmid
            elif p.title:
                title_key = re.sub(r"[^a-z0-9]", "", p.title.lower())[:40]
                if title_key not in seen_title:
                    seen_title.add(title_key)
                    key = title_key
            if key:
                unique.append(p)
        return unique

    def _save_references(self, project: Project, papers: list[Paper]) -> None:
        """Save extracted references for use in final report."""
        ref_dir = project.project_dir / "files" / "references"
        ref_dir.mkdir(parents=True, exist_ok=True)

        lines = ["# Extracted References\n"]
        for i, p in enumerate(papers, 1):
            lines.append(f"{i}. **{p.title}** ({p.year})")
            if p.authors:
                lines.append(f"   {p.authors}")
            if p.journal:
                lines.append(f"   *{p.journal}*")
            if p.doi:
                lines.append(f"   DOI: {p.doi}")
            if p.pmid:
                lines.append(f"   PMID: {p.pmid}")
            if p.abstract:
                lines.append(f"   {p.abstract[:200]}...")
            lines.append("")
        (ref_dir / "references.md").write_text("\n".join(lines), encoding="utf-8")

    def _run_meeting_rounds(
        self,
        project: Project,
        goal: str,
        team: list[str],
        results: dict[str, AgentResult],
        tasks: list[Task],
        states: dict[str, AgentState],
    ) -> None:
        self._say(project, "main", "team", "📢 第一轮讨论开始：各 Agent 交叉提问和补充。", "meeting")

        for rule in self.rules.discussion_rounds:
            self._check_cancelled()
            sender = rule.sender
            recipient = rule.recipient
            instruction = rule.instruction
            if sender not in team or recipient not in team:
                continue
            self._emit("agent_started", agent_id=sender, phase="discussion", title=f"向 {recipient} 提问")
            states[sender].status = AgentStatus.WORKING
            states[sender].current_task = f"向 {recipient} 提问"

            agent = create_agent(sender, project.project_id, self.registry, goal, self.cancel_checker)
            context = self._build_discussion_context(goal, results)
            reply = agent._call(instruction, context)
            self._check_cancelled()
            self._say(project, sender, recipient, reply[:2000], "question")
            self.workspace.write_agent_result(project, f"discussion_{sender}_to_{recipient}", reply)
            states[sender].status = AgentStatus.DONE
            self._emit(
                "agent_message",
                agent_id=sender,
                title=f"{sender} → {recipient}",
                content=reply,
                artifact=f"files/discussion_{sender}_to_{recipient}_result.md",
            )

            if recipient in team:
                self._emit("agent_started", agent_id=recipient, phase="discussion", title=f"回答 {sender}")
                states[recipient].status = AgentStatus.WORKING
                states[recipient].current_task = f"回答 {sender} 的提问"

                recipient_agent = create_agent(recipient, project.project_id, self.registry, goal, self.cancel_checker)
                answer_ctx = self._build_discussion_context(goal, results) + f"\n\nQuestion from {sender}:\n{reply[:2000]}"
                answer = recipient_agent._call(f"Answer {sender}'s question above. Be specific.", answer_ctx)
                self._check_cancelled()
                self._say(project, recipient, sender, answer[:2000], "answer")
                self.workspace.write_agent_result(project, f"discussion_{recipient}_to_{sender}", answer)
                states[recipient].status = AgentStatus.DONE
                self._emit(
                    "agent_message",
                    agent_id=recipient,
                    title=f"{recipient} → {sender}",
                    content=answer,
                    artifact=f"files/discussion_{recipient}_to_{sender}_result.md",
                )
            self._emit("round_finished", phase="discussion", sender=sender, recipient=recipient)

        # Round 2: Final opinions
        self._say(project, "main", "team", "📢 第二轮讨论：最终意见汇总。", "meeting")
        for agent_id in team:
            self._check_cancelled()
            self._emit("agent_started", agent_id=agent_id, phase="final_opinion", title="总结最终意见")
            states[agent_id].status = AgentStatus.WORKING
            states[agent_id].current_task = "总结最终意见"

            agent = create_agent(agent_id, project.project_id, self.registry, goal, self.cancel_checker)
            ctx = self._build_discussion_context(goal, results, project)
            final_thought = agent._call(
                self.rules.final_instruction.format(agent_id=agent_id, goal=goal),
                ctx,
            )
            self._check_cancelled()
            self._say(project, agent_id, "main", final_thought[:2000], "final_opinion")
            self.workspace.write_agent_result(project, f"final_{agent_id}_opinion", final_thought)
            states[agent_id].status = AgentStatus.DONE
            self._emit(
                "agent_message",
                agent_id=agent_id,
                title=f"{agent_id} 最终意见",
                content=final_thought,
                artifact=f"files/final_{agent_id}_opinion_result.md",
            )

        self._say(project, "main", "team", "📢 会议讨论结束。", "meeting_end")

    def _build_discussion_context(
        self,
        goal: str,
        results: dict[str, AgentResult],
        project: Project | None = None,
    ) -> str:
        parts = [f"Project Goal: {goal}", ""]
        for aid, result in results.items():
            parts.append(f"=== {aid} ({result.title}) ===")
            parts.append(result.content[:1500])
        if project:
            discussion_parts: list[str] = []
            for path in sorted(project.project_dir.glob("files/discussion_*.md")):
                discussion_parts.append(f"=== {path.stem.replace('_result', '')} ===")
                discussion_parts.append(path.read_text(encoding="utf-8")[:1500])
            if discussion_parts:
                parts.append("")
                parts.append("## Current Meeting Discussion Records")
                parts.extend(discussion_parts)
        return "\n".join(parts)

    def _new_project(self, goal: str) -> Project:
        slug = re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff]+", "-", goal).strip("-")[:36]
        project_id = f"{self._timestamp_id()}-{slug or 'project'}"
        team = self.team_override or self.registry.select_team(goal)
        project_dir = self.workspace.root / project_id
        return Project(project_id=project_id, goal=goal, project_dir=project_dir, team=team)

    def _load_trusted_references(self) -> str:
        if not self.references_path:
            return ""
        path = self.references_path.expanduser()
        if not path.exists():
            return f"[Warning] Trusted references file not found: {path}"
        return path.read_text(encoding="utf-8")

    def _assign_tasks(
        self,
        goal: str,
        team: list[str],
        keywords: list[str],
    ) -> list[Task]:
        """Build task instructions."""
        variables = {
            "goal": goal,
            "search_instruction": build_search_instruction(keywords),
            "keywords": "; ".join(keywords),
        }
        tasks: list[Task] = []
        for index, agent_id in enumerate(team):
            rule = self.rules.task_for_agent(agent_id, variables)
            if rule:
                title = rule.title
                instruction = rule.instruction
                context_agents = rule.context_agents
            else:
                spec = self.registry.get(agent_id)
                title = f"{spec.name} 专项分析"
                responsibilities = "、".join(spec.responsibilities)
                output_format = "、".join(spec.output_format)
                instruction = (
                    f"Research goal: {goal}\n\n"
                    f"Role: {spec.role}\n"
                    f"Responsibilities: {responsibilities}\n"
                    f"Expected output: {output_format}\n\n"
                    f"Use the real search context and previous agent outputs when available. "
                    f"Produce a concrete professional contribution for the meeting."
                )
                context_agents = ["research"]
            tasks.append(
                Task(
                    task_id=f"task-{index + 1:02d}",
                    agent_id=agent_id,
                    title=title,
                    instruction=instruction,
                    context_agents=context_agents,
                )
            )
        return [
            task for task in tasks
        ]

    def _final_report(
        self,
        goal: str,
        project: Project,
        tasks: list[Task],
        results: dict[str, AgentResult],
        states: dict[str, AgentState],
        papers: list[Paper],
    ) -> str:
        task_lines = "\n".join(f"- **{task.agent_id}**: {task.title} ({task.status})" for task in tasks)
        state_lines = "\n".join(
            f"- **{agent_id}**: {state.status.value}, progress={state.progress}%"
            for agent_id, state in states.items()
        )

        # Discussion records
        seen_stems = set()
        discussion_sections: list[str] = []
        for f in sorted(project.project_dir.glob("files/discussion_*.md")):
            stem = f.stem.replace("_result", "")
            base = stem
            if base in seen_stems:
                continue
            seen_stems.add(base)
            content = f.read_text(encoding="utf-8")
            discussion_sections.append(f"### {base}\n\n{content}")
        discussion_text = "\n\n---\n\n".join(discussion_sections) if discussion_sections else "（无讨论记录）"

        # Final opinions
        opinion_files: list[Path] = []
        for f in sorted(project.project_dir.glob("files/final_*.md")):
            stem = f.stem.replace("_result", "")
            if not any(stem == other.stem.replace("_result", "") for other in opinion_files):
                opinion_files.append(f)
        opinion_sections = []
        for f in opinion_files:
            content = f.read_text(encoding="utf-8")
            label = f.stem.replace("_result", "").replace("final_", "").replace("_opinion", "")
            opinion_sections.append(f"## {label.upper()} 最终意见\n\n{content}")
        opinions_text = "\n\n---\n\n".join(opinion_sections) if opinion_sections else ""

        # Agent results
        result_sections = "\n\n---\n\n".join(
            f"## {result.title}（{result.agent_id}）\n\n{result.content}"
            for result in results.values()
        )

        # Reference list (extracted from literature agent output)
        ref_sections = []
        if papers:
            ref_lines = ["## 论文引用列表（从 Literature Agent 输出中提取）\n"]
            for i, p in enumerate(papers, 1):
                ref_lines.append(
                    f"{i}. **{p.title}**  \n"
                    f"   {p.authors or '—'}  \n"
                    f"   *{p.journal}* ({p.year})  \n"
                    f"   DOI: {p.doi or 'N/A'} | PMID: {p.pmid or 'N/A'}"
                )
            ref_sections.append("\n".join(ref_lines))
        references_text = "\n\n---\n\n".join(ref_sections) if ref_sections else ""

        return f"""# 🧪 Agent Meetting — 最终研究报告

> **项目名称**: {goal}
> **项目 ID**: {project.project_id}
> **团队**: {'、'.join(project.team)}

---

## 一、执行总结

Boss 目标：**{goal}**

Main Agent 自动完成：关键词生成 → 任务分配 → 多 Agent 执行（Literature Agent 使用 MCP 工具检索真实文献）
→ 多轮交叉讨论 → 报告汇总。

**引用文献**: {len(papers)} 篇（从 Literature Agent 输出中提取）

---

## 二、任务完成情况

{task_lines}

## 三、Agent 状态

{state_lines}

---

## 四、会议讨论记录

{discussion_text}

---

## 五、最终意见汇总

{opinions_text}

---

## 六、Agent 详细输出

{result_sections}

---

## 七、参考文献

{references_text}

---

*报告由 Agent Meetting v0.2.0 生成 | {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}*
"""

    def _say(self, project: Project, sender: str, recipient: str,
             content: str, message_type: str = "discussion") -> None:
        self.workspace.append_message(project, Message(
            sender=sender, recipient=recipient, content=content,
            message_type=message_type,
        ))

    def _emit(self, event_type: str, **payload: Any) -> None:
        if not self.event_callback:
            return
        event = {
            "type": event_type,
            "created_at": datetime.now().isoformat(),
            **payload,
        }
        self.event_callback(event)

    @staticmethod
    def _timestamp_id() -> str:
        return datetime.now().strftime("%Y%m%d-%H%M%S")
