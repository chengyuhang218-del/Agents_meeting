from __future__ import annotations

import argparse
import json
from pathlib import Path

from .desktop_server import run_desktop_server
from .orchestrator import MainOrchestrator
from .registry import AgentRegistry
from .workspace import ProjectWorkspace


def main() -> None:
    parser = argparse.ArgumentParser(prog="agent-meetting")
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run a new research agent project")
    run_parser.add_argument("goal", help="Boss research goal")
    run_parser.add_argument("--projects-dir", default="projects", help="Project workspace root")
    run_parser.add_argument(
        "--search-mode",
        choices=["auto", "strict", "off"],
        default="auto",
        help="Search strategy: auto=filtered web/API search, strict=strong relevance filter, off=no network search",
    )
    run_parser.add_argument(
        "--search-backend",
        choices=["api", "browser", "hybrid"],
        default="api",
        help="Search backend: api=NCBI/Europe PMC/CrossRef, browser=local Chrome PubMed page, hybrid=browser then API fallback",
    )
    run_parser.add_argument(
        "--references",
        type=Path,
        help="Markdown/text file with trusted user-provided papers or notes to use as the evidence base",
    )

    subparsers.add_parser("list-agents", help="List registered agents")

    list_projects_parser = subparsers.add_parser("list-projects", help="List historical projects")
    list_projects_parser.add_argument("--projects-dir", default="projects", help="Project workspace root")

    show_parser = subparsers.add_parser("show-project", help="Show a project summary")
    show_parser.add_argument("project_id", help="Project id")
    show_parser.add_argument("--projects-dir", default="projects", help="Project workspace root")

    serve_parser = subparsers.add_parser("serve", help="Run the Agent Meeting Desktop workbench")
    serve_parser.add_argument("--host", default="127.0.0.1", help="Workbench host")
    serve_parser.add_argument("--port", type=int, default=8765, help="Workbench port")
    serve_parser.add_argument("--no-open", action="store_true", help="Do not open the browser automatically")

    app_parser = subparsers.add_parser("app", help="Run the workbench in an app-like desktop window")
    app_parser.add_argument("--host", default="127.0.0.1", help="Workbench host")
    app_parser.add_argument("--port", type=int, default=8765, help="Workbench port")

    args = parser.parse_args()

    if args.command == "run":
        registry = AgentRegistry.load()
        workspace = ProjectWorkspace(Path(args.projects_dir))
        project, report = MainOrchestrator(
            registry,
            workspace,
            search_mode=args.search_mode,
            search_backend=args.search_backend,
            references_path=args.references,
        ).run(args.goal)
        print(f"项目已完成: {project.project_id}")
        print(f"项目目录: {project.project_dir}")
        print(f"最终报告: {project.project_dir / 'final_report' / 'final_report.md'}")
        print()
        print(report)
        return

    if args.command == "list-agents":
        registry = AgentRegistry.load()
        for spec in registry.all():
            print(f"{spec.agent_id:10} {spec.name:18} {spec.role}")
        return

    if args.command == "list-projects":
        workspace = ProjectWorkspace(Path(args.projects_dir))
        for path in workspace.list_projects():
            meta_path = path / "project.json"
            if meta_path.exists():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                print(f"{meta['project_id']} | {meta['goal']} | team={','.join(meta['team'])}")
        return

    if args.command == "show-project":
        project_dir = Path(args.projects_dir) / args.project_id
        meta_path = project_dir / "project.json"
        report_path = project_dir / "final_report" / "final_report.md"
        if not meta_path.exists():
            raise SystemExit(f"Project not found: {args.project_id}")
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        print(f"项目: {meta['project_id']}")
        print(f"目标: {meta['goal']}")
        print(f"团队: {', '.join(meta['team'])}")
        if report_path.exists():
            print(f"最终报告: {report_path}")
        return

    if args.command == "serve":
        run_desktop_server(host=args.host, port=args.port, open_browser=not args.no_open)
        return

    if args.command == "app":
        run_desktop_server(host=args.host, port=args.port, open_browser=True, app_window=True)
        return


if __name__ == "__main__":
    main()
