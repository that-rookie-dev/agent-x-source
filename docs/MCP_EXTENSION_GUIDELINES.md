# MCP Extension — Community Submission Guidelines

Agent-X uses the **Model Context Protocol (MCP)** to extend its capabilities through modular servers that provide new tools. Anyone can build and publish MCP extensions.

---

## How MCP Extensions Work

An MCP extension is a standalone server process that communicates with Agent-X via **JSON-RPC 2.0 over stdio**. It exposes tools through two RPC methods:

| Method | Purpose |
|--------|---------|
| `tools/list` | Returns the list of available tools with their schemas |
| `tools/call` | Executes a tool with given arguments and returns results |

---

## Building an MCP Extension

### 1. Project Structure

```
my-mcp-extension/
├── package.json
├── tsconfig.json
├── src/
│   └── index.ts          # Main server entry point
└── README.md
```

### 2. Minimal Server (TypeScript)

```typescript
#!/usr/bin/env node
// src/index.ts
import { McpServer, type ToolDefinition } from '@agentx/mcp-servers/base-server';

class MyServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'my_tool',
        description: 'What this tool does',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input parameter' },
          },
          required: ['input'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'my_tool': {
        const input = String(args['input']);
        return { result: `Processed: ${input}` };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new MyServer().start();
```

### 3. Build

```bash
npm install && npm run build
```

### 4. Register in Agent-X

Add an entry to `~/.config/agentx/mcp.json`:

```json
{
  "my-extension": {
    "command": "node",
    "args": ["/path/to/my-mcp-extension/dist/index.js"],
    "enabled": true,
    "transport": "stdio",
    "permissionLevel": "medium"
  }
}
```

Or use the `/commands` interface (TBD) or PluginHub UI.

---

## Best Practices

- **One tool per logical operation** — don't overload a single tool with multiple modes
- **Use clear parameter names** — they become the LLM-facing API
- **Handle errors gracefully** — always return a structured response rather than crashing
- **Keep it stateless** — each `tools/call` should be independently runnable
- **Respect filesystem boundaries** — don't read/write outside allowed paths
- **Use permission levels appropriately**:
  - `low` — read-only, no side effects (e.g., search, math, datetime)
  - `medium` — writes files or makes network requests (e.g., filesystem, HTTP)
  - `critical` — executes arbitrary commands (e.g., shell)
- **Support streaming** — for long-running tools, return partial results incrementally

---

## Submission Checklist

Before submitting, verify your extension:

- [ ] Server starts and responds to `tools/list`
- [ ] Each tool works correctly with `tools/call`
- [ ] `package.json` has proper `bin` entry if intended for CLI use
- [ ] `README.md` describes all tools with example usage
- [ ] Tools handle invalid input gracefully (no crashes)
- [ ] No sensitive data is logged or exposed
- [ ] Permission level is set appropriately

---

## Publishing

1. Publish your package to npm:
   ```bash
   npm publish
   ```
2. Submit to the Agent-X Extension Marketplace by opening a PR at:
   `https://github.com/SlashpanOrg/agent-x-extensions`

   Your PR should include:
   - The npm package name
   - A brief description (50 words max)
   - A list of tools with descriptions
   - Screenshots or demos (if applicable)

3. Once reviewed, your extension will appear in the PluginHub Marketplace.

---

## Resources

- [MCP Protocol Spec](https://modelcontextprotocol.io/)
- [Agent-X MCP Servers](https://github.com/SlashpanOrg/agent-x/tree/main/source/packages/mcp-servers) — reference implementations
- [`McpServer` base class](https://github.com/SlashpanOrg/agent-x/blob/main/source/packages/mcp-servers/src/base-server.ts)

---

> ⚠️ Extensions run with the permissions you grant them. Always review third-party extensions before enabling.
