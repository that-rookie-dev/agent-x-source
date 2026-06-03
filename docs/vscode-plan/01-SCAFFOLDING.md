# Phase 1: Extension Scaffolding

> **Status**: ✅ Complete (Phase 1 — Extension Scaffolding)
> **Completed**: 2026-06-03
> **Depends on**: Nothing
> **Estimated effort**: 2 days
> **Goal**: Create the `packages/vscode/` package with all configuration files, directory structure, build pipeline, and a minimal extension entry point that activates in VS Code.

---

## Task Index

| Task ID | Title | Status | Dependencies |
|---------|-------|--------|-------------|
| T1.1.1 | Create `packages/vscode/` directory | ✅ | None |
| T1.1.2 | Write `packages/vscode/package.json` | ✅ | T1.1.1 |
| T1.1.3 | Write `packages/vscode/tsconfig.json` | ✅ | T1.1.1 |
| T1.1.4 | Write `packages/vscode/.vscodeignore` | ✅ | T1.1.1 |
| T1.1.5 | Write `packages/vscode/eslint.config.js` | ✅ | T1.1.1 |
| T1.2.1 | Define VS Code extension manifest `contributes` section in `package.json` | ✅ | T1.1.2 |
| T1.3.1 | Write `packages/vscode/esbuild.js` | ✅ | T1.1.2 |
| T1.3.2 | Write `packages/vscode/esbuild.webview.js` | ✅ | T1.1.2 |
| T1.3.3 | Write `packages/vscode/src/vscode.d.ts` | ✅ | T1.1.1 |
| T1.4.1 | Create all source subdirectories | ✅ | T1.1.1 |
| T1.4.2 | Create `media/` directory with placeholder SVGs | ✅ | T1.1.1 |
| T1.4.3 | Create `test/` directory structure | ✅ | T1.1.1 |
| T1.5.1 | Verify root `pnpm-workspace.yaml` includes `packages/*` | ✅ | None |
| T1.5.2 | Update root `package.json` lint script to include vscode | ✅ | T1.1.2 |
| T1.5.3 | Write `.vscode/launch.json` for Extension Development Host | ✅ | T1.1.2 |
| T1.5.4 | Write `.vscode/tasks.json` for build/watch | ✅ | T1.3.1 |
| T1.5.5 | Write `.vscode/settings.json` for workspace settings | ✅ | T1.1.1 |
| T1.6.1 | Write `packages/vscode/src/constants.ts` | ✅ | T1.1.2 |
| T1.6.2 | Write `packages/vscode/src/extension.ts` (entry point) | ✅ | T1.6.1 |
| T1.7.1 | Run `pnpm install` from root | ✅ | T1.1.2 |
| T1.7.2 | Run `pnpm --filter @agentx/vscode run build` | ✅ | T1.7.1, T1.3.1, T1.6.2 |
| T1.7.3 | Run `pnpm --filter @agentx/vscode run typecheck` | ✅ | T1.7.1, T1.6.2 |
| T1.7.4 | Run `pnpm --filter @agentx/vscode run lint` | ✅ | T1.7.1, T1.6.2 |
| T1.7.5 | Launch Extension Development Host and verify activation | ⬜ | T1.7.2 |
| T1.Z | Update master plan status | 🔲 | All above |

---

## T1.1: Package Scaffolding

### T1.1.1 — Create `packages/vscode/` directory

- **Status**: ⬜
- **Dependencies**: None
- **Action**: Create the top-level directory for the new package.

```bash
mkdir -p /source/packages/vscode
```

- **Acceptance criteria**:
  - Directory `/source/packages/vscode/` exists.
  - Directory is empty (subsequent tasks populate it).

---

### T1.1.2 — Write `packages/vscode/package.json`

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **File to create**: `packages/vscode/package.json`
- **Action**: Write the following content exactly.

```json
{
  "name": "@agentx/vscode",
  "displayName": "Agent-X",
  "description": "AI-powered coding assistant — native VS Code extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "publisher": "slashpan",
  "license": "MIT",
  "icon": "media/icon.png",
  "engines": {
    "vscode": "^1.90.0"
  },
  "categories": [
    "AI",
    "Machine Learning",
    "Other"
  ],
  "keywords": [
    "ai",
    "agent",
    "copilot",
    "assistant",
    "agentx"
  ],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "agentx.openChat",
        "title": "Open Agent-X Chat",
        "category": "Agent-X",
        "icon": "$(comment-discussion)"
      },
      {
        "command": "agentx.newSession",
        "title": "New Session",
        "category": "Agent-X",
        "icon": "$(add)"
      },
      {
        "command": "agentx.switchModel",
        "title": "Switch Model",
        "category": "Agent-X",
        "icon": "$(circuit-board)"
      },
      {
        "command": "agentx.switchProvider",
        "title": "Switch Provider",
        "category": "Agent-X",
        "icon": "$(cloud)"
      },
      {
        "command": "agentx.switchCrew",
        "title": "Switch Crew / Persona",
        "category": "Agent-X",
        "icon": "$(person)"
      },
      {
        "command": "agentx.cancelTask",
        "title": "Cancel Current Task",
        "category": "Agent-X",
        "icon": "$(stop-circle)"
      },
      {
        "command": "agentx.showSessions",
        "title": "Show Session History",
        "category": "Agent-X",
        "icon": "$(history)"
      },
      {
        "command": "agentx.showPermissions",
        "title": "Manage Permissions",
        "category": "Agent-X",
        "icon": "$(shield)"
      },
      {
        "command": "agentx.compactSession",
        "title": "Compact Session Context",
        "category": "Agent-X",
        "icon": "$(fold)"
      },
      {
        "command": "agentx.clearHistory",
        "title": "Clear Session History",
        "category": "Agent-X",
        "icon": "$(trash)"
      },
      {
        "command": "agentx.exportSession",
        "title": "Export Current Session",
        "category": "Agent-X",
        "icon": "$(export)"
      },
      {
        "command": "agentx.restoreSession",
        "title": "Restore Session",
        "category": "Agent-X",
        "icon": "$(discard)"
      },
      {
        "command": "agentx.deleteSession",
        "title": "Delete Session",
        "category": "Agent-X",
        "icon": "$(trash)"
      },
      {
        "command": "agentx.refreshSessions",
        "title": "Refresh Session List",
        "category": "Agent-X",
        "icon": "$(refresh)"
      },
      {
        "command": "agentx.openSettings",
        "title": "Open Settings",
        "category": "Agent-X",
        "icon": "$(gear)"
      },
      {
        "command": "agentx.showTokenUsage",
        "title": "Show Token Usage",
        "category": "Agent-X",
        "icon": "$(graph)"
      },
      {
        "command": "agentx.addFileToContext",
        "title": "Add File to Context",
        "category": "Agent-X",
        "icon": "$(file-add)"
      },
      {
        "command": "agentx.addSelectionToContext",
        "title": "Add Selection to Context",
        "category": "Agent-X",
        "icon": "$(selection)"
      },
      {
        "command": "agentx.explainSelection",
        "title": "Explain Selection",
        "category": "Agent-X",
        "icon": "$(question)"
      },
      {
        "command": "agentx.refactorSelection",
        "title": "Refactor Selection",
        "category": "Agent-X",
        "icon": "$(edit)"
      },
      {
        "command": "agentx.fixDiagnostics",
        "title": "Fix Diagnostics in File",
        "category": "Agent-X",
        "icon": "$(bug)"
      },
      {
        "command": "agentx.generateTests",
        "title": "Generate Tests for File",
        "category": "Agent-X",
        "icon": "$(beaker)"
      },
      {
        "command": "agentx.steerAgent",
        "title": "Send Steering Instruction",
        "category": "Agent-X",
        "icon": "$(megaphone)"
      },
      {
        "command": "agentx.approvePlan",
        "title": "Approve Plan",
        "category": "Agent-X",
        "icon": "$(check-all)"
      },
      {
        "command": "agentx.rejectPlan",
        "title": "Reject Plan",
        "category": "Agent-X",
        "icon": "$(close-all)"
      },
      {
        "command": "agentx.openMissionControl",
        "title": "Open Mission Control (Setup Wizard)",
        "category": "Agent-X",
        "icon": "$(rocket)"
      }
    ],
    "keybindings": [
      {
        "command": "agentx.openChat",
        "key": "ctrl+shift+a",
        "mac": "cmd+shift+a"
      },
      {
        "command": "agentx.newSession",
        "key": "ctrl+shift+alt+n",
        "mac": "cmd+shift+alt+n"
      },
      {
        "command": "agentx.cancelTask",
        "key": "ctrl+shift+alt+c",
        "mac": "cmd+shift+alt+c"
      },
      {
        "command": "agentx.addSelectionToContext",
        "key": "ctrl+shift+alt+a",
        "mac": "cmd+shift+alt+a",
        "when": "editorHasSelection"
      },
      {
        "command": "agentx.explainSelection",
        "key": "ctrl+shift+alt+e",
        "mac": "cmd+shift+alt+e",
        "when": "editorHasSelection"
      }
    ],
    "configuration": {
      "title": "Agent-X",
      "properties": {
        "agentx.provider": {
          "type": "string",
          "default": "openai",
          "enum": [
            "openai",
            "anthropic",
            "google",
            "ollama",
            "lmstudio",
            "moonshot",
            "deepseek",
            "groq",
            "mistral",
            "together",
            "xai",
            "fireworks",
            "perplexity",
            "azure",
            "cohere"
          ],
          "description": "Active AI provider."
        },
        "agentx.model": {
          "type": "string",
          "default": "",
          "description": "Active model ID. Leave empty to use provider default."
        },
        "agentx.theme": {
          "type": "string",
          "default": "auto",
          "enum": ["auto", "dark", "light"],
          "description": "Chat webview theme. 'auto' follows VS Code theme."
        },
        "agentx.autoApprove": {
          "type": "string",
          "default": "ask",
          "enum": ["ask", "auto-allow-low", "auto-allow-all", "deny-all"],
          "description": "Permission auto-approval policy."
        },
        "agentx.showTokenBar": {
          "type": "boolean",
          "default": true,
          "description": "Show token usage in status bar."
        },
        "agentx.showTimers": {
          "type": "boolean",
          "default": true,
          "description": "Show elapsed time on tool cards."
        },
        "agentx.animationSpeed": {
          "type": "string",
          "default": "normal",
          "enum": ["normal", "fast", "reduced"],
          "description": "Animation speed for streaming text and UI transitions."
        },
        "agentx.maxTokensPerSession": {
          "type": "number",
          "default": 200000,
          "description": "Maximum tokens per session before compaction triggers."
        },
        "agentx.compactionThreshold": {
          "type": "number",
          "default": 0.8,
          "description": "Context window usage ratio (0.0–1.0) that triggers compaction."
        },
        "agentx.enableSubAgents": {
          "type": "boolean",
          "default": true,
          "description": "Allow the agent to spawn sub-agents."
        },
        "agentx.enablePlans": {
          "type": "boolean",
          "default": true,
          "description": "Enable plan mode for multi-step operations."
        },
        "agentx.enableRAG": {
          "type": "boolean",
          "default": false,
          "description": "Enable retrieval-augmented generation with workspace indexing."
        },
        "agentx.disabledTools": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "description": "Tool IDs to disable in the VS Code extension."
        },
        "agentx.telemetry": {
          "type": "boolean",
          "default": false,
          "description": "Enable anonymous telemetry."
        },
        "agentx.logLevel": {
          "type": "string",
          "default": "info",
          "enum": ["debug", "info", "warn", "error"],
          "description": "Output channel log level."
        }
      }
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "agentx-explorer",
          "title": "Agent-X",
          "icon": "media/agentx-activity-bar.svg"
        }
      ]
    },
    "views": {
      "agentx-explorer": [
        {
          "type": "webview",
          "id": "agentx.chatView",
          "name": "Chat",
          "visibility": "visible"
        },
        {
          "id": "agentx.sessionsView",
          "name": "Sessions",
          "visibility": "visible",
          "icon": "$(history)",
          "contextualTitle": "Agent-X Sessions"
        }
      ]
    },
    "menus": {
      "view/title": [
        {
          "command": "agentx.newSession",
          "when": "view == agentx.chatView",
          "group": "navigation@1"
        },
        {
          "command": "agentx.refreshSessions",
          "when": "view == agentx.sessionsView",
          "group": "navigation@1"
        },
        {
          "command": "agentx.clearHistory",
          "when": "view == agentx.sessionsView",
          "group": "navigation@2"
        }
      ],
      "view/item/context": [
        {
          "command": "agentx.restoreSession",
          "when": "view == agentx.sessionsView && viewItem == session",
          "group": "inline@1"
        },
        {
          "command": "agentx.exportSession",
          "when": "view == agentx.sessionsView && viewItem == session",
          "group": "1_actions@1"
        },
        {
          "command": "agentx.deleteSession",
          "when": "view == agentx.sessionsView && viewItem == session",
          "group": "1_actions@2"
        }
      ],
      "editor/context": [
        {
          "command": "agentx.addSelectionToContext",
          "when": "editorHasSelection",
          "group": "agentx@1"
        },
        {
          "command": "agentx.explainSelection",
          "when": "editorHasSelection",
          "group": "agentx@2"
        },
        {
          "command": "agentx.refactorSelection",
          "when": "editorHasSelection",
          "group": "agentx@3"
        },
        {
          "command": "agentx.fixDiagnostics",
          "group": "agentx@4"
        },
        {
          "command": "agentx.generateTests",
          "group": "agentx@5"
        }
      ],
      "explorer/context": [
        {
          "command": "agentx.addFileToContext",
          "group": "agentx@1"
        }
      ],
      "commandPalette": [
        { "command": "agentx.openChat" },
        { "command": "agentx.newSession" },
        { "command": "agentx.switchModel" },
        { "command": "agentx.switchProvider" },
        { "command": "agentx.switchCrew" },
        { "command": "agentx.cancelTask" },
        { "command": "agentx.showSessions" },
        { "command": "agentx.showPermissions" },
        { "command": "agentx.compactSession" },
        { "command": "agentx.clearHistory" },
        { "command": "agentx.exportSession" },
        { "command": "agentx.restoreSession" },
        { "command": "agentx.deleteSession" },
        { "command": "agentx.openSettings" },
        { "command": "agentx.showTokenUsage" },
        { "command": "agentx.addFileToContext" },
        { "command": "agentx.addSelectionToContext", "when": "editorHasSelection" },
        { "command": "agentx.explainSelection", "when": "editorHasSelection" },
        { "command": "agentx.refactorSelection", "when": "editorHasSelection" },
        { "command": "agentx.fixDiagnostics" },
        { "command": "agentx.generateTests" },
        { "command": "agentx.steerAgent" },
        { "command": "agentx.approvePlan" },
        { "command": "agentx.rejectPlan" },
        { "command": "agentx.openMissionControl" }
      ]
    }
  },
  "scripts": {
    "build": "node esbuild.js --production && node esbuild.webview.js --production",
    "watch": "node esbuild.js --watch",
    "watch:webview": "node esbuild.webview.js --watch",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "node ./out/test/runTest.js",
    "package": "vsce package --no-dependencies",
    "clean": "rm -rf dist out"
  },
  "dependencies": {
    "@agentx/engine": "workspace:*",
    "@agentx/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/vscode": "^1.90.0",
    "@vscode/test-electron": "^2.4.0",
    "@vscode/vsce": "^3.0.0",
    "esbuild": "^0.21.0",
    "eslint": "^9.0.0",
    "typescript": "^5.5.0",
    "typescript-eslint": "^8.60.0",
    "@eslint/js": "^9.0.0"
  }
}
```

- **Acceptance criteria**:
  - File exists at `packages/vscode/package.json`.
  - `name` is `@agentx/vscode`.
  - `engines.vscode` is `^1.90.0`.
  - `main` points to `./dist/extension.js`.
  - All 25 commands are listed in `contributes.commands`.
  - All 5 keybindings are listed in `contributes.keybindings`.
  - All 15 configuration properties are listed in `contributes.configuration.properties`.
  - `viewsContainers.activitybar` has the `agentx-explorer` container.
  - `views.agentx-explorer` has both `agentx.chatView` (webview) and `agentx.sessionsView` (tree).
  - `menus` contains `view/title`, `view/item/context`, `editor/context`, `explorer/context`, and `commandPalette` sections.
  - `dependencies` includes `@agentx/engine: workspace:*` and `@agentx/shared: workspace:*`.
  - `devDependencies` includes `@types/vscode`, `@vscode/test-electron`, `esbuild`, `typescript`.

---

### T1.1.3 — Write `packages/vscode/tsconfig.json`

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **File to create**: `packages/vscode/tsconfig.json`
- **Action**: Write the following content exactly.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["node"],
    "lib": ["ES2023"],
    "jsx": "react-jsx"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["node_modules", "dist", "out", "test", "src/webview/ui"]
}
```

- **Rationale**:
  - Extends the monorepo base config for consistency.
  - `jsx: "react-jsx"` is needed for the webview React components (though they are excluded from this tsconfig — the webview has its own tsconfig).
  - `src/webview/ui` is excluded because it targets the browser and has its own `tsconfig.webview.json`.
- **Acceptance criteria**:
  - File exists at `packages/vscode/tsconfig.json`.
  - `extends` points to `../../tsconfig.base.json`.
  - `exclude` includes `src/webview/ui`.

---

### T1.1.3b — Write `packages/vscode/tsconfig.webview.json`

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **File to create**: `packages/vscode/tsconfig.webview.json`
- **Action**: Write the following content exactly.

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

- **Rationale**:
  - Webview code runs in a browser context, so it needs `DOM` and `DOM.Iterable` libs.
  - No `node` types — the webview cannot access Node.js APIs.
  - Separate `rootDir` pointing to the webview UI source.
- **Acceptance criteria**:
  - File exists at `packages/vscode/tsconfig.webview.json`.
  - `lib` includes `DOM` and `DOM.Iterable`.
  - `types` is empty (no `node`).
  - `include` is scoped to `src/webview/ui`.

---

### T1.1.4 — Write `packages/vscode/.vscodeignore`

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **File to create**: `packages/vscode/.vscodeignore`
- **Action**: Write the following content exactly.

```
.vscode/**
src/**
test/**
media/*.sketch
media/*.fig
node_modules/**
!node_modules/@agentx/**
tsconfig.json
tsconfig.webview.json
esbuild.js
esbuild.webview.js
.eslintrc.json
.gitignore
**/*.map
**/*.ts
!dist/**
```

- **Rationale**:
  - Excludes source, tests, config files, and sourcemaps from the VSIX package.
  - Keeps `node_modules/@agentx/**` since workspace packages need to be bundled (but this is a safety net — esbuild bundles them).
  - Keeps the `dist/` output directory.
  - Keeps `media/` for icons and SVGs.
- **Acceptance criteria**:
  - File exists at `packages/vscode/.vscodeignore`.
  - `src/**` is excluded.
  - `dist/**` is included (via the `!dist/**` negation).

---

### T1.1.5 — Write `packages/vscode/eslint.config.js`

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **File to create**: `packages/vscode/eslint.config.js`
- **Action**: Write the following content exactly.

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'out/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.webview.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        node: true,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      'no-console': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'off',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
);
```

- **Rationale**:
  - Uses flat config format (`eslint.config.js`) consistent with the root `eslint.config.js`.
  - Matches the same rules as the root config for consistency.
  - References both `tsconfig.json` and `tsconfig.webview.json` for the two compilation targets.
- **Acceptance criteria**:
  - File exists at `packages/vscode/eslint.config.js`.
  - Uses flat config format (not `.eslintrc.json`).
  - Rules match root `eslint.config.js`.

---

## T1.2: VS Code Extension Manifest (contributes section)

### T1.2.1 — Define VS Code extension manifest `contributes` section

- **Status**: ⬜
- **Dependencies**: T1.1.2
- **File to modify**: `packages/vscode/package.json`
- **Action**: The `contributes` section is already fully defined in T1.1.2. This task verifies completeness.

**Verification checklist** — confirm the following are all present in `packages/vscode/package.json`:

#### Commands (25 total):
1. `agentx.openChat` — Open Agent-X Chat
2. `agentx.newSession` — New Session
3. `agentx.switchModel` — Switch Model
4. `agentx.switchProvider` — Switch Provider
5. `agentx.switchCrew` — Switch Crew / Persona
6. `agentx.cancelTask` — Cancel Current Task
7. `agentx.showSessions` — Show Session History
8. `agentx.showPermissions` — Manage Permissions
9. `agentx.compactSession` — Compact Session Context
10. `agentx.clearHistory` — Clear Session History
11. `agentx.exportSession` — Export Current Session
12. `agentx.restoreSession` — Restore Session
13. `agentx.deleteSession` — Delete Session
14. `agentx.refreshSessions` — Refresh Session List
15. `agentx.openSettings` — Open Settings
16. `agentx.showTokenUsage` — Show Token Usage
17. `agentx.addFileToContext` — Add File to Context
18. `agentx.addSelectionToContext` — Add Selection to Context
19. `agentx.explainSelection` — Explain Selection
20. `agentx.refactorSelection` — Refactor Selection
21. `agentx.fixDiagnostics` — Fix Diagnostics in File
22. `agentx.generateTests` — Generate Tests for File
23. `agentx.steerAgent` — Send Steering Instruction
24. `agentx.approvePlan` — Approve Plan
25. `agentx.rejectPlan` — Reject Plan
26. `agentx.openMissionControl` — Open Mission Control (Setup Wizard)

#### Keybindings (5 total):
1. `ctrl+shift+a` / `cmd+shift+a` → `agentx.openChat`
2. `ctrl+shift+alt+n` / `cmd+shift+alt+n` → `agentx.newSession`
3. `ctrl+shift+alt+c` / `cmd+shift+alt+c` → `agentx.cancelTask`
4. `ctrl+shift+alt+a` / `cmd+shift+alt+a` → `agentx.addSelectionToContext` (when `editorHasSelection`)
5. `ctrl+shift+alt+e` / `cmd+shift+alt+e` → `agentx.explainSelection` (when `editorHasSelection`)

#### Configuration properties (15 total):
1. `agentx.provider` — Active AI provider (enum of 15 providers)
2. `agentx.model` — Active model ID
3. `agentx.theme` — Chat webview theme
4. `agentx.autoApprove` — Permission auto-approval policy
5. `agentx.showTokenBar` — Show token usage in status bar
6. `agentx.showTimers` — Show elapsed time on tool cards
7. `agentx.animationSpeed` — Animation speed
8. `agentx.maxTokensPerSession` — Max tokens per session
9. `agentx.compactionThreshold` — Compaction trigger ratio
10. `agentx.enableSubAgents` — Allow sub-agent spawning
11. `agentx.enablePlans` — Enable plan mode
12. `agentx.enableRAG` — Enable RAG
13. `agentx.disabledTools` — Disabled tool IDs
14. `agentx.telemetry` — Enable telemetry
15. `agentx.logLevel` — Output channel log level

#### Views containers:
1. `agentx-explorer` — Activity bar with SVG icon

#### Views:
1. `agentx.chatView` — Webview type, visible
2. `agentx.sessionsView` — TreeView type, visible

#### Menus:
1. `view/title` — newSession on chat, refreshSessions + clearHistory on sessions
2. `view/item/context` — restoreSession, exportSession, deleteSession on session items
3. `editor/context` — addSelectionToContext, explainSelection, refactorSelection, fixDiagnostics, generateTests
4. `explorer/context` — addFileToContext
5. `commandPalette` — all 26 commands listed with appropriate `when` clauses

- **Acceptance criteria**:
  - All 26 commands exist in `contributes.commands`.
  - All 5 keybindings exist in `contributes.keybindings`.
  - All 15 configuration properties exist in `contributes.configuration.properties`.
  - `viewsContainers.activitybar` has `agentx-explorer`.
  - `views.agentx-explorer` has both `agentx.chatView` and `agentx.sessionsView`.
  - All 5 menu sections are present with correct entries.

---

## T1.3: Build Configuration

### T1.3.1 — Write `packages/vscode/esbuild.js` (extension host bundle)

- **Status**: ⬜
- **Dependencies**: T1.1.2
- **File to create**: `packages/vscode/esbuild.js`
- **Action**: Write the following content exactly.

```js
#!/usr/bin/env node

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
  treeShaking: true,
  external: [
    'vscode',
    'better-sqlite3',
    'node-pty',
    'playwright',
    'playwright-core',
  ],
  alias: {
    '@agentx/engine': '../engine/src/index.ts',
    '@agentx/shared': '../shared/src/index.ts',
  },
  logLevel: 'info',
  plugins: watch
    ? [
        {
          name: 'watch-plugin',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length > 0) {
                console.error('[esbuild] Build failed:', result.errors);
              } else {
                console.log('[esbuild] Build succeeded, waiting for changes...');
              }
            });
          },
        },
      ]
    : [],
});

if (watch) {
  await ctx.watch();
  console.log('[esbuild] Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- **Rationale**:
  - `format: 'cjs'` — VS Code extensions must use CommonJS format (the extension host loads via `require()`).
  - `platform: 'node'` — Extension host runs in Node.js.
  - `target: 'node20'` — Matches the monorepo's `node>=20` requirement.
  - `external: ['vscode']` — The `vscode` module is provided by the extension host at runtime.
  - `external: ['better-sqlite3']` — Native module, cannot be bundled by esbuild. Will be handled separately.
  - `external: ['node-pty', 'playwright', 'playwright-core']` — Optional native/heavy deps that should not be bundled.
  - `alias` for workspace packages — During development, resolve directly to source `.ts` files so esbuild bundles them inline. This avoids needing to build `@agentx/engine` and `@agentx/shared` first.
- **Acceptance criteria**:
  - File exists at `packages/vscode/esbuild.js`.
  - Running `node esbuild.js` produces `dist/extension.js`.
  - Running `node esbuild.js --production` produces minified output without sourcemaps.
  - Running `node esbuild.js --watch` watches for changes and rebuilds.
  - `vscode` is in `external`.
  - `better-sqlite3` is in `external`.

---

### T1.3.2 — Write `packages/vscode/esbuild.webview.js` (webview bundle)

- **Status**: ⬜
- **Dependencies**: T1.1.2
- **File to create**: `packages/vscode/esbuild.webview.js`
- **Action**: Write the following content exactly.

```js
#!/usr/bin/env node

import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/webview/ui/index.tsx'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  outfile: 'dist/webview/index.js',
  sourcemap: !production ? 'inline' : false,
  minify: production,
  treeShaking: true,
  jsx: 'automatic',
  loader: {
    '.svg': 'text',
    '.css': 'css',
  },
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  logLevel: 'info',
  plugins: watch
    ? [
        {
          name: 'watch-plugin',
          setup(build) {
            build.onEnd((result) => {
              if (result.errors.length > 0) {
                console.error('[esbuild:webview] Build failed:', result.errors);
              } else {
                console.log('[esbuild:webview] Build succeeded, waiting for changes...');
              }
            });
          },
        },
      ]
    : [],
});

if (watch) {
  await ctx.watch();
  console.log('[esbuild:webview] Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
```

- **Rationale**:
  - `format: 'iife'` — Webviews run in a sandboxed browser context. IIFE avoids module loading issues.
  - `platform: 'browser'` — Webview code runs in a browser, not Node.js.
  - `target: 'es2020'` — VS Code's webview uses a recent Chromium version.
  - `jsx: 'automatic'` — Uses React 17+ JSX transform (no need to import React in every file).
  - `.svg` loaded as `text` — Allows importing SVG files as strings for inline embedding.
  - `.css` loaded as `css` — esbuild's built-in CSS handling.
  - Separate from extension host bundle because webview code cannot access Node.js APIs.
- **Acceptance criteria**:
  - File exists at `packages/vscode/esbuild.webview.js`.
  - Running `node esbuild.webview.js` produces `dist/webview/index.js`.
  - Output is IIFE format.
  - `platform` is `browser`.

---

### T1.3.3 — Write `packages/vscode/src/vscode.d.ts` (custom type declarations)

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **File to create**: `packages/vscode/src/vscode.d.ts`
- **Action**: Write the following content exactly.

```ts
declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.css' {
  const content: string;
  export default content;
}
```

- **Rationale**:
  - esbuild's `text` loader for `.svg` and `css` loader for `.css` produce string exports.
  - TypeScript needs these ambient declarations to understand the imports.
- **Acceptance criteria**:
  - File exists at `packages/vscode/src/vscode.d.ts`.
  - Declares `*.svg` and `*.css` module types.

---

## T1.4: Directory Structure

### T1.4.1 — Create all source subdirectories

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **Action**: Create the following directory tree.

```bash
mkdir -p /source/packages/vscode/src/adapter
mkdir -p /source/packages/vscode/src/commands
mkdir -p /source/packages/vscode/src/providers
mkdir -p /source/packages/vscode/src/webview/ui/components
mkdir -p /source/packages/vscode/src/statusbar
mkdir -p /source/packages/vscode/src/config
mkdir -p /source/packages/vscode/src/utils
```

**Directory purpose map**:

| Directory | Purpose | Phase |
|-----------|---------|-------|
| `src/adapter/` | `VSCodeEngine` wrapper class, tool adapter registry, event mapping | Phase 2 |
| `src/commands/` | VS Code command handler functions (one file per command group) | Phase 3 |
| `src/providers/` | `TreeDataProvider` implementations for sessions tree view | Phase 7 |
| `src/webview/` | `WebviewViewProvider` class, message passing between extension host and webview | Phase 4 |
| `src/webview/ui/` | Webview frontend entry point (React app) | Phase 4 |
| `src/webview/ui/components/` | React components: ChatMessage, ToolCard, PlanView, InputBar, etc. | Phase 4 |
| `src/statusbar/` | Status bar item creation and update logic | Phase 3 |
| `src/config/` | VS Code settings reader/writer, sync with engine `ConfigManager` | Phase 3 |
| `src/utils/` | Shared utilities: nonce generation, disposable helpers, logging | Phase 1+ |

- **Action**: Create placeholder `.gitkeep` files in each directory so they are tracked by git.

```bash
touch /source/packages/vscode/src/adapter/.gitkeep
touch /source/packages/vscode/src/commands/.gitkeep
touch /source/packages/vscode/src/providers/.gitkeep
touch /source/packages/vscode/src/webview/ui/components/.gitkeep
touch /source/packages/vscode/src/statusbar/.gitkeep
touch /source/packages/vscode/src/config/.gitkeep
touch /source/packages/vscode/src/utils/.gitkeep
```

- **Acceptance criteria**:
  - All 9 directories exist under `packages/vscode/src/`.
  - Each directory contains a `.gitkeep` file.

---

### T1.4.2 — Create `media/` directory with placeholder SVGs

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **Action**: Create the media directory and placeholder icon files.

```bash
mkdir -p /source/packages/vscode/media
```

**File to create**: `packages/vscode/media/agentx-activity-bar.svg`

```xml
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
</svg>
```

- **Rationale**:
  - The activity bar icon uses `currentColor` so VS Code applies the correct theme color.
  - 24x24 SVG is the recommended size for activity bar icons.
  - This is a placeholder — a proper icon will be designed later.

**File to create**: `packages/vscode/media/agentx-session.svg`

```xml
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
  <path d="M8 5V8L10 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>
```

- **Rationale**:
  - 16x16 SVG for tree view item icons.
  - Clock icon represents session history.

- **Acceptance criteria**:
  - Directory `packages/vscode/media/` exists.
  - `agentx-activity-bar.svg` exists and is valid SVG with `currentColor`.
  - `agentx-session.svg` exists and is valid SVG with `currentColor`.

---

### T1.4.3 — Create `test/` directory structure

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **Action**: Create test directories and a test runner bootstrap.

```bash
mkdir -p /source/packages/vscode/test/suite
```

**File to create**: `packages/vscode/test/runTest.ts`

```ts
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const extensionDevelopmentPath = path.resolve(import.meta.dirname, '..');
  const extensionTestsPath = path.resolve(import.meta.dirname, './suite/index.js');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
    });
  } catch {
    console.error('Failed to run tests');
    process.exit(1);
  }
}

main();
```

**File to create**: `packages/vscode/test/suite/index.ts`

```ts
import * as path from 'node:path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 10000 });
  const testsRoot = path.resolve(import.meta.dirname);
  const files = await glob('**/*.test.js', { cwd: testsRoot });

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}
```

**File to create**: `packages/vscode/test/suite/extension.test.ts`

```ts
import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension Activation', () => {
  test('should be present in extensions', () => {
    const ext = vscode.extensions.getExtension('slashpan.agentx');
    assert.ok(ext, 'Extension should be found');
  });

  test('should activate', async () => {
    const ext = vscode.extensions.getExtension('slashpan.agentx');
    if (ext && !ext.isActive) {
      await ext.activate();
    }
    assert.ok(ext?.isActive, 'Extension should be active');
  });

  test('should register agentx.openChat command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('agentx.openChat'),
      'agentx.openChat command should be registered',
    );
  });
});
```

- **Acceptance criteria**:
  - Directory `packages/vscode/test/` exists.
  - Directory `packages/vscode/test/suite/` exists.
  - `test/runTest.ts` exists and uses `@vscode/test-electron`.
  - `test/suite/index.ts` exists and uses Mocha with `tdd` UI.
  - `test/suite/extension.test.ts` exists with 3 basic activation tests.

---

## T1.5: Workspace Integration

### T1.5.1 — Verify root `pnpm-workspace.yaml` includes `packages/*`

- **Status**: ⬜
- **Dependencies**: None
- **File to check**: `pnpm-workspace.yaml` (at monorepo root)
- **Current content**:

```yaml
packages:
  - 'packages/*'
```

- **Action**: No changes needed. The glob `packages/*` already matches `packages/vscode/`.
- **Acceptance criteria**:
  - `pnpm-workspace.yaml` contains `packages/*`.
  - Running `pnpm list -r --depth -1` from root shows `@agentx/vscode` in the workspace.

---

### T1.5.2 — Update root `package.json` lint script to include vscode

- **Status**: ⬜
- **Dependencies**: T1.1.2
- **File to modify**: `package.json` (at monorepo root)
- **Current lint script** (line 15):

```json
"lint": "eslint packages/cli/src packages/engine/src packages/shared/src packages/tui/src packages/web-api/src",
```

- **Action**: Add `packages/vscode/src` to the lint script.

**Replace**:
```json
"lint": "eslint packages/cli/src packages/engine/src packages/shared/src packages/tui/src packages/web-api/src",
```

**With**:
```json
"lint": "eslint packages/cli/src packages/engine/src packages/shared/src packages/tui/src packages/web-api/src packages/vscode/src",
```

- **Acceptance criteria**:
  - Root `package.json` lint script includes `packages/vscode/src`.
  - Running `pnpm run lint` from root lints the vscode package source.

---

### T1.5.3 — Write `.vscode/launch.json` for Extension Development Host

- **Status**: ⬜
- **Dependencies**: T1.1.2
- **File to create**: `.vscode/launch.json` (at monorepo root)
- **Action**: Write the following content exactly.

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/packages/vscode",
        "--disable-extensions"
      ],
      "outFiles": [
        "${workspaceFolder}/packages/vscode/dist/**/*.js"
      ],
      "preLaunchTask": "npm: build:vscode",
      "sourceMaps": true
    },
    {
      "name": "Run Extension (Watch)",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/packages/vscode",
        "--disable-extensions"
      ],
      "outFiles": [
        "${workspaceFolder}/packages/vscode/dist/**/*.js"
      ],
      "preLaunchTask": "npm: watch:vscode",
      "sourceMaps": true
    },
    {
      "name": "Extension Tests",
      "type": "extensionHost",
      "request": "launch",
      "args": [
        "--extensionDevelopmentPath=${workspaceFolder}/packages/vscode",
        "--extensionTestsPath=${workspaceFolder}/packages/vscode/out/test/suite/index",
        "--disable-extensions"
      ],
      "outFiles": [
        "${workspaceFolder}/packages/vscode/out/**/*.js"
      ],
      "preLaunchTask": "npm: build:vscode:tests",
      "sourceMaps": true
    }
  ]
}
```

- **Rationale**:
  - `Run Extension` — Builds once, then launches Extension Development Host.
  - `Run Extension (Watch)` — Starts watch mode, useful for iterative development.
  - `Extension Tests` — Runs the Mocha test suite inside Extension Development Host.
  - `--disable-extensions` prevents interference from other installed extensions.
  - `sourceMaps: true` enables debugging with original TypeScript source.
- **Acceptance criteria**:
  - File exists at `.vscode/launch.json`.
  - Three configurations: `Run Extension`, `Run Extension (Watch)`, `Extension Tests`.
  - All reference `packages/vscode` paths.

---

### T1.5.4 — Write `.vscode/tasks.json` for build/watch

- **Status**: ⬜
- **Dependencies**: T1.3.1
- **File to create**: `.vscode/tasks.json` (at monorepo root)
- **Action**: Write the following content exactly.

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "build:vscode",
      "type": "npm",
      "script": "build",
      "options": {
        "cwd": "${workspaceFolder}/packages/vscode"
      },
      "group": "build",
      "problemMatcher": ["$esbuild-watch"],
      "presentation": {
        "reveal": "silent",
        "panel": "dedicated"
      }
    },
    {
      "label": "watch:vscode",
      "type": "npm",
      "script": "watch",
      "options": {
        "cwd": "${workspaceFolder}/packages/vscode"
      },
      "group": "build",
      "isBackground": true,
      "problemMatcher": ["$esbuild-watch"],
      "presentation": {
        "reveal": "silent",
        "panel": "dedicated"
      }
    },
    {
      "label": "watch:vscode:webview",
      "type": "npm",
      "script": "watch:webview",
      "options": {
        "cwd": "${workspaceFolder}/packages/vscode"
      },
      "group": "build",
      "isBackground": true,
      "problemMatcher": ["$esbuild-watch"],
      "presentation": {
        "reveal": "silent",
        "panel": "dedicated"
      }
    },
    {
      "label": "build:vscode:tests",
      "type": "shell",
      "command": "npx tsc -p tsconfig.json --outDir out",
      "options": {
        "cwd": "${workspaceFolder}/packages/vscode"
      },
      "group": "build",
      "problemMatcher": "$tsc",
      "presentation": {
        "reveal": "silent"
      }
    },
    {
      "label": "typecheck:vscode",
      "type": "npm",
      "script": "typecheck",
      "options": {
        "cwd": "${workspaceFolder}/packages/vscode"
      },
      "group": "build",
      "problemMatcher": "$tsc",
      "presentation": {
        "reveal": "silent"
      }
    }
  ]
}
```

- **Rationale**:
  - `build:vscode` — One-shot build for extension host + webview.
  - `watch:vscode` — Continuous watch for extension host code.
  - `watch:vscode:webview` — Continuous watch for webview code (run in parallel with `watch:vscode`).
  - `build:vscode:tests` — Compiles test files for the test runner.
  - `typecheck:vscode` — Runs `tsc --noEmit` for type checking.
- **Acceptance criteria**:
  - File exists at `.vscode/tasks.json`.
  - 5 tasks defined.
  - `build:vscode` and `watch:vscode` reference npm scripts from `packages/vscode/package.json`.

---

### T1.5.5 — Write `.vscode/settings.json` for workspace settings

- **Status**: ⬜
- **Dependencies**: T1.1.1
- **File to create**: `.vscode/settings.json` (at monorepo root)
- **Action**: Write the following content exactly.

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "files.exclude": {
    "**/dist": false,
    "**/out": true,
    "**/node_modules": true
  },
  "search.exclude": {
    "**/dist": true,
    "**/out": true,
    "**/node_modules": true
  },
  "eslint.workingDirectories": [
    ".",
    "packages/cli",
    "packages/engine",
    "packages/shared",
    "packages/tui",
    "packages/web-api",
    "packages/vscode"
  ]
}
```

- **Rationale**:
  - `typescript.tsdk` points to the workspace TypeScript for consistent language service.
  - `eslint.workingDirectories` ensures ESLint resolves configs correctly for each package.
  - `files.exclude` and `search.exclude` hide build artifacts.
- **Acceptance criteria**:
  - File exists at `.vscode/settings.json`.
  - `eslint.workingDirectories` includes `packages/vscode`.

---

## T1.6: Initial Extension Entry Point

### T1.6.1 — Write `packages/vscode/src/constants.ts`

- **Status**: ⬜
- **Dependencies**: T1.1.2
- **File to create**: `packages/vscode/src/constants.ts`
- **Action**: Write the following content exactly.

```ts
export const EXTENSION_ID = 'slashpan.agentx';
export const EXTENSION_DISPLAY_NAME = 'Agent-X';

export const COMMANDS = {
  OPEN_CHAT: 'agentx.openChat',
  NEW_SESSION: 'agentx.newSession',
  SWITCH_MODEL: 'agentx.switchModel',
  SWITCH_PROVIDER: 'agentx.switchProvider',
  SWITCH_CREW: 'agentx.switchCrew',
  CANCEL_TASK: 'agentx.cancelTask',
  SHOW_SESSIONS: 'agentx.showSessions',
  SHOW_PERMISSIONS: 'agentx.showPermissions',
  COMPACT_SESSION: 'agentx.compactSession',
  CLEAR_HISTORY: 'agentx.clearHistory',
  EXPORT_SESSION: 'agentx.exportSession',
  RESTORE_SESSION: 'agentx.restoreSession',
  DELETE_SESSION: 'agentx.deleteSession',
  REFRESH_SESSIONS: 'agentx.refreshSessions',
  OPEN_SETTINGS: 'agentx.openSettings',
  SHOW_TOKEN_USAGE: 'agentx.showTokenUsage',
  ADD_FILE_TO_CONTEXT: 'agentx.addFileToContext',
  ADD_SELECTION_TO_CONTEXT: 'agentx.addSelectionToContext',
  EXPLAIN_SELECTION: 'agentx.explainSelection',
  REFACTOR_SELECTION: 'agentx.refactorSelection',
  FIX_DIAGNOSTICS: 'agentx.fixDiagnostics',
  GENERATE_TESTS: 'agentx.generateTests',
  STEER_AGENT: 'agentx.steerAgent',
  APPROVE_PLAN: 'agentx.approvePlan',
  REJECT_PLAN: 'agentx.rejectPlan',
  OPEN_MISSION_CONTROL: 'agentx.openMissionControl',
} as const;

export const VIEWS = {
  CHAT: 'agentx.chatView',
  SESSIONS: 'agentx.sessionsView',
} as const;

export const VIEW_CONTAINERS = {
  EXPLORER: 'agentx-explorer',
} as const;

export const CONFIG_KEYS = {
  PROVIDER: 'agentx.provider',
  MODEL: 'agentx.model',
  THEME: 'agentx.theme',
  AUTO_APPROVE: 'agentx.autoApprove',
  SHOW_TOKEN_BAR: 'agentx.showTokenBar',
  SHOW_TIMERS: 'agentx.showTimers',
  ANIMATION_SPEED: 'agentx.animationSpeed',
  MAX_TOKENS_PER_SESSION: 'agentx.maxTokensPerSession',
  COMPACTION_THRESHOLD: 'agentx.compactionThreshold',
  ENABLE_SUB_AGENTS: 'agentx.enableSubAgents',
  ENABLE_PLANS: 'agentx.enablePlans',
  ENABLE_RAG: 'agentx.enableRAG',
  DISABLED_TOOLS: 'agentx.disabledTools',
  TELEMETRY: 'agentx.telemetry',
  LOG_LEVEL: 'agentx.logLevel',
} as const;

export const OUTPUT_CHANNEL_NAME = 'Agent-X';

export const STATUS_BAR_PRIORITY = 100;
```

- **Acceptance criteria**:
  - File exists at `packages/vscode/src/constants.ts`.
  - All 26 command IDs are defined in `COMMANDS`.
  - All 2 view IDs are defined in `VIEWS`.
  - All 15 config keys are defined in `CONFIG_KEYS`.
  - All values match the strings used in `package.json` `contributes` section.

---

### T1.6.2 — Write `packages/vscode/src/extension.ts` (entry point)

- **Status**: ⬜
- **Dependencies**: T1.6.1
- **File to create**: `packages/vscode/src/extension.ts`
- **Action**: Write the following content exactly.

```ts
import * as vscode from 'vscode';
import { COMMANDS, OUTPUT_CHANNEL_NAME } from './constants.js';

let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, { log: true });
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('Agent-X extension activating...');

  registerCommands(context);
  createStatusBar(context);

  // Phase 3: Initialize VSCodeEngine adapter
  // Phase 3: Register webview provider for agentx.chatView
  // Phase 3: Register tree data provider for agentx.sessionsView
  // Phase 3: Register configuration change listener
  // Phase 3: Register workspace folder change listener

  outputChannel.appendLine('Agent-X extension activated.');
}

export async function deactivate(): Promise<void> {
  outputChannel?.appendLine('Agent-X extension deactivating...');

  // Phase 2: Dispose VSCodeEngine adapter
  // Phase 3: Dispose webview provider
  // Phase 3: Dispose tree data provider
  // Phase 7: Flush session state

  outputChannel?.appendLine('Agent-X extension deactivated.');
}

function registerCommands(context: vscode.ExtensionContext): void {
  const commands: Array<[string, (...args: unknown[]) => unknown]> = [
    [COMMANDS.OPEN_CHAT, () => {
      outputChannel.appendLine('Open Chat command triggered');
      vscode.commands.executeCommand('workbench.view.extension.agentx-explorer');
    }],
    [COMMANDS.NEW_SESSION, () => {
      outputChannel.appendLine('New Session command triggered');
      vscode.window.showInformationMessage('Agent-X: New session (not yet implemented)');
    }],
    [COMMANDS.SWITCH_MODEL, () => {
      outputChannel.appendLine('Switch Model command triggered');
      vscode.window.showInformationMessage('Agent-X: Switch model (not yet implemented)');
    }],
    [COMMANDS.SWITCH_PROVIDER, () => {
      outputChannel.appendLine('Switch Provider command triggered');
      vscode.window.showInformationMessage('Agent-X: Switch provider (not yet implemented)');
    }],
    [COMMANDS.SWITCH_CREW, () => {
      outputChannel.appendLine('Switch Crew command triggered');
      vscode.window.showInformationMessage('Agent-X: Switch crew (not yet implemented)');
    }],
    [COMMANDS.CANCEL_TASK, () => {
      outputChannel.appendLine('Cancel Task command triggered');
      vscode.window.showInformationMessage('Agent-X: Cancel task (not yet implemented)');
    }],
    [COMMANDS.SHOW_SESSIONS, () => {
      outputChannel.appendLine('Show Sessions command triggered');
      vscode.commands.executeCommand('agentx.sessionsView.focus');
    }],
    [COMMANDS.SHOW_PERMISSIONS, () => {
      outputChannel.appendLine('Show Permissions command triggered');
      vscode.window.showInformationMessage('Agent-X: Manage permissions (not yet implemented)');
    }],
    [COMMANDS.COMPACT_SESSION, () => {
      outputChannel.appendLine('Compact Session command triggered');
      vscode.window.showInformationMessage('Agent-X: Compact session (not yet implemented)');
    }],
    [COMMANDS.CLEAR_HISTORY, () => {
      outputChannel.appendLine('Clear History command triggered');
      vscode.window.showInformationMessage('Agent-X: Clear history (not yet implemented)');
    }],
    [COMMANDS.EXPORT_SESSION, () => {
      outputChannel.appendLine('Export Session command triggered');
      vscode.window.showInformationMessage('Agent-X: Export session (not yet implemented)');
    }],
    [COMMANDS.RESTORE_SESSION, () => {
      outputChannel.appendLine('Restore Session command triggered');
      vscode.window.showInformationMessage('Agent-X: Restore session (not yet implemented)');
    }],
    [COMMANDS.DELETE_SESSION, () => {
      outputChannel.appendLine('Delete Session command triggered');
      vscode.window.showInformationMessage('Agent-X: Delete session (not yet implemented)');
    }],
    [COMMANDS.REFRESH_SESSIONS, () => {
      outputChannel.appendLine('Refresh Sessions command triggered');
      vscode.window.showInformationMessage('Agent-X: Refresh sessions (not yet implemented)');
    }],
    [COMMANDS.OPEN_SETTINGS, () => {
      outputChannel.appendLine('Open Settings command triggered');
      vscode.commands.executeCommand('workbench.action.openSettings', 'agentx');
    }],
    [COMMANDS.SHOW_TOKEN_USAGE, () => {
      outputChannel.appendLine('Show Token Usage command triggered');
      vscode.window.showInformationMessage('Agent-X: Token usage (not yet implemented)');
    }],
    [COMMANDS.ADD_FILE_TO_CONTEXT, () => {
      outputChannel.appendLine('Add File to Context command triggered');
      vscode.window.showInformationMessage('Agent-X: Add file to context (not yet implemented)');
    }],
    [COMMANDS.ADD_SELECTION_TO_CONTEXT, () => {
      outputChannel.appendLine('Add Selection to Context command triggered');
      vscode.window.showInformationMessage('Agent-X: Add selection to context (not yet implemented)');
    }],
    [COMMANDS.EXPLAIN_SELECTION, () => {
      outputChannel.appendLine('Explain Selection command triggered');
      vscode.window.showInformationMessage('Agent-X: Explain selection (not yet implemented)');
    }],
    [COMMANDS.REFACTOR_SELECTION, () => {
      outputChannel.appendLine('Refactor Selection command triggered');
      vscode.window.showInformationMessage('Agent-X: Refactor selection (not yet implemented)');
    }],
    [COMMANDS.FIX_DIAGNOSTICS, () => {
      outputChannel.appendLine('Fix Diagnostics command triggered');
      vscode.window.showInformationMessage('Agent-X: Fix diagnostics (not yet implemented)');
    }],
    [COMMANDS.GENERATE_TESTS, () => {
      outputChannel.appendLine('Generate Tests command triggered');
      vscode.window.showInformationMessage('Agent-X: Generate tests (not yet implemented)');
    }],
    [COMMANDS.STEER_AGENT, () => {
      outputChannel.appendLine('Steer Agent command triggered');
      vscode.window.showInformationMessage('Agent-X: Steer agent (not yet implemented)');
    }],
    [COMMANDS.APPROVE_PLAN, () => {
      outputChannel.appendLine('Approve Plan command triggered');
      vscode.window.showInformationMessage('Agent-X: Approve plan (not yet implemented)');
    }],
    [COMMANDS.REJECT_PLAN, () => {
      outputChannel.appendLine('Reject Plan command triggered');
      vscode.window.showInformationMessage('Agent-X: Reject plan (not yet implemented)');
    }],
    [COMMANDS.OPEN_MISSION_CONTROL, () => {
      outputChannel.appendLine('Open Mission Control command triggered');
      vscode.window.showInformationMessage('Agent-X: Mission Control (not yet implemented)');
    }],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  outputChannel.appendLine(`Registered ${commands.length} commands.`);
}

function createStatusBar(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusBarItem.name = 'Agent-X';
  statusBarItem.text = '$(hubot) Agent-X';
  statusBarItem.tooltip = 'Agent-X: Click to open chat';
  statusBarItem.command = COMMANDS.OPEN_CHAT;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  outputChannel.appendLine('Status bar item created.');
}
```

- **Rationale**:
  - `activate()` is called when the extension activates (on `onStartupFinished`).
  - `deactivate()` is called when VS Code shuts down or the extension is disabled.
  - All 26 commands are registered with placeholder handlers that log to the output channel and show an info message.
  - `OPEN_CHAT` and `SHOW_SESSIONS` and `OPEN_SETTINGS` have real implementations (focus views/open settings).
  - Status bar item is created on the left side with priority 100.
  - Placeholder comments mark where subsequent phases will add code.
  - `outputChannel` is used for logging throughout the extension lifecycle.
- **Acceptance criteria**:
  - File exists at `packages/vscode/src/extension.ts`.
  - `activate()` function is exported and accepts `vscode.ExtensionContext`.
  - `deactivate()` function is exported.
  - All 26 commands from `COMMANDS` constant are registered.
  - Status bar item is created and shown.
  - Output channel named `Agent-X` is created.
  - File passes `tsc --noEmit` with no errors.

---

## T1.7: Verification

### T1.7.1 — Run `pnpm install` from root

- **Status**: ⬜
- **Dependencies**: T1.1.2
- **Action**: Run the following command from the monorepo root.

```bash
cd /source && pnpm install
```

- **Expected output**:
  - pnpm resolves `@agentx/vscode` as a workspace package.
  - `@agentx/engine` and `@agentx/shared` are linked as workspace dependencies.
  - `@types/vscode`, `@vscode/test-electron`, `esbuild`, `@vscode/vsce` are installed in `packages/vscode/node_modules/`.
  - No errors or peer dependency conflicts.

- **Acceptance criteria**:
  - `pnpm install` exits with code 0.
  - `packages/vscode/node_modules/@types/vscode/` exists.
  - `packages/vscode/node_modules/esbuild/` exists.
  - `packages/vscode/node_modules/@agentx/engine` is a symlink to `packages/engine/`.
  - `packages/vscode/node_modules/@agentx/shared` is a symlink to `packages/shared/`.

---

### T1.7.2 — Run `pnpm --filter @agentx/vscode run build`

- **Status**: ⬜
- **Dependencies**: T1.7.1, T1.3.1, T1.3.2, T1.6.2
- **Action**: Run the following command from the monorepo root.

```bash
cd /source && pnpm --filter @agentx/vscode run build
```

- **Expected output**:
  - esbuild bundles `src/extension.ts` → `dist/extension.js` (CJS format).
  - esbuild bundles webview entry (if `src/webview/ui/index.tsx` exists) → `dist/webview/index.js`.
  - No build errors.
  - `dist/extension.js` file size is reasonable (should be < 5MB since it bundles engine + shared).

- **Troubleshooting**:
  - If `src/webview/ui/index.tsx` does not exist yet, the webview build will fail. Create a minimal placeholder:

    **File to create**: `packages/vscode/src/webview/ui/index.tsx`

    ```tsx
    const root = document.getElementById('root');
    if (root) {
      root.textContent = 'Agent-X Chat (loading...)';
    }
    ```

  - If `@agentx/engine` has import errors, check that the alias paths in `esbuild.js` are correct.
  - If `better-sqlite3` causes issues, verify it is in the `external` array.

- **Acceptance criteria**:
  - Command exits with code 0.
  - `packages/vscode/dist/extension.js` exists and is non-empty.
  - `packages/vscode/dist/extension.js` starts with CJS boilerplate (not ESM).
  - `packages/vscode/dist/webview/index.js` exists (after placeholder is created).

---

### T1.7.3 — Run `pnpm --filter @agentx/vscode run typecheck`

- **Status**: ⬜
- **Dependencies**: T1.7.1, T1.6.2
- **Action**: Run the following command from the monorepo root.

```bash
cd /source && pnpm --filter @agentx/vscode run typecheck
```

- **Expected output**:
  - `tsc --noEmit` completes with no errors.
  - All imports resolve correctly.
  - `vscode` types are available from `@types/vscode`.

- **Troubleshooting**:
  - If `@agentx/engine` types fail to resolve, ensure `packages/engine/` has been built first:
    ```bash
    pnpm --filter @agentx/engine run build
    pnpm --filter @agentx/shared run build
    ```
  - If `verbatimModuleSyntax` causes issues with `import type` vs `import`, adjust imports accordingly.

- **Acceptance criteria**:
  - Command exits with code 0.
  - No TypeScript errors reported.

---

### T1.7.4 — Run `pnpm --filter @agentx/vscode run lint`

- **Status**: ⬜
- **Dependencies**: T1.7.1, T1.6.2
- **Action**: Run the following command from the monorepo root.

```bash
cd /source && pnpm --filter @agentx/vscode run lint
```

- **Expected output**:
  - ESLint completes with no errors (warnings are acceptable).
  - All files in `src/` are linted.

- **Troubleshooting**:
  - If ESLint cannot find the flat config, ensure `eslint.config.js` exists in `packages/vscode/`.
  - If `no-console` warnings appear, they are expected and acceptable for Phase 1.

- **Acceptance criteria**:
  - Command exits with code 0.
  - No ESLint errors (warnings are OK).

---

### T1.7.5 — Launch Extension Development Host and verify activation

- **Status**: ⬜
- **Dependencies**: T1.7.2
- **Action**: Use the VS Code launch configuration created in T1.5.3.

**Manual steps**:
1. Open the monorepo root (`/source/`) in VS Code.
2. Press `F5` or go to **Run and Debug** → select **Run Extension**.
3. A new VS Code window opens (Extension Development Host).
4. In the Extension Development Host:
   a. Open the **Output** panel (`Ctrl+Shift+U` / `Cmd+Shift+U`).
   b. Select **Agent-X** from the output channel dropdown.
   c. Verify the following log lines appear:
      ```
      Agent-X extension activating...
      Registered 26 commands.
      Status bar item created.
      Agent-X extension activated.
      ```
   d. Verify the **Agent-X** icon appears in the activity bar (left sidebar).
   e. Click the **Agent-X** activity bar icon.
   f. Verify the sidebar shows **Chat** and **Sessions** views (they will be empty/placeholder).
   g. Verify the status bar shows **$(hubot) Agent-X** on the left side.
   h. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
   i. Type `Agent-X:` and verify all 26 commands appear in the list.
   j. Execute `Agent-X: Open Settings` and verify it opens the settings page filtered to `agentx`.

- **Acceptance criteria**:
  - Extension Development Host launches without errors.
  - Output channel shows activation log messages.
  - Activity bar icon is visible.
  - Sidebar views are visible (even if empty).
  - Status bar item is visible.
  - All 26 commands appear in the Command Palette.
  - No errors in the Developer Tools console (`Help → Toggle Developer Tools`).

---

## Summary: Files Created/Modified

### New files (created):

| # | File Path | Task |
|---|-----------|------|
| 1 | `packages/vscode/package.json` | T1.1.2 |
| 2 | `packages/vscode/tsconfig.json` | T1.1.3 |
| 3 | `packages/vscode/tsconfig.webview.json` | T1.1.3b |
| 4 | `packages/vscode/.vscodeignore` | T1.1.4 |
| 5 | `packages/vscode/eslint.config.js` | T1.1.5 |
| 6 | `packages/vscode/esbuild.js` | T1.3.1 |
| 7 | `packages/vscode/esbuild.webview.js` | T1.3.2 |
| 8 | `packages/vscode/src/vscode.d.ts` | T1.3.3 |
| 9 | `packages/vscode/src/constants.ts` | T1.6.1 |
| 10 | `packages/vscode/src/extension.ts` | T1.6.2 |
| 11 | `packages/vscode/src/webview/ui/index.tsx` | T1.7.2 (placeholder) |
| 12 | `packages/vscode/media/agentx-activity-bar.svg` | T1.4.2 |
| 13 | `packages/vscode/media/agentx-session.svg` | T1.4.2 |
| 14 | `packages/vscode/test/runTest.ts` | T1.4.3 |
| 15 | `packages/vscode/test/suite/index.ts` | T1.4.3 |
| 16 | `packages/vscode/test/suite/extension.test.ts` | T1.4.3 |
| 17 | `.vscode/launch.json` | T1.5.3 |
| 18 | `.vscode/tasks.json` | T1.5.4 |
| 19 | `.vscode/settings.json` | T1.5.5 |

### Modified files:

| # | File Path | Task | Change |
|---|-----------|------|--------|
| 1 | `package.json` (root) | T1.5.2 | Add `packages/vscode/src` to lint script |

### New directories:

| # | Directory Path | Task |
|---|----------------|------|
| 1 | `packages/vscode/` | T1.1.1 |
| 2 | `packages/vscode/src/` | T1.4.1 |
| 3 | `packages/vscode/src/adapter/` | T1.4.1 |
| 4 | `packages/vscode/src/commands/` | T1.4.1 |
| 5 | `packages/vscode/src/providers/` | T1.4.1 |
| 6 | `packages/vscode/src/webview/` | T1.4.1 |
| 7 | `packages/vscode/src/webview/ui/` | T1.4.1 |
| 8 | `packages/vscode/src/webview/ui/components/` | T1.4.1 |
| 9 | `packages/vscode/src/statusbar/` | T1.4.1 |
| 10 | `packages/vscode/src/config/` | T1.4.1 |
| 11 | `packages/vscode/src/utils/` | T1.4.1 |
| 12 | `packages/vscode/media/` | T1.4.2 |
| 13 | `packages/vscode/test/` | T1.4.3 |
| 14 | `packages/vscode/test/suite/` | T1.4.3 |

---

## Execution Order (Recommended)

```
T1.1.1  Create directory
  │
  ├──▶ T1.1.2  Write package.json
  │      │
  │      ├──▶ T1.1.3   Write tsconfig.json
  │      ├──▶ T1.1.3b  Write tsconfig.webview.json
  │      ├──▶ T1.1.4   Write .vscodeignore
  │      ├──▶ T1.1.5   Write eslint.config.js
  │      ├──▶ T1.3.1   Write esbuild.js
  │      ├──▶ T1.3.2   Write esbuild.webview.js
  │      ├──▶ T1.5.2   Update root lint script
  │      ├──▶ T1.5.3   Write .vscode/launch.json
  │      └──▶ T1.5.4   Write .vscode/tasks.json
  │
  ├──▶ T1.3.3  Write src/vscode.d.ts
  ├──▶ T1.4.1  Create subdirectories + .gitkeep
  ├──▶ T1.4.2  Create media/ + SVGs
  ├──▶ T1.4.3  Create test/ + test files
  ├──▶ T1.5.1  Verify pnpm-workspace.yaml
  └──▶ T1.5.5  Write .vscode/settings.json
         │
         ▼
T1.6.1  Write constants.ts
  │
  ▼
T1.6.2  Write extension.ts
  │
  ▼
T1.7.1  pnpm install
  │
  ├──▶ T1.7.2  pnpm build
  ├──▶ T1.7.3  pnpm typecheck
  ├──▶ T1.7.4  pnpm lint
  │
  ▼
T1.7.5  Launch Extension Development Host
```

---

## Quick Reference: Key Engine Exports Used by Extension

The following exports from `@agentx/engine` and `@agentx/shared` will be consumed by subsequent phases. Listed here for reference — not needed in Phase 1 beyond the import in `extension.ts`.

### From `@agentx/engine`:
- `Agent`, `AgentOptions` — Main agent class (Phase 2)
- `AgentEventBus` — Event pub/sub (Phase 2)
- `ConfigManager` — Config read/write (Phase 3)
- `SessionManager` — Session CRUD (Phase 7)
- `SessionStore` — SQLite-backed session persistence (Phase 7)
- `TokenTracker` — Token usage tracking (Phase 3)
- `ProviderFactory` — Provider instantiation (Phase 8)
- `CrewManager` — Crew/persona CRUD (Phase 8)
- `SecretSauceManager` — Personality facade (Phase 9)
- `PermissionManager`, `ScopeGuard` — Permission system (Phase 6)
- `ToolRegistry`, `ToolExecutor` — Tool system (Phase 5)
- `createDefaultToolkit` — Default tool set (Phase 5)
- `CommandParser`, `CommandRegistry`, `createDefaultRegistry` — Slash commands (Phase 3)

### From `@agentx/shared`:
- `EngineEvent`, `EventHandler`, `EventBus` — Event types (Phase 2)
- `Session`, `SessionStatus`, `SessionCreateInput` — Session model (Phase 7)
- `Message`, `MessageRole`, `ToolCall` — Message model (Phase 4)
- `ProviderId`, `ModelInfo`, `ProviderConfig` — Provider types (Phase 8)
- `ToolDefinition`, `ToolResult`, `ToolCategory`, `ToolRiskLevel` — Tool types (Phase 5)
- `Permission`, `PermissionDecision`, `PermissionRequest` — Permission types (Phase 6)
- `AgentXConfig`, `ProviderSettings`, `UISettings` — Config types (Phase 3)
- `Crew`, `CrewCreateInput`, `CrewEmotion` — Crew types (Phase 8)
- `Plan`, `PlanStep` — Plan types (Phase 10)
- `TodoItem` — TODO types (Phase 10)

---

### T1.Z: Update Master Plan

- **Status**: ⬜
- **Dependencies**: All above
- **Action**: Update [00-MASTER-PLAN.md](00-MASTER-PLAN.md) with the current status of all completed tasks in this phase. Mark each task as complete (✅), in progress (🔄), or blocked (❌). Identify the next action item. Ensure the master plan remains the single source of truth.

- **Acceptance criteria**:
  - `00-MASTER-PLAN.md` is up to date with current phase progress.
  - Every task in this phase has a status annotation in the master plan.
  - Next action item is clearly identified.
