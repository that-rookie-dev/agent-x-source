# Quickstart: Agent-X

## Prerequisites

- Node.js 20+ (`node --version`)
- pnpm 9+ (`pnpm --version`)
- A terminal with 256-color support (iTerm2, Alacritty, Windows Terminal, etc.)
- An AI provider API key (OpenAI, Anthropic, or Google) OR a local model running (Ollama, LM Studio)

## Installation

### Option A: npm (recommended)
```bash
npm install -g agentx
```

### Option B: curl
```bash
curl -fsSL https://agentx.dev/install.sh | sh
```

### Option C: Homebrew
```bash
brew install agentx
```

### Option D: Docker
```bash
docker run -it --rm -v $(pwd):/workspace agentx/agentx
```

## First Run

```bash
cd /path/to/your/project
agentx
```

### What happens on first run:

1. **Welcome screen** appears with Agent-X banner
2. **Setup wizard** launches automatically (detected: no configuration)
3. **Select provider** — navigate with ↑/↓ arrows, confirm with Enter:
   - OpenAI
   - Anthropic
   - Google (Gemini)
   - Ollama (local)
   - LM Studio (local)
4. **Enter credentials** — API key for cloud providers, or localhost URL for local
5. **Select model** — available models fetched and displayed in scrollable list
   - Navigate: ↑/↓ arrows
   - Select: Spacebar
   - Confirm: Enter
   - Cancel: Escape (with confirmation)
6. **Configuration saved** → Main TUI loads

### Subsequent runs:

```bash
agentx              # Start new session
agentx session abc  # Restore session by ID
agentx --version    # Show version
```

## Basic Usage

### Chatting
Type your message and press Enter. The agent processes with animated indicators and responds.

### Slash Commands
Type `/` to see all available commands:
- `/help` — Show available commands
- `/profile list` — List available profiles
- `/profile switch` — Change agent persona
- `/model` — Switch AI model
- `/sessions` — List previous sessions
- `/tools` — List available tools
- `/permissions` — View granted permissions
- `/clear` — Clear screen
- `/exit` — End session

### Token Tracking
The progress bar at the bottom shows real-time token usage:
```
[████████░░░░░░░░░░░░] 2,340 / 128,000 (1.8%)
```

### Permissions
When the agent needs to use a tool (e.g., read a file), you'll be prompted:
```
Agent wants to: Read file ./src/index.ts
[Allow Once] [Allow Always] [Deny]
```

Navigate with ←/→ arrows, confirm with Enter.

## Session Management

Every interaction creates a session. Sessions persist automatically.

```bash
# List recent sessions
# (inside TUI): /sessions

# Restore a specific session
agentx session Xk9mN2pQ
```

## File Structure

After setup, Agent-X creates:
```
~/.config/agentx/config.json      # Your preferences
~/.local/share/agentx/db/         # Session database
~/.local/share/agentx/secret-sauce/ # Agent personality (do not edit manually)
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Enter | Submit message / Confirm |
| ↑/↓ | Navigate lists |
| Space | Select item |
| Escape | Cancel / Close dropdown |
| Ctrl+C | Exit agent |
| Tab | Cycle focus |

## Scope Boundary

Agent-X only operates within the directory where it was launched. This is a security feature — the agent cannot access files outside your project folder.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No models available" | Check API key validity, verify internet connection |
| "Provider unreachable" | For local: ensure Ollama/LM Studio is running |
| Garbled output | Ensure terminal supports ANSI colors (try `TERM=xterm-256color`) |
| Slow animations | Check if terminal supports 30fps rendering |
| "Outside agent scope" | Agent can only access files in the launch directory |
