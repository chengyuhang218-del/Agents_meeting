This project keeps the production Python backend and static frontend under
`agent_meetting/`.

The `src/` tree is reserved as a documented target layout for future TypeScript
or component extraction:

- `src/frontend/components`
- `src/frontend/stores`
- `src/backend/services`
- `src/backend/routes`
- `src/shared`

Current GitHub-ready code lives in:

- `agent_meetting/desktop/` for the browser UI
- `agent_meetting/desktop_server.py` for HTTP routes
- `agent_meetting/services/` for OpenClaw and run queue service helpers

