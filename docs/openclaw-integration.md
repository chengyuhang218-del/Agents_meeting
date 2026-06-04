# OpenClaw Integration

Agent Meeting reads local OpenClaw agents at runtime. It never stores or commits
OpenClaw account credentials.

## Agent Discovery

Preferred command:

```bash
openclaw agents list --json
```

Fallback:

```text
~/.openclaw/agents/*
```

The backend normalizes each agent into:

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

## Agent Message Calls

Single-agent chat calls:

```bash
openclaw agent --agent <id> --message "<message>" --json
```

The implementation is centralized in:

```text
agent_meetting/services/openclaw_service.py
```

Exported functions:

- `listOpenClawAgents()`
- `getOpenClawAgent(agentId)`
- `sendMessageToOpenClawAgent(agentId, message)`
- `startMeeting(participants, topic)`
- `stopMeeting(meetingId)`

