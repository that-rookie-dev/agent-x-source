# Web UI Wireframes & Component Map

Mermaid flow mapping of TUI stages → Web UI pages

```mermaid
flowchart TD
  Splash --> Provider[/Provider Selection\n(baseUrl + validate)/]
  Provider --> Credentials[/Credentials/]
  Credentials --> Models[/Model List + select/]
  Models --> Crew[/Create / Switch Crew/]
  Crew --> Telegram[/Telegram Token (submit / skip)/]
  Telegram --> Launch[/Launch / Start Agent Panel/]
  Launch --> Chat[/Chat Module (streaming)/]

  subgraph UI
    Provider
    Credentials
    Models
    Crew
    Telegram
    Launch
    Chat
  end
```

Components:
- `HealthPanel` : shows `/api/health` and agent status
- `ProviderForm` : provider selection and baseUrl validation
- `ModelList` : keyboard / click selectable list of models
- `CrewManager` : create/list/switch crews
- `TelegramForm` : token input + skip
- `LaunchPanel` : start/stop daemon / progress
- `Chat` : composer, message list, streaming via SSE / WebSocket
- `TraceViewer` : shows `/api/trace` (last 50 events)

Notes:
- For local-only UX prefer the agent to serve the UI to avoid CORS.
- Start with a minimal SPA and SSE-based chat for simplicity; upgrade to WebSocket later for richer features.
