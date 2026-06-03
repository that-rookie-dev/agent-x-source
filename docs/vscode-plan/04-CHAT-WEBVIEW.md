# Phase 4: Chat Webview — Sidebar UI, Message Rendering, Streaming, Tool Cards

> **Status**: ⬜ Not Started
> **Depends on**: Phase 3 (Extension Core)
> **Estimated Effort**: 5–7 days
> **Files Created**: `packages/vscode/src/webview/ChatViewProvider.ts`, `packages/vscode/src/webview/ui/**`, `packages/vscode/src/webview/protocol.ts`

---

## Overview

Phase 4 implements the chat sidebar webview — the primary user interface for the Agent-X VS Code extension. The webview runs in a sandboxed browser context (no Node.js APIs) and communicates with the extension host via `postMessage` / `onDidReceiveMessage`. Engine events from Phase 2's EventBridge are forwarded to the webview, which renders messages, streaming content, tool execution cards, permission prompts, plan approval UI, sub-agent progress, reasoning glimpses, TODO lists, and diff previews.

The webview is built with React, uses `marked` for Markdown rendering, `highlight.js` for syntax highlighting, and fully supports VS Code's light/dark themes via CSS custom properties.

---

## Task Index

| Task ID | Title | Status | Dependencies |
|---------|-------|--------|-------------|
| T4.1 | WebviewViewProvider | ⬜ | Phase 3 |
| T4.2 | Webview HTML Shell | ⬜ | T4.1 |
| T4.3 | Webview React App Setup | ⬜ | T4.2 |
| T4.4.1 | ChatContainer | ⬜ | T4.3 |
| T4.4.2 | MessageBubble | ⬜ | T4.3 |
| T4.4.3 | StreamingMessage | ⬜ | T4.3 |
| T4.4.4 | ToolCard | ⬜ | T4.3 |
| T4.4.5 | PermissionModal | ⬜ | T4.3 |
| T4.4.6 | PlanView | ⬜ | T4.3 |
| T4.4.7 | SubAgentCard | ⬜ | T4.3 |
| T4.4.8 | ReasoningIndicator | ⬜ | T4.3 |
| T4.4.9 | TodoPanel | ⬜ | T4.3 |
| T4.4.10 | DiffPreview | ⬜ | T4.3 |
| T4.4.11 | InputArea | ⬜ | T4.3 |
| T4.4.12 | StatusBar | ⬜ | T4.3 |
| T4.4.13 | ErrorBanner | ⬜ | T4.3 |
| T4.4.14 | WelcomeScreen | ⬜ | T4.3 |
| T4.5 | Webview CSS | ⬜ | T4.2 |
| T4.6 | Message Protocol | ⬜ | T4.1 |
| T4.7 | Markdown + Code Highlighting | ⬜ | T4.3 |
| T4.8 | Verification | ⬜ | All above |

---

## T4.1: WebviewViewProvider

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/webview/ChatViewProvider.ts`
**Estimated Effort**: 6 hours

### T4.1.1: Class Skeleton and Constructor

```typescript
// packages/vscode/src/webview/ChatViewProvider.ts

import * as vscode from "vscode";
import { EventBridge } from "../adapter/EventBridge";
import { EngineLifecycle } from "../adapter/EngineLifecycle";
import { ConfigBridge } from "../adapter/ConfigBridge";

type MessageHandler = (data: unknown) => void;

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "agentx.chatView";

  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];
  private messageHandlers = new Map<string, MessageHandler[]>();
  private pendingMessages: Array<{ type: string; data: unknown }> = [];
  private webviewReady = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly engineLifecycle: EngineLifecycle,
    private readonly eventBridge: EventBridge,
    private readonly configBridge: ConfigBridge
  ) {}
```

**Acceptance Criteria**:
- Implements `vscode.WebviewViewProvider`
- Constructor accepts `extensionUri`, `EngineLifecycle`, `EventBridge`, `ConfigBridge`
- `pendingMessages` buffer stores messages sent before webview is ready
- `messageHandlers` map stores registered handlers by message type

---

### T4.1.2: `resolveWebviewView()` — Full Implementation

```typescript
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: { type: string; data: unknown }) => {
        this.handleWebviewMessage(message.type, message.data);
      },
      undefined,
      this.disposables
    );

    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.webviewReady = false;
      for (const d of this.disposables) {
        d.dispose();
      }
      this.disposables = [];
    }, undefined, this.disposables);

    this.wireEventBridge();
  }
```

**Acceptance Criteria**:
- `enableScripts: true` allows JavaScript execution in the webview
- `localResourceRoots` restricts resource loading to `dist/webview` and `media`
- HTML generated via `getHtmlForWebview()`
- Message listener registered via `onDidReceiveMessage`
- Disposal handled correctly — `view` set to `undefined`, all disposables disposed
- EventBridge wired to forward engine events to webview

---

### T4.1.3: HTML Generation with CSP

```typescript
  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "index.css")
    );
    const nonce = this.generateNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: https:; connect-src https:;">
  <link href="${styleUri}" rel="stylesheet">
  <title>Agent-X Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
```

**Acceptance Criteria**:
- CSP restricts `default-src` to `'none'` — no resources loaded by default
- `style-src` allows VS Code's CSP source and `'unsafe-inline'` (needed for dynamic styles)
- `script-src` only allows scripts with the generated nonce
- `font-src` allows VS Code's CSP source (for codicons)
- `img-src` allows VS Code's CSP source, data URIs, and HTTPS
- `connect-src` allows HTTPS
- Script and style URIs use `asWebviewUri()` for correct resolution
- Nonce is unique per webview load

---

### T4.1.4: Nonce Generation

```typescript
  private generateNonce(): string {
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let nonce = "";
    for (let i = 0; i < 32; i++) {
      nonce += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return nonce;
  }
```

**Acceptance Criteria**:
- Generates a 32-character alphanumeric string
- Used as the CSP nonce for script execution
- Unique per call (sufficient entropy for CSP)

---

### T4.1.5: Message Passing — `postToWebview()` and `onWebviewMessage()`

```typescript
  postToWebview(type: string, data: unknown): void {
    if (!this.view || !this.webviewReady) {
      this.pendingMessages.push({ type, data });
      return;
    }
    this.view.webview.postMessage({ type, data });
  }

  onWebviewMessage(type: string, handler: MessageHandler): vscode.Disposable {
    const handlers = this.messageHandlers.get(type) || [];
    handlers.push(handler);
    this.messageHandlers.set(type, handlers);
    return new vscode.Disposable(() => {
      const current = this.messageHandlers.get(type) || [];
      const idx = current.indexOf(handler);
      if (idx >= 0) current.splice(idx, 1);
    });
  }

  private handleWebviewMessage(type: string, data: unknown): void {
    if (type === "ready") {
      this.webviewReady = true;
      this.flushPendingMessages();
    }
    const handlers = this.messageHandlers.get(type) || [];
    for (const handler of handlers) {
      handler(data);
    }
  }

  private flushPendingMessages(): void {
    for (const msg of this.pendingMessages) {
      this.postToWebview(msg.type, msg.data);
    }
    this.pendingMessages = [];
  }
```

**Acceptance Criteria**:
- `postToWebview()` buffers messages when webview is not ready
- `onWebviewMessage()` registers handlers and returns a `Disposable` for cleanup
- `handleWebviewMessage()` dispatches to all registered handlers
- `ready` message from webview triggers flushing of pending messages
- After flush, `pendingMessages` array is cleared

---

### T4.1.6: EventBridge Wiring

```typescript
  private wireEventBridge(): void {
    this.eventBridge.onMessageSent((msg) => {
      this.postToWebview("appendMessage", {
        id: msg.id,
        role: "user",
        content: msg.content,
        timestamp: msg.timestamp,
      });
    });

    this.eventBridge.onMessageReceived((msg) => {
      this.postToWebview("appendMessage", {
        id: msg.id,
        role: "assistant",
        content: msg.content,
        timestamp: msg.timestamp,
        tokenCost: msg.tokenCost,
      });
    });

    this.eventBridge.onStreamChunk((chunk) => {
      this.postToWebview("updateStream", {
        content: chunk.content,
        fullContent: chunk.fullContent,
      });
    });

    this.eventBridge.onStreamStart(() => {
      this.postToWebview("streamStart", {});
    });

    this.eventBridge.onStreamEnd(() => {
      this.postToWebview("streamEnd", {});
    });

    this.eventBridge.onToolExecuting((tool) => {
      this.postToWebview("toolExecuting", {
        tool: tool.tool,
        description: tool.description,
        startTime: tool.startTime,
      });
    });

    this.eventBridge.onToolComplete((tool) => {
      this.postToWebview("toolComplete", {
        tool: tool.tool,
        result: tool.result,
        elapsed: tool.elapsed,
      });
    });

    this.eventBridge.onPermissionRequired((perm) => {
      this.postToWebview("permissionRequired", {
        requestId: perm.requestId,
        tool: perm.tool,
        path: perm.path,
        riskLevel: perm.riskLevel,
        description: perm.description,
      });
    });

    this.eventBridge.onPlanGenerated((plan) => {
      this.postToWebview("planUpdate", {
        action: "generated",
        plan: plan.plan,
        userRequest: plan.userRequest,
      });
    });

    this.eventBridge.onPlanStepUpdate((step) => {
      this.postToWebview("planUpdate", {
        action: "stepUpdate",
        stepId: step.stepId,
        planId: step.planId,
        status: step.status,
        result: step.result,
        error: step.error,
      });
    });

    this.eventBridge.onSubAgentUpdate((agent) => {
      this.postToWebview("subAgentUpdate", agent);
    });

    this.eventBridge.onReasoningGlimpse((glimpse) => {
      this.postToWebview("reasoningUpdate", {
        action: "glimpse",
        text: glimpse.text,
      });
    });

    this.eventBridge.onReasoningStart(() => {
      this.postToWebview("reasoningUpdate", { action: "start" });
    });

    this.eventBridge.onReasoningComplete(() => {
      this.postToWebview("reasoningUpdate", { action: "complete" });
    });

    this.eventBridge.onTodoUpdate((items) => {
      this.postToWebview("todoUpdate", { items });
    });

    this.eventBridge.onDiffPreview((diff) => {
      this.postToWebview("diffPreview", diff);
    });

    this.eventBridge.onError((error) => {
      this.postToWebview("error", error);
    });

    this.eventBridge.onTokenUsage((usage) => {
      this.postToWebview("statusUpdate", {
        tokens: usage,
        provider: this.configBridge.getActiveProvider(),
        model: this.configBridge.getActiveModel(),
      });
    });

    this.eventBridge.onLoadingStart((stage) => {
      this.postToWebview("loadingStart", { stage });
    });

    this.eventBridge.onLoadingEnd(() => {
      this.postToWebview("loadingEnd", {});
    });

    this.eventBridge.onSessionRestored((session) => {
      this.postToWebview("sessionRestored", {
        messages: session.messages,
        title: session.title,
      });
    });

    this.eventBridge.onSessionCleared(() => {
      this.postToWebview("clearMessages", {});
    });
  }
```

**Acceptance Criteria**:
- All engine events from EventBridge are mapped to webview messages
- Each event uses the correct message type matching the protocol defined in T4.6
- Permission, plan, sub-agent, reasoning, TODO, diff, error, token, loading, and session events all forwarded
- Messages buffered via `postToWebview()` if webview is not yet ready

---

### T4.1.7: Webview to Extension Host Message Handlers

```typescript
  wireExtensionHostHandlers(): void {
    this.onWebviewMessage("sendMessage", async (data) => {
      const { content } = data as { content: string };
      await this.engineLifecycle.sendMessage(content);
    });

    this.onWebviewMessage("cancelProcessing", async () => {
      await this.engineLifecycle.cancelCurrentTask();
    });

    this.onWebviewMessage("permissionRespond", async (data) => {
      const { requestId, decision } = data as {
        requestId: string;
        decision: "allow-once" | "allow-always" | "deny";
      };
      await this.engineLifecycle.respondToPermission(requestId, decision);
    });

    this.onWebviewMessage("planApprove", async (data) => {
      const { planId } = data as { planId: string };
      await this.engineLifecycle.approvePlan(planId);
    });

    this.onWebviewMessage("planReject", async (data) => {
      const { planId } = data as { planId: string };
      await this.engineLifecycle.rejectPlan(planId);
    });

    this.onWebviewMessage("stepApprove", async (data) => {
      const { stepId, planId } = data as { stepId: string; planId: string };
      await this.engineLifecycle.approvePlanStep(planId, stepId);
    });

    this.onWebviewMessage("stepSkip", async (data) => {
      const { stepId, planId } = data as { stepId: string; planId: string };
      await this.engineLifecycle.skipPlanStep(planId, stepId);
    });

    this.onWebviewMessage("stepModify", async (data) => {
      const { stepId, planId, modification } = data as {
        stepId: string;
        planId: string;
        modification: string;
      };
      await this.engineLifecycle.modifyPlanStep(planId, stepId, modification);
    });

    this.onWebviewMessage("clarificationResponse", async (data) => {
      const { questionId, response } = data as {
        questionId: string;
        response: string;
      };
      await this.engineLifecycle.respondToClarification(questionId, response);
    });

    this.onWebviewMessage("steerMessage", async (data) => {
      const { instruction } = data as { instruction: string };
      await this.engineLifecycle.sendSteerMessage(instruction);
    });
  }
```

**Acceptance Criteria**:
- All webview-to-extension message types are handled
- Each handler calls the appropriate `EngineLifecycle` method
- Async handlers properly await engine calls
- Permission responses include `requestId` and `decision`
- Plan operations include `planId` and optionally `stepId`
- Steer messages forward `instruction` to engine

---

### T4.1.8: Workspace Notification Methods

```typescript
  notifyWorkspaceChanged(newRoot: string): void {
    this.postToWebview("statusUpdate", {
      workspaceRoot: newRoot,
    });
  }

  notifyWorkspaceRemoved(): void {
    this.postToWebview("clearMessages", {});
    this.postToWebview("error", {
      code: "WORKSPACE_REMOVED",
      message: "Workspace was closed. Open a folder to continue.",
      recoverable: true,
    });
  }
```

**Acceptance Criteria**:
- `notifyWorkspaceChanged()` sends updated workspace root to webview
- `notifyWorkspaceRemoved()` clears messages and shows recoverable error
- Both methods are called from `WorkspaceWatcher` (Phase 3)

---

### T4.1.9: Disposal

```typescript
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.messageHandlers.clear();
    this.pendingMessages = [];
    this.view = undefined;
    this.webviewReady = false;
  }
}
```

**Acceptance Criteria**:
- All disposables disposed
- Message handlers cleared
- Pending messages cleared
- View reference and ready flag reset

---

## T4.2: Webview HTML Shell

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/webview/ui/index.html`
**Estimated Effort**: 30 minutes

> **Note**: The HTML is generated inline by `ChatViewProvider.getHtmlForWebview()` (T4.1.3). This task documents the structure and requirements.

### T4.2.1: HTML Template Requirements

The HTML document must:

1. Use `<!DOCTYPE html>` with `lang="en"`
2. Include a `<meta charset="UTF-8">` tag
3. Include a `<meta name="viewport">` tag for responsive layout
4. Include a `<meta http-equiv="Content-Security-Policy">` tag with:
   - `default-src 'none'`
   - `style-src ${webview.cspSource} 'unsafe-inline'`
   - `script-src 'nonce-${nonce}'`
   - `font-src ${webview.cspSource}`
   - `img-src ${webview.cspSource} data: https:`
   - `connect-src https:`
5. Link to the bundled CSS via `<link href="${styleUri}" rel="stylesheet">`
6. Include a `<div id="root"></div>` for React mount
7. Include the bundled JS via `<script nonce="${nonce}" src="${scriptUri}"></script>`

### T4.2.2: VS Code API Acquire Pattern

The webview JS acquires the VS Code API via:

```typescript
// In webview code (src/webview/ui/vscodeApi.ts):
const vscode = acquireVsCodeApi();
```

This global function is injected by VS Code's webview runtime. It can only be called **once** per webview lifecycle. The wrapper in `vscodeApi.ts` (T4.3.3) ensures single acquisition.

**Acceptance Criteria**:
- HTML structure matches the template in T4.1.3
- CSP is correctly configured
- Root div exists with `id="root"`
- Script tag has the correct nonce attribute
- `acquireVsCodeApi()` is called exactly once in the webview code

---

## T4.3: Webview React App Setup

**Status**: ⬜ Not Started
**Files**: `packages/vscode/src/webview/ui/`
**Estimated Effort**: 4 hours

### T4.3.1: Dependencies

Add to `packages/vscode/package.json` `devDependencies` (webview deps are bundled by esbuild):

```json
{
  "devDependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "marked": "^14.0.0",
    "highlight.js": "^11.10.0",
    "dompurify": "^3.1.0",
    "@types/dompurify": "^3.0.0"
  }
}
```

**Acceptance Criteria**:
- `react` and `react-dom` v18+ for concurrent features
- `marked` for Markdown parsing
- `highlight.js` for syntax highlighting
- `dompurify` for HTML sanitization (security)
- Type packages for all libraries

---

### T4.3.2: React Entry Point — `main.tsx`

**File**: `packages/vscode/src/webview/ui/main.tsx`

```tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

const root = createRoot(container);
root.render(<App />);
```

**Acceptance Criteria**:
- Uses `createRoot` from React 18 (concurrent mode)
- Throws if `#root` element is missing
- Renders `<App />` as root component

---

### T4.3.3: VS Code API Wrapper — `vscodeApi.ts`

**File**: `packages/vscode/src/webview/ui/vscodeApi.ts`

```typescript
interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

class VSCodeApiWrapper {
  private readonly vsCodeApi: VSCodeApi;

  constructor() {
    this.vsCodeApi = acquireVsCodeApi();
  }

  postMessage(type: string, data: unknown): void {
    this.vsCodeApi.postMessage({ type, data });
  }

  getState<T>(): T | undefined {
    return this.vsCodeApi.getState() as T | undefined;
  }

  setState<T>(state: T): void {
    this.vsCodeApi.setState(state);
  }
}

export const vscodeApi = new VSCodeApiWrapper();
```

**Acceptance Criteria**:
- `acquireVsCodeApi()` called exactly once
- `postMessage()` wraps messages with `{ type, data }` envelope
- `getState()` / `setState()` for webview state persistence across visibility toggles
- Exported as singleton `vscodeApi`

---

### T4.3.4: Message Bus — `messageBus.ts`

**File**: `packages/vscode/src/webview/ui/messageBus.ts`

```typescript
type Handler<T = unknown> = (data: T) => void;

class MessageBus {
  private handlers = new Map<string, Set<Handler>>();

  constructor() {
    window.addEventListener("message", (event: MessageEvent) => {
      const message = event.data as { type: string; data: unknown };
      if (!message || !message.type) return;

      const handlers = this.handlers.get(message.type);
      if (handlers) {
        for (const handler of handlers) {
          handler(message.data);
        }
      }
    });
  }

  on<T = unknown>(type: string, handler: Handler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as Handler);

    return () => {
      this.handlers.get(type)?.delete(handler as Handler);
    };
  }

  off(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit(type: string, data: unknown): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }
  }
}

export const messageBus = new MessageBus();
```

**Acceptance Criteria**:
- Listens to `window.addEventListener("message")` for all webview messages
- `on()` registers a handler and returns an unsubscribe function
- `off()` removes a specific handler
- `emit()` triggers all handlers for a message type (for local events)
- Exported as singleton `messageBus`
- Handlers stored in `Set` for O(1) add/remove

---

### T4.3.5: React Hook for Messages — `useMessageListener.ts`

**File**: `packages/vscode/src/webview/ui/useMessageListener.ts`

```typescript
import { useEffect } from "react";
import { messageBus } from "./messageBus";

export function useMessageListener<T = unknown>(
  type: string,
  handler: (data: T) => void
): void {
  useEffect(() => {
    const unsub = messageBus.on<T>(type, handler);
    return unsub;
  }, [type, handler]);
}
```

**Acceptance Criteria**:
- React hook that subscribes to a message type on mount
- Unsubscribes on unmount or when dependencies change
- Generic type parameter for typed data

---

### T4.3.6: `tsconfig.webview.json`

**File**: `packages/vscode/tsconfig.webview.json`

Already created in Phase 1 (T1.1.3b). Verify it includes:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "./dist/webview",
    "rootDir": "./src/webview/ui",
    "types": []
  },
  "include": ["src/webview/ui/**/*.ts", "src/webview/ui/**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

**Acceptance Criteria**:
- `lib` includes `DOM` and `DOM.Iterable` (browser context)
- `types` is empty (no `node` types — webview cannot access Node.js)
- `jsx: "react-jsx"` for React 17+ automatic JSX transform
- `rootDir` scoped to `src/webview/ui`

---

## PART 2 — App.tsx Root Component

### T4.3.7: App Root Component — `App.tsx`

**File**: `packages/vscode/src/webview/ui/App.tsx`

```tsx
import { useState, useCallback, useRef, useEffect } from "react";
import { messageBus } from "./messageBus";
import { vscodeApi } from "./vscodeApi";
import { ChatContainer } from "./components/ChatContainer";
import { InputArea } from "./components/InputArea";
import { StatusBar } from "./components/StatusBar";
import { PermissionModal } from "./components/PermissionModal";
import { ErrorBanner } from "./components/ErrorBanner";
import { WelcomeScreen } from "./components/WelcomeScreen";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  tokenCost?: number;
  toolName?: string;
  toolStatus?: "running" | "success" | "error";
  toolResult?: string;
  toolElapsed?: number;
}

export interface StreamState {
  active: boolean;
  content: string;
}

export interface ToolState {
  tool: string;
  description: string;
  startTime: number;
  status: "running" | "success" | "error";
  result?: string;
  elapsed?: number;
}

export interface PermissionRequest {
  requestId: string;
  tool: string;
  path: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface PlanState {
  planId: string;
  title: string;
  status: "pending" | "approved" | "rejected" | "executing" | "completed";
  steps: PlanStep[];
}

export interface PlanStep {
  stepId: string;
  description: string;
  status: "pending" | "approved" | "executing" | "done" | "failed" | "skipped";
  result?: string;
  error?: string;
}

export interface SubAgentState {
  agentId: string;
  task: string;
  status: "running" | "complete";
  startTime: number;
  summary?: string;
  elapsed?: number;
}

export interface ReasoningState {
  active: boolean;
  text: string;
}

export interface TodoItem {
  id: string;
  text: string;
  status: "pending" | "in-progress" | "completed";
}

export interface DiffState {
  tool: string;
  filePath: string;
  diff: string;
  oldContent: string;
  newContent: string;
}

export interface StatusState {
  provider: string;
  model: string;
  tokens: {
    used: number;
    total: number;
    percentage: number;
    cost: number;
  };
  activeTools: number;
  subAgents: number;
}

export interface ErrorState {
  code: string;
  message: string;
  recoverable: boolean;
  actions?: Array<{ label: string; action: string }>;
}

interface AppState {
  messages: ChatMessage[];
  stream: StreamState;
  tools: Map<string, ToolState>;
  permission: PermissionRequest | null;
  plan: PlanState | null;
  subAgents: SubAgentState[];
  reasoning: ReasoningState;
  todos: TodoItem[];
  diff: DiffState | null;
  status: StatusState;
  error: ErrorState | null;
  isProcessing: boolean;
  showWelcome: boolean;
}

export function App() {
  const [state, setState] = useState<AppState>(() => {
    const saved = vscodeApi.getState<AppState>();
    return saved || {
      messages: [],
      stream: { active: false, content: "" },
      tools: new Map(),
      permission: null,
      plan: null,
      subAgents: [],
      reasoning: { active: false, text: "" },
      todos: [],
      diff: null,
      status: {
        provider: "",
        model: "",
        tokens: { used: 0, total: 0, percentage: 0, cost: 0 },
        activeTools: 0,
        subAgents: 0,
      },
      error: null,
      isProcessing: false,
      showWelcome: true,
    };
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    vscodeApi.setState(state);
  }, [state]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(messageBus.on<ChatMessage>("appendMessage", (msg) => {
      setState((prev) => ({
        ...prev,
        messages: [...prev.messages, msg],
        showWelcome: false,
      }));
    }));

    unsubs.push(messageBus.on<{ content: string; fullContent: string }>("updateStream", (data) => {
      setState((prev) => ({
        ...prev,
        stream: { active: true, content: data.fullContent },
      }));
    }));

    unsubs.push(messageBus.on("streamStart", () => {
      setState((prev) => ({
        ...prev,
        stream: { active: true, content: "" },
        isProcessing: true,
      }));
    }));

    unsubs.push(messageBus.on("streamEnd", () => {
      setState((prev) => {
        const streamContent = prev.stream.content;
        const newMsg: ChatMessage = {
          id: `stream-${Date.now()}`,
          role: "assistant",
          content: streamContent,
          timestamp: Date.now(),
        };
        return {
          ...prev,
          stream: { active: false, content: "" },
          messages: [...prev.messages, newMsg],
          isProcessing: false,
        };
      });
    }));

    unsubs.push(messageBus.on<{ tool: string; description: string; startTime: number }>("toolExecuting", (data) => {
      setState((prev) => {
        const tools = new Map(prev.tools);
        tools.set(data.tool, { ...data, status: "running" });
        return {
          ...prev,
          tools,
          status: { ...prev.status, activeTools: tools.size },
        };
      });
    }));

    unsubs.push(messageBus.on<{ tool: string; result: string; elapsed: number }>("toolComplete", (data) => {
      setState((prev) => {
        const tools = new Map(prev.tools);
        const existing = tools.get(data.tool);
        if (existing) {
          tools.set(data.tool, {
            ...existing,
            status: typeof data.result === "string" && data.result.startsWith("ERROR") ? "error" : "success",
            result: data.result,
            elapsed: data.elapsed,
          });
        }
        return { ...prev, tools };
      });
    }));

    unsubs.push(messageBus.on<PermissionRequest>("permissionRequired", (data) => {
      setState((prev) => ({ ...prev, permission: data }));
    }));

    unsubs.push(messageBus.on<{ action: string; plan?: PlanState; stepId?: string; status?: string; result?: string; error?: string }>("planUpdate", (data) => {
      setState((prev) => {
        if (data.action === "generated" && data.plan) {
          return { ...prev, plan: data.plan };
        }
        if (data.action === "stepUpdate" && prev.plan) {
          const steps = prev.plan.steps.map((s) =>
            s.stepId === data.stepId
              ? { ...s, status: data.status as PlanStep["status"], result: data.result, error: data.error }
              : s
          );
          return { ...prev, plan: { ...prev.plan, steps } };
        }
        return prev;
      });
    }));

    unsubs.push(messageBus.on<SubAgentState>("subAgentUpdate", (data) => {
      setState((prev) => {
        const idx = prev.subAgents.findIndex((a) => a.agentId === data.agentId);
        const subAgents = [...prev.subAgents];
        if (idx >= 0) {
          subAgents[idx] = data;
        } else {
          subAgents.push(data);
        }
        return {
          ...prev,
          subAgents,
          status: { ...prev.status, subAgents: subAgents.filter((a) => a.status === "running").length },
        };
      });
    }));

    unsubs.push(messageBus.on<{ action: string; text?: string }>("reasoningUpdate", (data) => {
      setState((prev) => ({
        ...prev,
        reasoning: {
          active: data.action !== "complete",
          text: data.text || prev.reasoning.text,
        },
      }));
    }));

    unsubs.push(messageBus.on<{ items: TodoItem[] }>("todoUpdate", (data) => {
      setState((prev) => ({ ...prev, todos: data.items }));
    }));

    unsubs.push(messageBus.on<DiffState>("diffPreview", (data) => {
      setState((prev) => ({ ...prev, diff: data }));
    }));

    unsubs.push(messageBus.on<ErrorState>("error", (data) => {
      setState((prev) => ({ ...prev, error: data, isProcessing: false }));
    }));

    unsubs.push(messageBus.on("clearMessages", () => {
      setState((prev) => ({
        ...prev,
        messages: [],
        stream: { active: false, content: "" },
        tools: new Map(),
        plan: null,
        subAgents: [],
        reasoning: { active: false, text: "" },
        todos: [],
        diff: null,
        error: null,
        isProcessing: false,
        showWelcome: true,
      }));
    }));

    unsubs.push(messageBus.on<{ messages: ChatMessage[]; title: string }>("sessionRestored", (data) => {
      setState((prev) => ({
        ...prev,
        messages: data.messages,
        showWelcome: data.messages.length === 0,
      }));
    }));

    unsubs.push(messageBus.on<{ tokens?: StatusState["tokens"]; provider?: string; model?: string }>("statusUpdate", (data) => {
      setState((prev) => ({
        ...prev,
        status: {
          ...prev.status,
          ...(data.tokens ? { tokens: data.tokens } : {}),
          ...(data.provider ? { provider: data.provider } : {}),
          ...(data.model ? { model: data.model } : {}),
        },
      }));
    }));

    unsubs.push(messageBus.on("loadingStart", () => {
      setState((prev) => ({ ...prev, isProcessing: true }));
    }));

    unsubs.push(messageBus.on("loadingEnd", () => {
      setState((prev) => ({ ...prev, isProcessing: false }));
    }));

    vscodeApi.postMessage("ready", {});

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, []);

  const handleSendMessage = useCallback((content: string) => {
    vscodeApi.postMessage("sendMessage", { content });
    setState((prev) => ({ ...prev, showWelcome: false, error: null }));
  }, []);

  const handleCancel = useCallback(() => {
    vscodeApi.postMessage("cancelProcessing", {});
  }, []);

  const handlePermissionRespond = useCallback((decision: "allow-once" | "allow-always" | "deny") => {
    if (stateRef.current.permission) {
      vscodeApi.postMessage("permissionRespond", {
        requestId: stateRef.current.permission.requestId,
        decision,
      });
      setState((prev) => ({ ...prev, permission: null }));
    }
  }, []);

  const handlePlanApprove = useCallback(() => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage("planApprove", { planId: stateRef.current.plan.planId });
    }
  }, []);

  const handlePlanReject = useCallback(() => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage("planReject", { planId: stateRef.current.plan.planId });
    }
  }, []);

  const handleStepApprove = useCallback((stepId: string) => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage("stepApprove", { stepId, planId: stateRef.current.plan.planId });
    }
  }, []);

  const handleStepSkip = useCallback((stepId: string) => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage("stepSkip", { stepId, planId: stateRef.current.plan.planId });
    }
  }, []);

  const handleStepModify = useCallback((stepId: string, modification: string) => {
    if (stateRef.current.plan) {
      vscodeApi.postMessage("stepModify", { stepId, planId: stateRef.current.plan.planId, modification });
    }
  }, []);

  const handleSteerMessage = useCallback((instruction: string) => {
    vscodeApi.postMessage("steerMessage", { instruction });
  }, []);

  const handleDismissError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return (
    <div className="agentx-app">
      {state.error && (
        <ErrorBanner error={state.error} onDismiss={handleDismissError} onRetry={() => handleSendMessage("retry")} />
      )}
      {state.permission && (
        <PermissionModal request={state.permission} onRespond={handlePermissionRespond} />
      )}
      {state.showWelcome && state.messages.length === 0 ? (
        <WelcomeScreen onStartChat={handleSendMessage} />
      ) : (
        <ChatContainer
          messages={state.messages}
          stream={state.stream}
          tools={state.tools}
          plan={state.plan}
          subAgents={state.subAgents}
          reasoning={state.reasoning}
          todos={state.todos}
          diff={state.diff}
          onPlanApprove={handlePlanApprove}
          onPlanReject={handlePlanReject}
          onStepApprove={handleStepApprove}
          onStepSkip={handleStepSkip}
          onStepModify={handleStepModify}
        />
      )}
      <InputArea onSend={handleSendMessage} onCancel={handleCancel} onSteer={handleSteerMessage} isProcessing={state.isProcessing} />
      <StatusBar status={state.status} />
    </div>
  );
}
```

**Acceptance Criteria**:
- All state types defined with full interfaces
- State initialized from `vscodeApi.getState()` for persistence across visibility toggles
- State saved via `vscodeApi.setState()` on every change
- All message types from the protocol are subscribed to in the `useEffect`
- `ready` message sent to extension host after all listeners are registered
- Cleanup function unsubscribes all listeners on unmount
- All callback handlers are memoized with `useCallback`
- Conditional rendering: WelcomeScreen when no messages, ChatContainer otherwise
- ErrorBanner and PermissionModal rendered as overlays
- InputArea always visible at bottom
- StatusBar always visible at very bottom

---

## PART 3 — Chat Components (T4.4)

**Status**: ⬜ Not Started
**Directory**: `packages/vscode/src/webview/ui/components/`
**Estimated Effort**: 3 days

### T4.4.1: ChatContainer

**File**: `packages/vscode/src/webview/ui/components/ChatContainer.tsx`

```tsx
import { useRef, useEffect, useState, useCallback } from "react";
import type { ChatMessage, StreamState, ToolState, PlanState, SubAgentState, ReasoningState, TodoItem, DiffState } from "../App";
import { MessageBubble } from "./MessageBubble";
import { StreamingMessage } from "./StreamingMessage";
import { ToolCard } from "./ToolCard";
import { PlanView } from "./PlanView";
import { SubAgentCard } from "./SubAgentCard";
import { ReasoningIndicator } from "./ReasoningIndicator";
import { TodoPanel } from "./TodoPanel";
import { DiffPreview } from "./DiffPreview";

interface ChatContainerProps {
  messages: ChatMessage[];
  stream: StreamState;
  tools: Map<string, ToolState>;
  plan: PlanState | null;
  subAgents: SubAgentState[];
  reasoning: ReasoningState;
  todos: TodoItem[];
  diff: DiffState | null;
  onPlanApprove: () => void;
  onPlanReject: () => void;
  onStepApprove: (stepId: string) => void;
  onStepSkip: (stepId: string) => void;
  onStepModify: (stepId: string, modification: string) => void;
}

export function ChatContainer({
  messages, stream, tools, plan, subAgents, reasoning, todos, diff,
  onPlanApprove, onPlanReject, onStepApprove, onStepSkip, onStepModify,
}: ChatContainerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isNearBottomRef = useRef(true);

  const checkScrollPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setShowScrollButton(!isNearBottomRef.current);
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, stream.content, tools]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, []);

  const toolEntries = Array.from(tools.values());
  const runningSubAgents = subAgents.filter((a) => a.status === "running");
  const completedSubAgents = subAgents.filter((a) => a.status === "complete");

  return (
    <div className="chat-container" ref={scrollRef} onScroll={checkScrollPosition}>
      <div className="chat-messages">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {reasoning.active && <ReasoningIndicator text={reasoning.text} />}
        {toolEntries.map((tool) => <ToolCard key={tool.tool} tool={tool} />)}
        {runningSubAgents.map((agent) => <SubAgentCard key={agent.agentId} agent={agent} />)}
        {plan && (
          <PlanView plan={plan} onApprove={onPlanApprove} onReject={onPlanReject}
            onStepApprove={onStepApprove} onStepSkip={onStepSkip} onStepModify={onStepModify} />
        )}
        {stream.active && <StreamingMessage content={stream.content} />}
        {diff && <DiffPreview diff={diff} />}
        {todos.length > 0 && <TodoPanel items={todos} />}
        {completedSubAgents.map((agent) => <SubAgentCard key={agent.agentId} agent={agent} />)}
      </div>
      {showScrollButton && (
        <button className="scroll-to-bottom" onClick={scrollToBottom} aria-label="Scroll to bottom">
          <span className="codicon codicon-chevron-down" />
        </button>
      )}
    </div>
  );
}
```

**Acceptance Criteria**:
- Scrollable container with `ref` for programmatic scrolling
- Auto-scrolls to bottom when new messages arrive (only if user is near bottom)
- `checkScrollPosition()` detects if user has scrolled away from bottom
- Scroll-to-bottom button appears when user is not near bottom
- Smooth scroll animation on button click
- Messages rendered in order via `MessageBubble`
- Reasoning indicator shown between messages and tools
- Tool cards rendered for all active/completed tools
- Running sub-agents shown before plan, completed after
- Plan view rendered when plan exists
- Streaming message rendered at bottom when active
- Diff preview rendered when diff exists
- TODO panel rendered when items exist

---

### T4.4.2: MessageBubble

**File**: `packages/vscode/src/webview/ui/components/MessageBubble.tsx`

```tsx
import { useState, useMemo, useCallback } from "react";
import type { ChatMessage } from "../App";
import { renderMarkdown } from "../markdown";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const htmlContent = useMemo(() => {
    if (message.role === "tool") {
      return `<pre class="tool-output">${escapeHtml(message.content)}</pre>`;
    }
    return renderMarkdown(message.content);
  }, [message.content, message.role]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content]);

  const roleClass = `message-${message.role}`;
  const timestamp = new Date(message.timestamp).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit",
  });

  if (message.role === "tool") {
    return (
      <div className={`message-bubble ${roleClass}`}>
        <div className="message-header" onClick={() => setCollapsed(!collapsed)}>
          <span className="tool-icon codicon codicon-terminal" />
          <span className="tool-name">{message.toolName || "Tool Result"}</span>
          <span className={`tool-status tool-status-${message.toolStatus || "success"}`}>
            {message.toolStatus === "running" ? "Running" : message.toolStatus === "error" ? "Failed" : "Done"}
          </span>
          <span className="collapse-toggle">{collapsed ? "+" : "-"}</span>
        </div>
        {!collapsed && (
          <div className="message-content markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
        )}
        <div className="message-footer">
          <span className="message-timestamp">{timestamp}</span>
          {message.toolElapsed !== undefined && (
            <span className="message-elapsed">{(message.toolElapsed / 1000).toFixed(1)}s</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`message-bubble ${roleClass}`}>
      <div className="message-content markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      <div className="message-footer">
        <span className="message-timestamp">{timestamp}</span>
        {message.tokenCost !== undefined && (
          <span className="message-cost">{message.tokenCost} tokens</span>
        )}
        <button className="copy-button" onClick={handleCopy} title="Copy message">
          <span className={`codicon codicon-${copied ? "check" : "copy"}`} />
        </button>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c] || c);
}
```

**Acceptance Criteria**:
- User messages rendered with `message-user` class (right-aligned, accent color)
- Assistant messages rendered with `message-assistant` class (left-aligned)
- Tool messages rendered with collapsible header, monospace output
- Markdown rendering via `renderMarkdown()` (T4.7)
- `dangerouslySetInnerHTML` used for rendered markdown (sanitized by DOMPurify in T4.7)
- Copy button copies raw message text to clipboard with visual feedback
- Timestamp displayed in `HH:MM` format
- Token cost displayed for assistant messages when available
- Tool elapsed time displayed when available
- Tool status indicator (Running/Done/Failed) with color coding
- Collapse toggle for tool output

---

### T4.4.3: StreamingMessage

**File**: `packages/vscode/src/webview/ui/components/StreamingMessage.tsx`

```tsx
import { useMemo, useRef, useEffect } from "react";
import { renderMarkdown } from "../markdown";

interface StreamingMessageProps {
  content: string;
}

export function StreamingMessage({ content }: StreamingMessageProps) {
  const cursorRef = useRef<HTMLSpanElement>(null);

  const htmlContent = useMemo(() => renderMarkdown(content), [content]);

  useEffect(() => {
    if (cursorRef.current) {
      cursorRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [content]);

  return (
    <div className="message-bubble message-assistant message-streaming">
      <div className="message-content markdown-content" dangerouslySetInnerHTML={{ __html: htmlContent }} />
      <span ref={cursorRef} className="streaming-cursor" />
    </div>
  );
}
```

**Acceptance Criteria**:
- Renders progressively updating markdown content
- Animated cursor/caret at the end of streaming text
- Auto-scrolls cursor into view on each content update
- Uses `message-streaming` class for distinct styling
- `renderMarkdown()` called on every content change (memoized)

---

### T4.4.4: ToolCard

**File**: `packages/vscode/src/webview/ui/components/ToolCard.tsx`

```tsx
import { useState, useEffect, useRef } from "react";
import type { ToolState } from "../App";

interface ToolCardProps {
  tool: ToolState;
}

export function ToolCard({ tool }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (tool.status === "running") {
      intervalRef.current = setInterval(() => {
        setElapsed(Date.now() - tool.startTime);
      }, 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed(tool.elapsed || 0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tool.status, tool.startTime, tool.elapsed]);

  const statusIcon = tool.status === "running"
    ? "codicon-loading codicon-modifier-spin"
    : tool.status === "error" ? "codicon-error" : "codicon-check";

  const statusClass = `tool-card-status-${tool.status}`;

  const formatElapsed = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className={`tool-card ${statusClass}`}>
      <div className="tool-card-header" onClick={() => setExpanded(!expanded)}>
        <span className={`tool-card-icon codicon ${statusIcon}`} />
        <span className="tool-card-name">{tool.tool}</span>
        <span className="tool-card-elapsed">{formatElapsed(elapsed)}</span>
        <span className="tool-card-toggle codicon codicon-chevron-down" />
      </div>
      <div className="tool-card-description">{tool.description}</div>
      {expanded && tool.result && (
        <div className="tool-card-output"><pre>{tool.result}</pre></div>
      )}
      {tool.status === "error" && tool.result && (
        <div className="tool-card-error"><pre>{tool.result}</pre></div>
      )}
    </div>
  );
}
```

**Acceptance Criteria**:
- Tool name displayed with icon
- Status indicator: spinning loader for running, check for success, X for error
- Live elapsed time timer (updates every 100ms) while running
- Elapsed time formatted as `ms` or `s`
- Timer cleared when tool completes
- Collapsible output section (click header to toggle)
- Error output always visible when status is error
- Description shown below header

---

### T4.4.5: PermissionModal

**File**: `packages/vscode/src/webview/ui/components/PermissionModal.tsx`

```tsx
import { useEffect, useCallback } from "react";
import type { PermissionRequest } from "../App";

interface PermissionModalProps {
  request: PermissionRequest;
  onRespond: (decision: "allow-once" | "allow-always" | "deny") => void;
}

export function PermissionModal({ request, onRespond }: PermissionModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); onRespond("allow-once"); }
    else if (e.key === "Escape") { e.preventDefault(); onRespond("deny"); }
  }, [onRespond]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const riskColors: Record<string, string> = {
    low: "var(--vscode-testing-iconPassed)",
    medium: "var(--vscode-charts-yellow)",
    high: "var(--vscode-charts-orange)",
    critical: "var(--vscode-errorForeground)",
  };

  return (
    <div className="permission-overlay">
      <div className="permission-modal">
        <div className="permission-header">
          <span className="codicon codicon-shield" />
          <span className="permission-title">Permission Required</span>
        </div>
        <div className="permission-body">
          <div className="permission-field">
            <label>Tool</label>
            <span className="permission-value">{request.tool}</span>
          </div>
          {request.path && (
            <div className="permission-field">
              <label>Path</label>
              <span className="permission-value permission-path">{request.path}</span>
            </div>
          )}
          {request.description && (
            <div className="permission-field">
              <label>Description</label>
              <span className="permission-value">{request.description}</span>
            </div>
          )}
          <div className="permission-field">
            <label>Risk Level</label>
            <span className="permission-risk" style={{ color: riskColors[request.riskLevel] || riskColors.medium }}>
              {request.riskLevel.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="permission-actions">
          <button className="permission-btn permission-btn-deny" onClick={() => onRespond("deny")}>
            <span className="codicon codicon-close" /> Deny <kbd>Esc</kbd>
          </button>
          <button className="permission-btn permission-btn-allow-once" onClick={() => onRespond("allow-once")}>
            <span className="codicon codicon-check" /> Allow Once <kbd>Enter</kbd>
          </button>
          <button className="permission-btn permission-btn-allow-always" onClick={() => onRespond("allow-always")}>
            <span className="codicon codicon-check-all" /> Allow Always
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Acceptance Criteria**:
- Modal overlay covers entire webview
- Tool name displayed prominently
- Path displayed (if provided)
- Description displayed (if provided)
- Risk level color-coded: low=green, medium=yellow, high=orange, critical=red
- Three action buttons: Deny, Allow Once, Allow Always
- Keyboard shortcuts: Enter = Allow Once, Escape = Deny
- `kbd` elements show shortcut hints
- Modal cannot be dismissed without choosing an action

---

### T4.4.6: PlanView

**File**: `packages/vscode/src/webview/ui/components/PlanView.tsx`

```tsx
import { useState } from "react";
import type { PlanState } from "../App";

interface PlanViewProps {
  plan: PlanState;
  onApprove: () => void;
  onReject: () => void;
  onStepApprove: (stepId: string) => void;
  onStepSkip: (stepId: string) => void;
  onStepModify: (stepId: string, modification: string) => void;
}

const stepStatusIcons: Record<string, string> = {
  pending: "codicon-circle-outline",
  approved: "codicon-check",
  executing: "codicon-loading codicon-modifier-spin",
  done: "codicon-pass-filled",
  failed: "codicon-error",
  skipped: "codicon-arrow-right",
};

export function PlanView({ plan, onApprove, onReject, onStepApprove, onStepSkip, onStepModify }: PlanViewProps) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [modification, setModification] = useState("");

  const completedSteps = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const progressPct = plan.steps.length > 0 ? Math.round((completedSteps / plan.steps.length) * 100) : 0;
  const isPending = plan.status === "pending";
  const isExecuting = plan.status === "executing";

  const handleSubmitModification = (stepId: string) => {
    if (modification.trim()) {
      onStepModify(stepId, modification.trim());
      setModification("");
      setEditingStep(null);
    }
  };

  return (
    <div className="plan-view">
      <div className="plan-header">
        <span className="codicon codicon-checklist" />
        <span className="plan-title">{plan.title}</span>
        <span className={`plan-status plan-status-${plan.status}`}>{plan.status}</span>
      </div>
      <div className="plan-progress">
        <div className="plan-progress-bar">
          <div className="plan-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="plan-progress-text">{completedSteps}/{plan.steps.length} steps</span>
      </div>
      <div className="plan-steps">
        {plan.steps.map((step, index) => (
          <div key={step.stepId} className={`plan-step plan-step-${step.status}`}>
            <div className="plan-step-header">
              <span className={`plan-step-icon codicon ${stepStatusIcons[step.status] || stepStatusIcons.pending}`} />
              <span className="plan-step-number">{index + 1}.</span>
              <span className="plan-step-description">{step.description}</span>
            </div>
            {step.result && <div className="plan-step-result">{step.result}</div>}
            {step.error && <div className="plan-step-error">{step.error}</div>}
            {isExecuting && step.status === "pending" && (
              <div className="plan-step-actions">
                <button className="plan-step-btn plan-step-btn-approve" onClick={() => onStepApprove(step.stepId)}>Approve</button>
                <button className="plan-step-btn plan-step-btn-skip" onClick={() => onStepSkip(step.stepId)}>Skip</button>
                <button className="plan-step-btn plan-step-btn-modify"
                  onClick={() => setEditingStep(editingStep === step.stepId ? null : step.stepId)}>Modify</button>
              </div>
            )}
            {editingStep === step.stepId && (
              <div className="plan-step-modify">
                <input type="text" className="plan-step-modify-input" value={modification}
                  onChange={(e) => setModification(e.target.value)} placeholder="Describe modification..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmitModification(step.stepId);
                    if (e.key === "Escape") { setEditingStep(null); setModification(""); }
                  }} autoFocus />
                <button className="plan-step-btn" onClick={() => handleSubmitModification(step.stepId)}>Apply</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {isPending && (
        <div className="plan-actions">
          <button className="plan-btn plan-btn-approve" onClick={onApprove}>
            <span className="codicon codicon-check-all" /> Approve Plan
          </button>
          <button className="plan-btn plan-btn-reject" onClick={onReject}>
            <span className="codicon codicon-close-all" /> Reject Plan
          </button>
        </div>
      )}
    </div>
  );
}
```

**Acceptance Criteria**:
- Plan title displayed with checklist icon
- Plan status shown (pending/approved/rejected/executing/completed)
- Progress bar with percentage and step count
- Each step shows: status icon, number, description
- Step status icons: pending (circle), approved (check), executing (spinner), done (filled check), failed (error), skipped (arrow)
- Step result/error displayed when available
- Per-step actions (Approve/Skip/Modify) shown only during execution for pending steps
- Modify action shows inline text input with Enter to submit, Escape to cancel
- Overall Approve/Reject buttons shown only when plan status is "pending"

---

### T4.4.7: SubAgentCard

**File**: `packages/vscode/src/webview/ui/components/SubAgentCard.tsx`

```tsx
import { useState, useEffect, useRef } from "react";
import type { SubAgentState } from "../App";

interface SubAgentCardProps {
  agent: SubAgentState;
}

export function SubAgentCard({ agent }: SubAgentCardProps) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (agent.status === "running") {
      intervalRef.current = setInterval(() => setElapsed(Date.now() - agent.startTime), 100);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed(agent.elapsed || 0);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [agent.status, agent.startTime, agent.elapsed]);

  const formatElapsed = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  return (
    <div className={`sub-agent-card sub-agent-${agent.status}`}>
      <div className="sub-agent-header">
        <span className={`sub-agent-icon codicon ${agent.status === "running" ? "codicon-loading codicon-modifier-spin" : "codicon-pass-filled"}`} />
        <span className="sub-agent-task">{agent.task}</span>
        <span className="sub-agent-elapsed">{formatElapsed(elapsed)}</span>
      </div>
      <div className="sub-agent-id">Agent: {agent.agentId.slice(0, 8)}</div>
      {agent.status === "complete" && agent.summary && (
        <div className="sub-agent-summary">{agent.summary}</div>
      )}
    </div>
  );
}
```

**Acceptance Criteria**:
- Agent task displayed as title
- Status icon: spinning loader for running, check for complete
- Live elapsed time timer while running (updates every 100ms)
- Elapsed formatted as ms/s/m+s
- Agent ID truncated to 8 chars
- Summary displayed on completion

---

### T4.4.8: ReasoningIndicator

**File**: `packages/vscode/src/webview/ui/components/ReasoningIndicator.tsx`

```tsx
interface ReasoningIndicatorProps {
  text: string;
}

export function ReasoningIndicator({ text }: ReasoningIndicatorProps) {
  return (
    <div className="reasoning-indicator">
      <div className="reasoning-header">
        <span className="codicon codicon-lightbulb reasoning-icon" />
        <span className="reasoning-label">Thinking</span>
        <span className="reasoning-dots">
          <span className="reasoning-dot" />
          <span className="reasoning-dot" />
          <span className="reasoning-dot" />
        </span>
      </div>
      {text && <div className="reasoning-text">{text}</div>}
    </div>
  );
}
```

**Acceptance Criteria**:
- Animated "Thinking" label with pulsing dots
- Lightbulb icon
- Ephemeral reasoning text displayed when available
- Text fades in/out with CSS transitions
- Compact layout — collapses when reasoning completes (component unmounts)
- Three animated dots with staggered animation

---

### T4.4.9: TodoPanel

**File**: `packages/vscode/src/webview/ui/components/TodoPanel.tsx`

```tsx
import { useState } from "react";
import type { TodoItem } from "../App";

interface TodoPanelProps {
  items: TodoItem[];
}

export function TodoPanel({ items }: TodoPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const completed = items.filter((i) => i.status === "completed").length;
  const inProgress = items.filter((i) => i.status === "in-progress").length;

  const statusIcon = (status: TodoItem["status"]): string => {
    switch (status) {
      case "completed": return "codicon-pass-filled";
      case "in-progress": return "codicon-loading codicon-modifier-spin";
      default: return "codicon-circle-outline";
    }
  };

  return (
    <div className="todo-panel">
      <div className="todo-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="codicon codicon-checklist" />
        <span className="todo-title">Tasks</span>
        <span className="todo-count">
          {completed}/{items.length} done{inProgress > 0 && ` · ${inProgress} in progress`}
        </span>
        <span className={`todo-toggle codicon codicon-chevron-${collapsed ? "right" : "down"}`} />
      </div>
      {!collapsed && (
        <div className="todo-list">
          {items.map((item) => (
            <div key={item.id} className={`todo-item todo-item-${item.status}`}>
              <span className={`todo-item-icon codicon ${statusIcon(item.status)}`} />
              <span className={`todo-item-text ${item.status === "completed" ? "todo-item-completed" : ""}`}>
                {item.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Acceptance Criteria**:
- Collapsible panel with header showing checklist icon, title, completion count, in-progress count
- Each item shows status icon: circle (pending), spinner (in-progress), check (completed)
- Completed items have strikethrough text
- Collapse toggle with chevron icon

---

### T4.4.10: DiffPreview

**File**: `packages/vscode/src/webview/ui/components/DiffPreview.tsx`

```tsx
import { useState, useMemo } from "react";
import type { DiffState } from "../App";

interface DiffPreviewProps {
  diff: DiffState;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export function DiffPreview({ diff }: DiffPreviewProps) {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  const diffLines = useMemo(() => {
    const lines: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;
    for (const raw of diff.diff.split("\n")) {
      if (raw.startsWith("@@")) {
        lines.push({ type: "header", content: raw });
        const m1 = raw.match(/-(\d+)/);
        const m2 = raw.match(/\+(\d+)/);
        oldLine = m1 ? parseInt(m1[1], 10) : 0;
        newLine = m2 ? parseInt(m2[1], 10) : 0;
      } else if (raw.startsWith("+")) {
        lines.push({ type: "add", content: raw.slice(1), newLineNum: newLine++ });
      } else if (raw.startsWith("-")) {
        lines.push({ type: "remove", content: raw.slice(1), oldLineNum: oldLine++ });
      } else {
        const text = raw.startsWith(" ") ? raw.slice(1) : raw;
        lines.push({ type: "context", content: text, oldLineNum: oldLine++, newLineNum: newLine++ });
      }
    }
    return lines;
  }, [diff.diff]);

  const fileName = diff.filePath.split("/").pop() || diff.filePath;

  return (
    <div className="diff-preview">
      <div className="diff-header">
        <span className="codicon codicon-file" />
        <span className="diff-filename">{fileName}</span>
        <span className="diff-path">{diff.filePath}</span>
        <div className="diff-view-toggle">
          <button className={`diff-view-btn ${viewMode === "unified" ? "active" : ""}`} onClick={() => setViewMode("unified")}>Unified</button>
          <button className={`diff-view-btn ${viewMode === "split" ? "active" : ""}`} onClick={() => setViewMode("split")}>Split</button>
        </div>
      </div>
      <div className={`diff-content diff-${viewMode}`}>
        {viewMode === "unified" ? (
          <table className="diff-table">
            <tbody>
              {diffLines.map((line, i) => (
                <tr key={i} className={`diff-line diff-line-${line.type}`}>
                  <td className="diff-line-num">{line.oldLineNum || ""}</td>
                  <td className="diff-line-num">{line.newLineNum || ""}</td>
                  <td className="diff-line-prefix">{line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}</td>
                  <td className="diff-line-content">{line.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="diff-split">
            <div className="diff-split-old">
              <table className="diff-table">
                <tbody>
                  {diffLines.filter((l) => l.type !== "add").map((line, i) => (
                    <tr key={i} className={`diff-line diff-line-${line.type}`}>
                      <td className="diff-line-num">{line.oldLineNum || ""}</td>
                      <td className="diff-line-content">{line.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="diff-split-new">
              <table className="diff-table">
                <tbody>
                  {diffLines.filter((l) => l.type !== "remove").map((line, i) => (
                    <tr key={i} className={`diff-line diff-line-${line.type}`}>
                      <td className="diff-line-num">{line.newLineNum || ""}</td>
                      <td className="diff-line-content">{line.content}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Acceptance Criteria**:
- File path displayed in header with file icon
- Toggle between unified and split (side-by-side) view
- Unified view: single table with line numbers (old + new), prefix (+/-/space), and content
- Split view: two side-by-side tables
- Line numbers displayed for both old and new sides
- Added lines styled green, removed lines styled red, context lines neutral
- Diff lines parsed from unified diff format

---

### T4.4.11: InputArea

**File**: `packages/vscode/src/webview/ui/components/InputArea.tsx`

```tsx
import { useState, useRef, useCallback, useEffect } from "react";

interface InputAreaProps {
  onSend: (content: string) => void;
  onCancel: () => void;
  onSteer: (instruction: string) => void;
  isProcessing: boolean;
}

const SLASH_COMMANDS = [
  { command: "/help", description: "Show help" },
  { command: "/clear", description: "Clear chat" },
  { command: "/compact", description: "Compact context" },
  { command: "/model", description: "Switch model" },
  { command: "/provider", description: "Switch provider" },
  { command: "/crew", description: "Switch crew" },
  { command: "/plan", description: "Toggle plan mode" },
  { command: "/cost", description: "Show token usage" },
  { command: "/steer", description: "Send steer instruction" },
  { command: "/cancel", description: "Cancel current task" },
];

export function InputArea({ onSend, onCancel, onSteer, isProcessing }: InputAreaProps) {
  const [value, setValue] = useState("");
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.command.toLowerCase().startsWith(slashFilter.toLowerCase())
  );

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }
  }, []);

  useEffect(() => { adjustHeight(); }, [value, adjustHeight]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (isProcessing) { onSteer(trimmed); } else { onSend(trimmed); }
    setValue("");
    setShowSlashMenu(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [value, isProcessing, onSend, onSteer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedSlashIndex((p) => Math.min(p + 1, filteredCommands.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedSlashIndex((p) => Math.max(p - 1, 0)); return; }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredCommands[selectedSlashIndex];
        if (cmd) { setValue(cmd.command + " "); setShowSlashMenu(false); }
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setShowSlashMenu(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [showSlashMenu, filteredCommands, selectedSlashIndex, handleSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    if (newValue.startsWith("/") && !newValue.includes(" ")) {
      setShowSlashMenu(true); setSlashFilter(newValue); setSelectedSlashIndex(0);
    } else {
      setShowSlashMenu(false);
    }
  }, []);

  return (
    <div className="input-area">
      {showSlashMenu && filteredCommands.length > 0 && (
        <div className="slash-menu">
          {filteredCommands.map((cmd, index) => (
            <div key={cmd.command} className={`slash-menu-item ${index === selectedSlashIndex ? "selected" : ""}`}
              onClick={() => { setValue(cmd.command + " "); setShowSlashMenu(false); textareaRef.current?.focus(); }}>
              <span className="slash-menu-command">{cmd.command}</span>
              <span className="slash-menu-description">{cmd.description}</span>
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
        <textarea ref={textareaRef} className="input-textarea" value={value}
          onChange={handleChange} onKeyDown={handleKeyDown}
          placeholder={isProcessing ? "Type a steer message..." : "Type a message or / for commands..."} rows={1} />
        <div className="input-actions">
          {isProcessing ? (
            <>
              <button className="input-btn input-btn-steer" onClick={handleSend} disabled={!value.trim()} title="Send steer message">
                <span className="codicon codicon-megaphone" />
              </button>
              <button className="input-btn input-btn-cancel" onClick={onCancel} title="Cancel processing">
                <span className="codicon codicon-stop-circle" />
              </button>
            </>
          ) : (
            <button className="input-btn input-btn-send" onClick={handleSend} disabled={!value.trim()} title="Send message">
              <span className="codicon codicon-send" />
            </button>
          )}
        </div>
      </div>
      <div className="input-footer">
        <span className="input-char-count">{value.length > 0 ? `${value.length} chars` : ""}</span>
        {isProcessing && <span className="input-steer-hint">Agent is busy — messages sent as steer instructions</span>}
      </div>
    </div>
  );
}
```

**Acceptance Criteria**:
- Multi-line textarea with auto-grow (max 200px height)
- Enter sends message, Shift+Enter inserts newline
- Send button disabled when empty
- When processing: textarea placeholder changes, send becomes steer, cancel button shown
- Steer message indicator shown when agent is busy
- Slash command autocomplete: typing "/" shows command menu
- Arrow keys navigate slash menu, Enter selects, Escape dismisses
- Character count displayed in footer
- 10 slash commands defined

---

### T4.4.12: StatusBar

**File**: `packages/vscode/src/webview/ui/components/StatusBar.tsx`

```tsx
import type { StatusState } from "../App";

interface StatusBarProps {
  status: StatusState;
}

export function StatusBar({ status }: StatusBarProps) {
  const pct = status.tokens.percentage;
  const barColor = pct < 50 ? "var(--vscode-testing-iconPassed)"
    : pct < 80 ? "var(--vscode-charts-yellow)" : "var(--vscode-errorForeground)";

  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div className="webview-status-bar">
      <div className="status-item status-provider" title="Provider">
        <span className="codicon codicon-cloud" /><span>{status.provider || "—"}</span>
      </div>
      <div className="status-item status-model" title="Model">
        <span className="codicon codicon-symbol-misc" />
        <span className="status-model-text">{status.model || "—"}</span>
      </div>
      <div className="status-item status-tokens" title="Token usage">
        <div className="token-bar">
          <div className="token-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: barColor }} />
        </div>
        <span className="token-text">{formatTokens(status.tokens.used)}/{formatTokens(status.tokens.total)}</span>
      </div>
      <div className="status-item status-cost" title="Session cost">
        <span className="codicon codicon-credit-card" /><span>${status.tokens.cost.toFixed(4)}</span>
      </div>
      {status.activeTools > 0 && (
        <div className="status-item status-tools" title="Active tools">
          <span className="codicon codicon-tools" /><span>{status.activeTools}</span>
        </div>
      )}
      {status.subAgents > 0 && (
        <div className="status-item status-agents" title="Sub-agents">
          <span className="codicon codicon-organization" /><span>{status.subAgents}</span>
        </div>
      )}
    </div>
  );
}
```

**Acceptance Criteria**:
- Provider shown with cloud icon
- Model shown with symbol icon, truncated if too long
- Token usage bar: color-coded green (<50%), yellow (50-80%), red (>80%)
- Token count formatted as K/M
- Session cost shown with dollar sign and 4 decimal places
- Active tools count shown only when > 0
- Sub-agents count shown only when > 0
- Compact horizontal layout for sidebar width

---

### T4.4.13: ErrorBanner

**File**: `packages/vscode/src/webview/ui/components/ErrorBanner.tsx`

```tsx
import type { ErrorState } from "../App";

interface ErrorBannerProps {
  error: ErrorState;
  onDismiss: () => void;
  onRetry: () => void;
}

export function ErrorBanner({ error, onDismiss, onRetry }: ErrorBannerProps) {
  const severityClass = error.recoverable ? "error-recoverable" : "error-fatal";

  return (
    <div className={`error-banner ${severityClass}`}>
      <div className="error-header">
        <span className={`codicon ${error.recoverable ? "codicon-warning" : "codicon-error"}`} />
        <span className="error-code">{error.code}</span>
        <button className="error-dismiss" onClick={onDismiss} title="Dismiss">
          <span className="codicon codicon-close" />
        </button>
      </div>
      <div className="error-message">{error.message}</div>
      <div className="error-actions">
        {error.recoverable && (
          <button className="error-btn error-btn-retry" onClick={onRetry}>
            <span className="codicon codicon-refresh" /> Retry
          </button>
        )}
        {error.actions?.map((action) => (
          <button key={action.action} className="error-btn">{action.label}</button>
        ))}
      </div>
    </div>
  );
}
```

**Acceptance Criteria**:
- Error code displayed in header
- Warning icon for recoverable errors, error icon for fatal
- Dismiss button (X) in header
- Error message displayed
- Retry button shown only for recoverable errors
- Custom action buttons rendered from `error.actions` array
- `error-recoverable` styled with warning colors, `error-fatal` with error colors
- Banner slides in from top with animation

---

### T4.4.14: WelcomeScreen

**File**: `packages/vscode/src/webview/ui/components/WelcomeScreen.tsx`

```tsx
interface WelcomeScreenProps {
  onStartChat: (message: string) => void;
}

const QUICK_STARTS = [
  { label: "Explain this codebase", prompt: "Explain the structure of this codebase and its main components." },
  { label: "Find bugs", prompt: "Review the current workspace for potential bugs or issues." },
  { label: "Write tests", prompt: "Generate tests for the main source files in this project." },
  { label: "Refactor code", prompt: "Suggest refactoring improvements for this codebase." },
];

export function WelcomeScreen({ onStartChat }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-logo">
        <span className="codicon codicon-sparkle welcome-icon" />
      </div>
      <h1 className="welcome-title">Agent-X</h1>
      <p className="welcome-subtitle">AI-powered coding assistant</p>
      <div className="welcome-tips">
        <h3 className="welcome-tips-title">Quick Start</h3>
        <div className="welcome-tips-grid">
          {QUICK_STARTS.map((tip) => (
            <button key={tip.label} className="welcome-tip" onClick={() => onStartChat(tip.prompt)}>
              <span className="welcome-tip-label">{tip.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="welcome-hints">
        <p>Type a message below or use slash commands:</p>
        <div className="welcome-hint-list">
          <span className="welcome-hint"><code>/help</code> — Show help</span>
          <span className="welcome-hint"><code>/model</code> — Switch model</span>
          <span className="welcome-hint"><code>/plan</code> — Toggle plan mode</span>
        </div>
      </div>
    </div>
  );
}
```

**Acceptance Criteria**:
- Agent-X branding with sparkle icon
- Title and subtitle
- 4 quick start buttons that send pre-defined prompts
- Quick start grid layout (2x2)
- Hints section showing common slash commands
- Clean, centered layout
- Quick start buttons styled as cards with hover effects

---

## PART 4 — CSS, Protocol, Markdown, Verification

### T4.5: Webview CSS

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/webview/ui/styles.css`
**Estimated Effort**: 4 hours

#### T4.5.1: Full Stylesheet

```css
/* packages/vscode/src/webview/ui/styles.css */

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  overflow: hidden;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background-color: var(--vscode-editor-background);
}

#root { height: 100%; }

.agentx-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* Chat Container */
.chat-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
  position: relative;
  scroll-behavior: smooth;
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}

.scroll-to-bottom {
  position: sticky;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--vscode-widget-border);
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  z-index: 10;
}

.scroll-to-bottom:hover {
  background: var(--vscode-button-secondaryHoverBackground);
}

/* Message Bubbles */
.message-bubble {
  max-width: 95%;
  padding: 8px 12px;
  border-radius: 8px;
  word-wrap: break-word;
  overflow-wrap: break-word;
  animation: fadeIn 0.2s ease-in;
}

.message-user {
  align-self: flex-end;
  background-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-bottom-right-radius: 2px;
}

.message-assistant {
  align-self: flex-start;
  background-color: var(--vscode-editor-inactiveSelectionBackground);
  border-bottom-left-radius: 2px;
}

.message-tool {
  align-self: flex-start;
  background-color: var(--vscode-textBlockQuote-background);
  border-left: 3px solid var(--vscode-textBlockQuote-border);
  font-family: var(--vscode-editor-font-family);
  font-size: calc(var(--vscode-editor-font-size) * 0.9);
}

.message-streaming {
  border-left: 3px solid var(--vscode-focusBorder);
}

.message-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding-bottom: 4px;
  font-size: 0.85em;
  opacity: 0.8;
}

.message-content { line-height: 1.5; }

.message-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: 0.75em;
  opacity: 0.6;
}

.message-timestamp { font-variant-numeric: tabular-nums; }
.message-cost { font-variant-numeric: tabular-nums; }
.message-elapsed { font-variant-numeric: tabular-nums; }

.copy-button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  opacity: 0.5;
  margin-left: auto;
}

.copy-button:hover { opacity: 1; }

.collapse-toggle {
  margin-left: auto;
  font-weight: bold;
  font-family: monospace;
}

.tool-status-success { color: var(--vscode-testing-iconPassed); }
.tool-status-error { color: var(--vscode-errorForeground); }
.tool-status-running { color: var(--vscode-charts-yellow); }

/* Markdown Content */
.markdown-content h1, .markdown-content h2, .markdown-content h3,
.markdown-content h4, .markdown-content h5, .markdown-content h6 {
  margin-top: 12px;
  margin-bottom: 6px;
  font-weight: 600;
}

.markdown-content h1 { font-size: 1.4em; }
.markdown-content h2 { font-size: 1.2em; }
.markdown-content h3 { font-size: 1.1em; }
.markdown-content p { margin-bottom: 8px; }
.markdown-content ul, .markdown-content ol { padding-left: 20px; margin-bottom: 8px; }
.markdown-content li { margin-bottom: 2px; }

.markdown-content a {
  color: var(--vscode-textLink-foreground);
  text-decoration: none;
}

.markdown-content a:hover {
  color: var(--vscode-textLink-activeForeground);
  text-decoration: underline;
}

.markdown-content blockquote {
  border-left: 3px solid var(--vscode-textBlockQuote-border);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--vscode-textBlockQuote-foreground);
}

.markdown-content code {
  background-color: var(--vscode-textCodeBlock-background);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
  font-size: calc(var(--vscode-editor-font-size) * 0.95);
}

.markdown-content pre {
  background-color: var(--vscode-textCodeBlock-background);
  padding: 10px 12px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 8px 0;
  position: relative;
}

.markdown-content pre code {
  background: none;
  padding: 0;
  border-radius: 0;
}

.markdown-content table {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
}

.markdown-content th, .markdown-content td {
  border: 1px solid var(--vscode-widget-border);
  padding: 4px 8px;
  text-align: left;
}

.markdown-content th {
  background-color: var(--vscode-editor-inactiveSelectionBackground);
  font-weight: 600;
}

.markdown-content img { max-width: 100%; border-radius: 4px; }

.markdown-content hr {
  border: none;
  border-top: 1px solid var(--vscode-widget-border);
  margin: 12px 0;
}

.markdown-content input[type="checkbox"] { margin-right: 6px; }

.code-block-wrapper { position: relative; }

.code-block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  background-color: var(--vscode-editorWidget-background);
  border-bottom: 1px solid var(--vscode-widget-border);
  font-size: 0.8em;
  border-radius: 4px 4px 0 0;
}

.code-block-lang { opacity: 0.7; text-transform: uppercase; }

.code-block-copy {
  background: none;
  border: none;
  color: var(--vscode-foreground);
  cursor: pointer;
  padding: 2px 6px;
  opacity: 0.6;
  font-size: 0.9em;
}

.code-block-copy:hover { opacity: 1; }

.tool-output {
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--vscode-editor-font-family);
  font-size: calc(var(--vscode-editor-font-size) * 0.9);
  margin: 0;
}

/* Streaming Cursor */
.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background-color: var(--vscode-focusBorder);
  margin-left: 2px;
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
}

/* Tool Card */
.tool-card {
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  padding: 8px;
  background-color: var(--vscode-editorWidget-background);
  animation: slideIn 0.2s ease-out;
}

.tool-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.tool-card-icon { font-size: 14px; }
.tool-card-status-running .tool-card-icon { color: var(--vscode-charts-yellow); }
.tool-card-status-success .tool-card-icon { color: var(--vscode-testing-iconPassed); }
.tool-card-status-error .tool-card-icon { color: var(--vscode-errorForeground); }
.tool-card-name { font-weight: 600; flex: 1; }
.tool-card-elapsed { font-variant-numeric: tabular-nums; opacity: 0.7; font-size: 0.85em; }
.tool-card-toggle { opacity: 0.5; font-size: 12px; }

.tool-card-description {
  font-size: 0.85em;
  opacity: 0.7;
  margin-top: 4px;
  padding-left: 20px;
}

.tool-card-output {
  margin-top: 8px;
  padding: 8px;
  background-color: var(--vscode-textCodeBlock-background);
  border-radius: 4px;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
}

.tool-card-output pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--vscode-editor-font-family);
  font-size: calc(var(--vscode-editor-font-size) * 0.85);
}

.tool-card-error {
  margin-top: 8px;
  padding: 8px;
  background-color: var(--vscode-inputValidation-errorBackground);
  border: 1px solid var(--vscode-inputValidation-errorBorder);
  border-radius: 4px;
}

.tool-card-error pre {
  margin: 0;
  white-space: pre-wrap;
  color: var(--vscode-errorForeground);
  font-family: var(--vscode-editor-font-family);
  font-size: calc(var(--vscode-editor-font-size) * 0.85);
}

/* Permission Modal */
.permission-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  animation: fadeIn 0.15s ease-in;
}

.permission-modal {
  background-color: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.2s ease-out;
}

.permission-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-widget-border);
  font-weight: 600;
}

.permission-body { padding: 12px 16px; }
.permission-field { margin-bottom: 10px; }

.permission-field label {
  display: block;
  font-size: 0.8em;
  opacity: 0.6;
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.permission-value { font-weight: 500; }

.permission-path {
  font-family: var(--vscode-editor-font-family);
  font-size: 0.9em;
  word-break: break-all;
}

.permission-risk { font-weight: 700; font-size: 0.9em; }

.permission-actions {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--vscode-widget-border);
}

.permission-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85em;
  font-family: inherit;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.permission-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

.permission-btn kbd {
  font-size: 0.75em;
  opacity: 0.5;
  margin-left: 4px;
  padding: 1px 4px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 2px;
}

.permission-btn-allow-once, .permission-btn-allow-always {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}

.permission-btn-allow-once:hover, .permission-btn-allow-always:hover {
  background: var(--vscode-button-hoverBackground);
}

.permission-btn-deny:hover {
  background: var(--vscode-inputValidation-errorBackground);
  border-color: var(--vscode-inputValidation-errorBorder);
}

/* Plan View */
.plan-view {
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  background-color: var(--vscode-editorWidget-background);
  overflow: hidden;
  animation: slideIn 0.2s ease-out;
}

.plan-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--vscode-widget-border);
  font-weight: 600;
}

.plan-status {
  margin-left: auto;
  font-size: 0.8em;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: capitalize;
}

.plan-status-pending { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.plan-status-approved, .plan-status-completed { background: var(--vscode-testing-iconPassed); color: white; }
.plan-status-executing { background: var(--vscode-charts-yellow); color: black; }
.plan-status-rejected { background: var(--vscode-errorForeground); color: white; }

.plan-progress { display: flex; align-items: center; gap: 8px; padding: 8px 12px; }

.plan-progress-bar {
  flex: 1;
  height: 4px;
  background-color: var(--vscode-progressBar-background);
  border-radius: 2px;
  overflow: hidden;
}

.plan-progress-fill {
  height: 100%;
  background-color: var(--vscode-progressBar-background);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.plan-progress-text { font-size: 0.8em; opacity: 0.7; white-space: nowrap; }
.plan-steps { padding: 4px 0; }
.plan-step { padding: 6px 12px; }
.plan-step-header { display: flex; align-items: center; gap: 6px; }
.plan-step-icon { font-size: 14px; flex-shrink: 0; }
.plan-step-pending .plan-step-icon { color: var(--vscode-descriptionForeground); }
.plan-step-approved .plan-step-icon, .plan-step-done .plan-step-icon { color: var(--vscode-testing-iconPassed); }
.plan-step-executing .plan-step-icon { color: var(--vscode-charts-yellow); }
.plan-step-failed .plan-step-icon { color: var(--vscode-errorForeground); }
.plan-step-skipped .plan-step-icon { color: var(--vscode-descriptionForeground); }
.plan-step-number { font-weight: 600; font-size: 0.85em; opacity: 0.6; min-width: 20px; }
.plan-step-description { flex: 1; font-size: 0.9em; }
.plan-step-result { margin-top: 4px; padding-left: 36px; font-size: 0.85em; opacity: 0.8; }
.plan-step-error { margin-top: 4px; padding-left: 36px; font-size: 0.85em; color: var(--vscode-errorForeground); }
.plan-step-actions { display: flex; gap: 4px; margin-top: 4px; padding-left: 36px; }

.plan-step-btn {
  padding: 2px 8px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 3px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  cursor: pointer;
  font-size: 0.8em;
  font-family: inherit;
}

.plan-step-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

.plan-step-btn-approve {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.plan-step-modify { display: flex; gap: 4px; margin-top: 4px; padding-left: 36px; }

.plan-step-modify-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border);
  border-radius: 3px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font-family: inherit;
  font-size: 0.85em;
}

.plan-actions {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--vscode-widget-border);
}

.plan-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  font-family: inherit;
}

.plan-btn-approve {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}

.plan-btn-approve:hover { background: var(--vscode-button-hoverBackground); }

.plan-btn-reject {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}

.plan-btn-reject:hover {
  background: var(--vscode-inputValidation-errorBackground);
  border-color: var(--vscode-inputValidation-errorBorder);
}

/* Sub-Agent Card */
.sub-agent-card {
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  padding: 8px 12px;
  background-color: var(--vscode-editorWidget-background);
  animation: slideIn 0.2s ease-out;
}

.sub-agent-header { display: flex; align-items: center; gap: 6px; }
.sub-agent-icon { font-size: 14px; }
.sub-agent-running .sub-agent-icon { color: var(--vscode-charts-yellow); }
.sub-agent-complete .sub-agent-icon { color: var(--vscode-testing-iconPassed); }
.sub-agent-task { flex: 1; font-weight: 500; font-size: 0.9em; }
.sub-agent-elapsed { font-variant-numeric: tabular-nums; opacity: 0.7; font-size: 0.8em; }
.sub-agent-id { font-size: 0.75em; opacity: 0.5; margin-top: 2px; font-family: var(--vscode-editor-font-family); }

.sub-agent-summary {
  margin-top: 6px;
  padding: 6px 8px;
  background-color: var(--vscode-textCodeBlock-background);
  border-radius: 4px;
  font-size: 0.85em;
}

/* Reasoning Indicator */
.reasoning-indicator {
  padding: 8px 12px;
  border-radius: 6px;
  background-color: var(--vscode-editorWidget-background);
  border-left: 3px solid var(--vscode-charts-yellow);
  animation: fadeIn 0.3s ease-in;
}

.reasoning-header { display: flex; align-items: center; gap: 6px; }
.reasoning-icon { color: var(--vscode-charts-yellow); animation: pulse 2s ease-in-out infinite; }
.reasoning-label { font-weight: 600; font-size: 0.85em; opacity: 0.8; }
.reasoning-dots { display: flex; gap: 3px; }

.reasoning-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: var(--vscode-foreground);
  opacity: 0.4;
  animation: dotPulse 1.4s ease-in-out infinite;
}

.reasoning-dot:nth-child(2) { animation-delay: 0.2s; }
.reasoning-dot:nth-child(3) { animation-delay: 0.4s; }

.reasoning-text {
  margin-top: 6px;
  font-size: 0.85em;
  opacity: 0.7;
  font-style: italic;
  animation: fadeIn 0.5s ease-in;
}

/* Todo Panel */
.todo-panel {
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  background-color: var(--vscode-editorWidget-background);
  overflow: hidden;
}

.todo-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--vscode-widget-border);
}

.todo-title { font-weight: 600; font-size: 0.9em; }
.todo-count { margin-left: auto; font-size: 0.8em; opacity: 0.6; }
.todo-toggle { font-size: 12px; opacity: 0.5; }
.todo-list { padding: 4px 0; }
.todo-item { display: flex; align-items: center; gap: 6px; padding: 4px 12px; }
.todo-item-icon { font-size: 14px; flex-shrink: 0; }
.todo-item-pending .todo-item-icon { color: var(--vscode-descriptionForeground); }
.todo-item-in-progress .todo-item-icon { color: var(--vscode-charts-yellow); }
.todo-item-completed .todo-item-icon { color: var(--vscode-testing-iconPassed); }
.todo-item-text { font-size: 0.9em; }
.todo-item-completed .todo-item-text { text-decoration: line-through; opacity: 0.5; }

/* Diff Preview */
.diff-preview {
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  overflow: hidden;
  background-color: var(--vscode-editorWidget-background);
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-widget-border);
}

.diff-filename { font-weight: 600; font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
.diff-path { font-size: 0.75em; opacity: 0.5; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.diff-view-toggle { display: flex; gap: 2px; margin-left: auto; }

.diff-view-btn {
  padding: 2px 8px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 3px;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  font-size: 0.75em;
  font-family: inherit;
}

.diff-view-btn.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.diff-content { overflow-x: auto; max-height: 400px; overflow-y: auto; }

.diff-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--vscode-editor-font-family);
  font-size: calc(var(--vscode-editor-font-size) * 0.85);
}

.diff-line { line-height: 1.4; }
.diff-line-num { width: 40px; padding: 0 6px; text-align: right; opacity: 0.4; user-select: none; vertical-align: top; font-size: 0.85em; }
.diff-line-prefix { width: 16px; text-align: center; opacity: 0.6; user-select: none; vertical-align: top; }
.diff-line-content { padding: 0 8px; white-space: pre-wrap; word-break: break-all; }
.diff-line-add { background-color: var(--vscode-diffEditor-insertedTextBackground); }
.diff-line-remove { background-color: var(--vscode-diffEditor-removedTextBackground); }
.diff-line-header { background-color: var(--vscode-editorWidget-background); color: var(--vscode-descriptionForeground); }
.diff-split { display: flex; }
.diff-split-old, .diff-split-new { flex: 1; overflow-x: auto; }
.diff-split-old { border-right: 1px solid var(--vscode-widget-border); }

/* Input Area */
.input-area {
  border-top: 1px solid var(--vscode-widget-border);
  padding: 8px;
  background-color: var(--vscode-editor-background);
  position: relative;
}

.input-row { display: flex; align-items: flex-end; gap: 6px; }

.input-textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--vscode-input-border);
  border-radius: 6px;
  padding: 8px 10px;
  background-color: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.4;
  min-height: 36px;
  max-height: 200px;
  outline: none;
}

.input-textarea:focus { border-color: var(--vscode-focusBorder); }
.input-textarea::placeholder { color: var(--vscode-input-placeholderForeground); }
.input-actions { display: flex; gap: 4px; }

.input-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.input-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.input-btn-send {
  background-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.input-btn-send:hover:not(:disabled) { background-color: var(--vscode-button-hoverBackground); }

.input-btn-steer {
  background-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.input-btn-cancel {
  background-color: var(--vscode-button-secondaryBackground);
  color: var(--vscode-errorForeground);
}

.input-btn-cancel:hover { background-color: var(--vscode-inputValidation-errorBackground); }

.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  font-size: 0.75em;
  opacity: 0.5;
  min-height: 16px;
}

.input-char-count { font-variant-numeric: tabular-nums; }
.input-steer-hint { font-style: italic; color: var(--vscode-charts-yellow); opacity: 1; }

/* Slash Command Menu */
.slash-menu {
  position: absolute;
  bottom: 100%;
  left: 8px;
  right: 8px;
  background-color: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.2);
  max-height: 200px;
  overflow-y: auto;
  z-index: 50;
  animation: slideUp 0.15s ease-out;
}

.slash-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
}

.slash-menu-item:hover, .slash-menu-item.selected {
  background-color: var(--vscode-list-hoverBackground);
}

.slash-menu-command {
  font-family: var(--vscode-editor-font-family);
  font-weight: 600;
  font-size: 0.9em;
  color: var(--vscode-textLink-foreground);
}

.slash-menu-description { font-size: 0.8em; opacity: 0.6; }

/* Webview Status Bar */
.webview-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-top: 1px solid var(--vscode-widget-border);
  background-color: var(--vscode-sideBar-background);
  font-size: 0.75em;
  opacity: 0.8;
  flex-wrap: wrap;
  min-height: 24px;
}

.status-item { display: flex; align-items: center; gap: 3px; white-space: nowrap; }
.status-model-text { max-width: 100px; overflow: hidden; text-overflow: ellipsis; }

.token-bar {
  width: 40px;
  height: 4px;
  background-color: var(--vscode-progressBar-background);
  border-radius: 2px;
  overflow: hidden;
}

.token-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease, background-color 0.3s ease;
}

.token-text { font-variant-numeric: tabular-nums; }

/* Error Banner */
.error-banner {
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-widget-border);
  animation: slideDown 0.2s ease-out;
}

.error-recoverable {
  background-color: var(--vscode-inputValidation-warningBackground);
  border-left: 3px solid var(--vscode-inputValidation-warningBorder);
}

.error-fatal {
  background-color: var(--vscode-inputValidation-errorBackground);
  border-left: 3px solid var(--vscode-inputValidation-errorBorder);
}

.error-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.error-code { font-weight: 600; font-family: var(--vscode-editor-font-family); font-size: 0.85em; }

.error-dismiss {
  margin-left: auto;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  opacity: 0.6;
}

.error-dismiss:hover { opacity: 1; }
.error-message { font-size: 0.9em; line-height: 1.4; }
.error-actions { display: flex; gap: 6px; margin-top: 6px; }

.error-btn {
  padding: 4px 10px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 3px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  cursor: pointer;
  font-size: 0.8em;
  font-family: inherit;
  display: flex;
  align-items: center;
  gap: 4px;
}

.error-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

.error-btn-retry {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

/* Welcome Screen */
.welcome-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  overflow-y: auto;
}

.welcome-logo { margin-bottom: 12px; }
.welcome-icon { font-size: 48px; color: var(--vscode-button-background); }
.welcome-title { font-size: 1.5em; font-weight: 700; margin-bottom: 4px; }
.welcome-subtitle { font-size: 0.9em; opacity: 0.6; margin-bottom: 24px; }
.welcome-tips { width: 100%; max-width: 360px; margin-bottom: 20px; }
.welcome-tips-title { font-size: 0.85em; opacity: 0.6; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.welcome-tips-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

.welcome-tip {
  padding: 10px 12px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85em;
  text-align: left;
  transition: background-color 0.15s ease;
}

.welcome-tip:hover {
  background: var(--vscode-button-secondaryHoverBackground);
  border-color: var(--vscode-focusBorder);
}

.welcome-hints { font-size: 0.8em; opacity: 0.5; }
.welcome-hint-list { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 6px; }

.welcome-hint code {
  background-color: var(--vscode-textCodeBlock-background);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--vscode-editor-font-family);
}

/* Animations */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
@keyframes dotPulse { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.2); } }

/* Highlight.js Theme Integration */
.hljs { background: transparent !important; padding: 0 !important; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-name, .hljs-tag { color: var(--vscode-symbolIcon-keywordForeground, #569cd6); }
.hljs-string, .hljs-title, .hljs-section, .hljs-attribute, .hljs-literal, .hljs-type, .hljs-addition { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
.hljs-comment, .hljs-quote, .hljs-deletion, .hljs-meta { color: var(--vscode-symbolIcon-constantForeground, #6a9955); }
.hljs-number, .hljs-regexp, .hljs-symbol, .hljs-bullet, .hljs-link { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
.hljs-variable, .hljs-template-variable { color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); }
.hljs-function .hljs-title { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
.hljs-class .hljs-title { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }

/* Scrollbar Styling */
.chat-container::-webkit-scrollbar { width: 8px; }
.chat-container::-webkit-scrollbar-track { background: transparent; }
.chat-container::-webkit-scrollbar-thumb { background-color: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
.chat-container::-webkit-scrollbar-thumb:hover { background-color: var(--vscode-scrollbarSlider-hoverBackground); }
.chat-container::-webkit-scrollbar-thumb:active { background-color: var(--vscode-scrollbarSlider-activeBackground); }
```

#### T4.5.2: CSS Acceptance Criteria

- All colors use VS Code CSS custom properties (`--vscode-*`) for automatic light/dark theme support
- No hardcoded colors except for fallback values in highlight.js integration
- Flexbox layout for chat container (column direction)
- Message bubbles use `align-self` for left/right alignment
- Responsive design: `max-width: 95%` for messages, `max-width: 400px` for modal
- All animations use `@keyframes` with `ease` timing functions
- Scrollbar styled to match VS Code theme
- Code blocks use editor font family and code block background
- All interactive elements have `:hover` states
- CSP-safe: no `url()` references to external resources

---

### T4.6: Message Protocol

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/webview/protocol.ts`
**Estimated Effort**: 2 hours

#### T4.6.1: Protocol Type Definitions

**File**: `packages/vscode/src/webview/protocol.ts`

```typescript
export interface ExtensionToWebviewMessages {
  appendMessage: {
    id: string;
    role: "user" | "assistant" | "tool";
    content: string;
    timestamp: number;
    tokenCost?: number;
    toolName?: string;
    toolStatus?: "running" | "success" | "error";
    toolElapsed?: number;
  };
  updateStream: {
    content: string;
    fullContent: string;
  };
  streamStart: Record<string, never>;
  streamEnd: Record<string, never>;
  toolExecuting: {
    tool: string;
    description: string;
    startTime: number;
  };
  toolComplete: {
    tool: string;
    result: string;
    elapsed: number;
  };
  permissionRequired: {
    requestId: string;
    tool: string;
    path: string;
    riskLevel: "low" | "medium" | "high" | "critical";
    description: string;
  };
  planUpdate: {
    action: "generated" | "stepUpdate";
    plan?: {
      planId: string;
      title: string;
      status: string;
      steps: Array<{
        stepId: string;
        description: string;
        status: string;
        result?: string;
        error?: string;
      }>;
    };
    userRequest?: string;
    stepId?: string;
    planId?: string;
    status?: string;
    result?: string;
    error?: string;
  };
  subAgentUpdate: {
    agentId: string;
    task: string;
    status: "running" | "complete";
    startTime: number;
    summary?: string;
    elapsed?: number;
  };
  reasoningUpdate: {
    action: "start" | "glimpse" | "complete";
    text?: string;
  };
  todoUpdate: {
    items: Array<{
      id: string;
      text: string;
      status: "pending" | "in-progress" | "completed";
    }>;
  };
  diffPreview: {
    tool: string;
    filePath: string;
    diff: string;
    oldContent: string;
    newContent: string;
  };
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    actions?: Array<{ label: string; action: string }>;
  };
  clearMessages: Record<string, never>;
  sessionRestored: {
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
    }>;
    title: string;
  };
  statusUpdate: {
    tokens?: {
      used: number;
      total: number;
      percentage: number;
      cost: number;
    };
    provider?: string;
    model?: string;
    workspaceRoot?: string;
  };
  loadingStart: {
    stage: string;
  };
  loadingEnd: Record<string, never>;
}

export interface WebviewToExtensionMessages {
  sendMessage: {
    content: string;
  };
  cancelProcessing: Record<string, never>;
  permissionRespond: {
    requestId: string;
    decision: "allow-once" | "allow-always" | "deny";
  };
  planApprove: {
    planId: string;
  };
  planReject: {
    planId: string;
  };
  stepApprove: {
    stepId: string;
    planId: string;
  };
  stepSkip: {
    stepId: string;
    planId: string;
  };
  stepModify: {
    stepId: string;
    planId: string;
    modification: string;
  };
  clarificationResponse: {
    questionId: string;
    response: string;
  };
  steerMessage: {
    instruction: string;
  };
  ready: Record<string, never>;
  scrollToBottom: Record<string, never>;
}
```

#### T4.6.2: Extension to Webview Messages — Summary

| Message Type | Direction | Payload | Trigger |
|---|---|---|---|
| `appendMessage` | Ext→Web | message object | `message_sent` / `message_received` events |
| `updateStream` | Ext→Web | `{ content, fullContent }` | `stream_chunk` event |
| `streamStart` | Ext→Web | `{}` | `stream_start` event |
| `streamEnd` | Ext→Web | `{}` | `stream_end` event |
| `toolExecuting` | Ext→Web | `{ tool, description, startTime }` | `tool_executing` event |
| `toolComplete` | Ext→Web | `{ tool, result, elapsed }` | `tool_complete` event |
| `permissionRequired` | Ext→Web | `{ requestId, tool, path, riskLevel, description }` | `permission_required` event |
| `planUpdate` | Ext→Web | `{ action, plan?, stepId?, status? }` | `plan_generated` / `plan_step_*` events |
| `subAgentUpdate` | Ext→Web | `{ agentId, task, status, startTime, summary?, elapsed? }` | `agent_spawned` / `agent_progress` / `agent_complete` |
| `reasoningUpdate` | Ext→Web | `{ action, text? }` | `reasoning_start` / `reasoning_glimpse` / `reasoning_complete` |
| `todoUpdate` | Ext→Web | `{ items }` | `todo_update` event |
| `diffPreview` | Ext→Web | `{ tool, filePath, diff, oldContent, newContent }` | `diff_preview` event |
| `error` | Ext→Web | `{ code, message, recoverable, actions? }` | `error` event |
| `clearMessages` | Ext→Web | `{}` | Session cleared |
| `sessionRestored` | Ext→Web | `{ messages, title }` | Session restored |
| `statusUpdate` | Ext→Web | `{ tokens?, provider?, model?, workspaceRoot? }` | `token_usage` / config change |
| `loadingStart` | Ext→Web | `{ stage }` | `loading_start` event |
| `loadingEnd` | Ext→Web | `{}` | `loading_end` event |

#### T4.6.3: Webview to Extension Messages — Summary

| Message Type | Direction | Payload | Trigger |
|---|---|---|---|
| `sendMessage` | Web→Ext | `{ content }` | User sends message |
| `cancelProcessing` | Web→Ext | `{}` | User clicks cancel |
| `permissionRespond` | Web→Ext | `{ requestId, decision }` | User responds to permission modal |
| `planApprove` | Web→Ext | `{ planId }` | User approves plan |
| `planReject` | Web→Ext | `{ planId }` | User rejects plan |
| `stepApprove` | Web→Ext | `{ stepId, planId }` | User approves plan step |
| `stepSkip` | Web→Ext | `{ stepId, planId }` | User skips plan step |
| `stepModify` | Web→Ext | `{ stepId, planId, modification }` | User modifies plan step |
| `clarificationResponse` | Web→Ext | `{ questionId, response }` | User answers clarification |
| `steerMessage` | Web→Ext | `{ instruction }` | User sends steer while processing |
| `ready` | Web→Ext | `{}` | Webview finished loading |
| `scrollToBottom` | Web→Ext | `{}` | Request scroll to bottom |

**Acceptance Criteria**:
- All 18 extension-to-webview message types defined with typed payloads
- All 12 webview-to-extension message types defined with typed payloads
- TypeScript interfaces exported for compile-time checking
- Message types match the event names from Phase 2's EventBridge
- Every message type has a corresponding handler in `App.tsx` and `ChatViewProvider.ts`

---

### T4.7: Markdown + Code Highlighting

**Status**: ⬜ Not Started
**File**: `packages/vscode/src/webview/ui/markdown.ts`
**Estimated Effort**: 3 hours

#### T4.7.1: Markdown Renderer

```typescript
import { marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
  const highlighted = hljs.highlight(text, { language }).value;
  const langLabel = language !== "plaintext" ? language : "";

  return `<div class="code-block-wrapper">
    <div class="code-block-header">
      <span class="code-block-lang">${langLabel}</span>
      <button class="code-block-copy" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').textContent)">Copy</button>
    </div>
    <pre><code class="hljs language-${language}">${highlighted}</code></pre>
  </div>`;
};

renderer.link = function ({ href, text }: { href: string; text: string }): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

renderer.image = function ({ href, text }: { href: string; text: string }): string {
  return `<img src="${href}" alt="${text}" loading="lazy" />`;
};

renderer.table = function ({ header, body }: { header: string; body: string }): string {
  return `<table><thead>${header}</thead><tbody>${body}</tbody></table>`;
};

renderer.listitem = function ({ text, task, checked }: { text: string; task: boolean; checked: boolean }): string {
  if (task) {
    return `<li><input type="checkbox" ${checked ? "checked" : ""} disabled /> ${text}</li>`;
  }
  return `<li>${text}</li>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content) as string;
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ["input"],
    ADD_ATTR: ["checked", "disabled", "type", "target", "rel", "loading", "onclick"],
  });
}
```

**Acceptance Criteria**:
- `marked` configured with GFM (GitHub Flavored Markdown) and line breaks
- Custom renderer for code blocks with:
  - Language detection via `hljs.getLanguage()`
  - Syntax highlighting via `hljs.highlight()`
  - Language label in header
  - Copy button that copies code content to clipboard
  - Wrapper div for positioning
- Custom renderer for links: opens in external browser (`target="_blank"`)
- Custom renderer for images: lazy loading
- Custom renderer for tables: proper `<table>` structure
- Custom renderer for task lists: checkbox inputs
- `DOMPurify.sanitize()` strips all potentially dangerous HTML
- Allowed tags: `input` (for checkboxes)
- Allowed attributes: `checked`, `disabled`, `type`, `target`, `rel`, `loading`, `onclick`
- Exported `renderMarkdown()` function used by `MessageBubble` and `StreamingMessage`

#### T4.7.2: Highlight.js Language Registration

To keep bundle size manageable, register only common languages:

```typescript
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import csharp from "highlight.js/lib/languages/csharp";
import cpp from "highlight.js/lib/languages/cpp";
import ruby from "highlight.js/lib/languages/ruby";
import php from "highlight.js/lib/languages/php";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import toml from "highlight.js/lib/languages/ini";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("cs", csharp);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", cpp);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rb", ruby);
hljs.registerLanguage("php", php);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("toml", toml);
hljs.registerLanguage("ini", toml);
```

**Acceptance Criteria**:
- 20 languages registered (covering most common use cases)
- Short aliases registered (js, ts, py, sh, etc.)
- Uses `highlight.js/lib/core` for tree-shaking (only registered languages included)
- Bundle size kept under 200KB for highlight.js portion

---

### T4.8: Verification

**Status**: ⬜ Not Started
**Estimated Effort**: 4 hours

#### T4.8.1: Message Rendering Tests

| Test | Steps | Expected Result |
|---|---|---|
| User message | Send a message via InputArea | Right-aligned bubble with accent background, markdown rendered |
| Assistant message | Receive assistant response | Left-aligned bubble, markdown rendered, copy button visible |
| Tool message | Tool executes and completes | Collapsible tool card with monospace output, status indicator |
| Markdown headings | Send message with `# H1`, `## H2` | Proper heading sizes rendered |
| Markdown lists | Send message with `- item` and `1. item` | Bullet and numbered lists rendered |
| Markdown code inline | Send message with `` `code` `` | Inline code with background highlight |
| Markdown code block | Send message with triple-backtick block | Syntax-highlighted block with language label and copy button |
| Markdown links | Send message with `[text](url)` | Clickable link that opens externally |
| Markdown tables | Send message with pipe-delimited table | Rendered HTML table with borders |
| Markdown task lists | Send message with `- [x] done` and `- [ ] todo` | Checkboxes rendered, checked state correct |
| Markdown blockquotes | Send message with `> quote` | Left-bordered blockquote |
| Copy button | Click copy button on code block | Code text copied to clipboard, button shows check icon |
| Copy message | Click copy button on message footer | Full message text copied to clipboard |

#### T4.8.2: Streaming Tests

| Test | Steps | Expected Result |
|---|---|---|
| Stream start | Engine begins streaming | Streaming cursor appears, `isProcessing` true |
| Stream chunks | Multiple `updateStream` messages | Content progressively grows, markdown re-renders |
| Stream at 60fps | Rapid chunk updates (16ms interval) | No jank, smooth text appearance, cursor follows |
| Stream end | `streamEnd` message | Content finalized as assistant message, cursor removed |
| Auto-scroll during stream | Stream while at bottom | Auto-scrolls to keep cursor visible |
| No auto-scroll when away | User scrolls up during stream | No auto-scroll, scroll-to-bottom button appears |

#### T4.8.3: Permission Modal Tests

| Test | Steps | Expected Result |
|---|---|---|
| Modal appears | `permissionRequired` message | Overlay + modal centered on screen |
| Risk level colors | Low/medium/high/critical requests | Green/yellow/orange/red text |
| Allow Once button | Click "Allow Once" | `permissionRespond` sent with `allow-once`, modal closes |
| Allow Always button | Click "Allow Always" | `permissionRespond` sent with `allow-always`, modal closes |
| Deny button | Click "Deny" | `permissionRespond` sent with `deny`, modal closes |
| Enter key | Press Enter | Same as Allow Once |
| Escape key | Press Escape | Same as Deny |

#### T4.8.4: Plan Approval Tests

| Test | Steps | Expected Result |
|---|---|---|
| Plan display | `planUpdate` with `generated` | Plan title, steps, progress bar shown |
| Step status icons | Steps with various statuses | Correct icons: circle, check, spinner, filled check, error, arrow |
| Approve plan | Click "Approve Plan" | `planApprove` message sent |
| Reject plan | Click "Reject Plan" | `planReject` message sent |
| Step approve | Click "Approve" on step | `stepApprove` message sent |
| Step skip | Click "Skip" on step | `stepSkip` message sent |
| Step modify | Click "Modify", enter text, press Enter | `stepModify` message sent with modification text |
| Progress bar | Steps complete | Progress bar fills proportionally |

#### T4.8.5: Tool Card Lifecycle Tests

| Test | Steps | Expected Result |
|---|---|---|
| Tool executing | `toolExecuting` message | Card appears with spinner, live timer counting |
| Tool complete (success) | `toolComplete` with result | Spinner changes to check, timer stops |
| Tool complete (error) | `toolComplete` with ERROR result | Check changes to X, error section shown |
| Expand output | Click tool card header | Output section expands |
| Collapse output | Click again | Output section collapses |

#### T4.8.6: Error Display Tests

| Test | Steps | Expected Result |
|---|---|---|
| Recoverable error | `error` with `recoverable: true` | Warning banner with retry button |
| Fatal error | `error` with `recoverable: false` | Error banner without retry button |
| Dismiss error | Click X button | Banner disappears |
| Retry | Click "Retry" | Retry action triggered |
| Custom actions | Error with `actions` array | Custom buttons rendered |

#### T4.8.7: Theme Tests

| Test | Steps | Expected Result |
|---|---|---|
| Dark theme | Switch to VS Code dark theme | All colors adapt (dark backgrounds, light text) |
| Light theme | Switch to VS Code light theme | All colors adapt (light backgrounds, dark text) |
| High contrast | Switch to high contrast theme | Borders visible, text readable |
| Theme during session | Switch theme with active chat | All existing messages re-theme correctly |

#### T4.8.8: Responsive Tests

| Test | Steps | Expected Result |
|---|---|---|
| Narrow sidebar | Resize sidebar to minimum width (~200px) | Messages wrap, no horizontal overflow |
| Wide sidebar | Resize sidebar to maximum width (~600px) | Messages use available space |
| Modal at narrow width | Show permission modal at 200px width | Modal fits, buttons wrap if needed |
| Input at narrow width | Type long message at 200px width | Textarea wraps text, auto-grows vertically |
| Status bar at narrow width | Narrow sidebar | Status items wrap to multiple lines |

#### T4.8.9: Lint and Type Check

```bash
pnpm --filter @agentx/vscode run typecheck
pnpm --filter @agentx/vscode run lint
```

Both must pass with zero errors. The webview tsconfig (`tsconfig.webview.json`) must also pass:

```bash
npx tsc --noEmit -p packages/vscode/tsconfig.webview.json
```

---

## File Summary

| File | Purpose | Created In |
|---|---|---|
| `packages/vscode/src/webview/ChatViewProvider.ts` | WebviewViewProvider, message passing, EventBridge wiring | T4.1 |
| `packages/vscode/src/webview/protocol.ts` | Message protocol type definitions | T4.6 |
| `packages/vscode/src/webview/ui/main.tsx` | React entry point | T4.3.2 |
| `packages/vscode/src/webview/ui/App.tsx` | Root component with state management | T4.3.7 |
| `packages/vscode/src/webview/ui/vscodeApi.ts` | VS Code API wrapper | T4.3.3 |
| `packages/vscode/src/webview/ui/messageBus.ts` | Message handler registry | T4.3.4 |
| `packages/vscode/src/webview/ui/useMessageListener.ts` | React hook for message subscription | T4.3.5 |
| `packages/vscode/src/webview/ui/markdown.ts` | Markdown renderer with highlight.js | T4.7 |
| `packages/vscode/src/webview/ui/styles.css` | Full webview stylesheet | T4.5 |
| `packages/vscode/src/webview/ui/components/ChatContainer.tsx` | Main scrollable chat area | T4.4.1 |
| `packages/vscode/src/webview/ui/components/MessageBubble.tsx` | Single message rendering | T4.4.2 |
| `packages/vscode/src/webview/ui/components/StreamingMessage.tsx` | Real-time streaming content | T4.4.3 |
| `packages/vscode/src/webview/ui/components/ToolCard.tsx` | Tool execution display | T4.4.4 |
| `packages/vscode/src/webview/ui/components/PermissionModal.tsx` | Permission request dialog | T4.4.5 |
| `packages/vscode/src/webview/ui/components/PlanView.tsx` | Plan approval interface | T4.4.6 |
| `packages/vscode/src/webview/ui/components/SubAgentCard.tsx` | Sub-agent progress | T4.4.7 |
| `packages/vscode/src/webview/ui/components/ReasoningIndicator.tsx` | Reasoning glimpses | T4.4.8 |
| `packages/vscode/src/webview/ui/components/TodoPanel.tsx` | TODO list | T4.4.9 |
| `packages/vscode/src/webview/ui/components/DiffPreview.tsx` | Code diff display | T4.4.10 |
| `packages/vscode/src/webview/ui/components/InputArea.tsx` | Message input | T4.4.11 |
| `packages/vscode/src/webview/ui/components/StatusBar.tsx` | Webview-internal status bar | T4.4.12 |
| `packages/vscode/src/webview/ui/components/ErrorBanner.tsx` | Error display | T4.4.13 |
| `packages/vscode/src/webview/ui/components/WelcomeScreen.tsx` | First interaction screen | T4.4.14 |
| `packages/vscode/tsconfig.webview.json` | Browser-target TypeScript config | T4.3.6 |
