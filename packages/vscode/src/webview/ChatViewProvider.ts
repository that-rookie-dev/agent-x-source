import * as vscode from 'vscode';
import { EventBridge } from '../adapter/EventBridge';
import { EngineLifecycle } from '../adapter/EngineLifecycle';
import { ConfigBridge } from '../adapter/ConfigBridge';

type MessageHandler = (data: unknown) => void;

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentx.chatView';

  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];
  private messageHandlers = new Map<string, MessageHandler[]>();
  private pendingMessages: Array<{ type: string; data: unknown }> = [];
  private webviewReady = false;
  private streamActive = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly engineLifecycle: EngineLifecycle,
    private readonly eventBridge: EventBridge,
    private readonly configBridge: ConfigBridge,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      (message: { type: string; data: unknown }) => {
        this.handleWebviewMessage(message.type, message.data);
      },
      undefined,
      this.disposables,
    );

    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.webviewReady = false;
      for (const d of this.disposables) {
        d.dispose();
      }
      this.disposables = [];
    }, undefined, this.disposables);

    this.wireExtensionHostHandlers();
    this.wireEventBridge();
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.css'),
    );
    const nonce = this.generateNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: https:; connect-src ${webview.cspSource} https://api.openai.com https://api.anthropic.com; form-action 'none';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Agent-X Chat</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private generateNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
      nonce += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return nonce;
  }

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
    if (type === 'ready') {
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

  private wireEventBridge(): void {
    this.disposables.push(
      this.eventBridge.onMessage((msg) => {
        const role: 'user' | 'assistant' = msg.role === 'user' ? 'user' : 'assistant';
        this.postToWebview('appendMessage', {
          id: msg.id,
          role,
          content: msg.content,
          timestamp: Date.parse(msg.createdAt) || Date.now(),
          tokenCost: msg.tokenCost,
        });
      }),
      this.eventBridge.onStream((chunk) => {
        if (!this.streamActive) {
          this.streamActive = true;
          this.postToWebview('streamStart', {});
        }
        this.postToWebview('updateStream', {
          content: chunk.content,
          fullContent: chunk.fullContent,
        });
      }),
      this.eventBridge.onToolEvent((execution) => {
        if (execution.status === 'executing') {
          this.postToWebview('toolExecuting', {
            tool: execution.toolName,
            description: execution.description,
            startTime: execution.startTime,
          });
        } else {
          this.postToWebview('toolComplete', {
            tool: execution.toolName,
            result: execution.result?.output ?? '',
            elapsed: execution.elapsed ?? 0,
          });
        }
      }),
      this.eventBridge.onPermission((req) => {
        this.postToWebview('permissionRequired', {
          requestId: req.requestId ?? `${req.tool}-${req.timestamp}`,
          tool: req.tool,
          path: req.path,
          riskLevel: req.riskLevel,
          description: `Allow ${req.tool} to access ${req.path} (${req.riskLevel} risk)`,
        });
      }),
      this.eventBridge.onPlanEvent((event) => {
        if (event.type === 'plan_generated' && 'plan' in event) {
          const enginePlan = event.plan as unknown as Record<string, unknown>;
          this.postToWebview('planUpdate', {
            action: 'generated',
            plan: {
              planId: (enginePlan.id ?? enginePlan.planId) as string,
              title: enginePlan.title as string,
              status: enginePlan.status as string,
              steps: enginePlan.steps as Array<Record<string, unknown>>,
            },
            userRequest: event.userRequest ?? '',
          });
        } else if (event.type.startsWith('plan_step_')) {
          this.postToWebview('planUpdate', {
            action: 'stepUpdate',
            stepId: (event as any).stepId ?? '',
            planId: (event as any).planId ?? '',
            status: event.type.replace('plan_step_', ''),
            result: (event as any).result,
            error: (event as any).error,
          });
        }
      }),
      this.eventBridge.onSubAgentEvent((agent) => {
        this.postToWebview('subAgentUpdate', agent);
      }),
      this.eventBridge.onReasoning((state) => {
        if (state.isActive && state.glimpses.length === 0) {
          this.postToWebview('reasoningUpdate', { action: 'start' });
        } else if (state.isActive) {
          this.postToWebview('reasoningUpdate', {
            action: 'glimpse',
            text: state.glimpses[state.glimpses.length - 1],
          });
        } else {
          this.postToWebview('reasoningUpdate', { action: 'complete' });
        }
      }),
      this.eventBridge.onTodo((items) => {
        this.postToWebview('todoUpdate', { items });
      }),
      this.eventBridge.onDiffPreview((diff) => {
        this.postToWebview('diffPreview', diff);
      }),
      this.eventBridge.onError((error) => {
        this.postToWebview('error', {
          code: error.code,
          message: error.message,
          recoverable: error.recoverable,
          actions: error.actions?.map((a) => ({
            label: a.label,
            action: a.type,
          })),
        });
      }),
      this.eventBridge.onTokenUpdate((state) => {
        this.postToWebview('statusUpdate', {
          tokens: {
            used: state.used,
            total: state.total,
            percentage: state.percentage,
            cost: state.totalCost,
          },
          provider: this.configBridge?.getActiveProvider(),
          model: this.configBridge?.getActiveModel(),
        });
      }),
      this.eventBridge.onLoading((stage) => {
        if (stage) {
          this.postToWebview('loadingStart', { stage });
        } else {
          this.postToWebview('loadingEnd', {});
          if (this.streamActive) {
            this.streamActive = false;
            this.postToWebview('streamEnd', {});
          }
        }
      }),
      this.eventBridge.onProcessing((info) => {
        if (info) {
          this.postToWebview('processingUpdate', {
            taskDescription: info.taskDescription,
            stage: info.stage,
            progress: info.progress,
          });
        } else {
          this.postToWebview('processingUpdate', null);
        }
      }),
      this.eventBridge.onClarification((req) => {
        this.postToWebview('clarification', {
          questionId: `clarify-${Date.now()}`,
          question: req.question,
          options: req.options,
          allowFreeform: req.allowFreeform,
        });
      }),
      this.eventBridge.onIndexing((state) => {
        this.postToWebview('indexingUpdate', state);
      }),
      this.eventBridge.onResearch((state) => {
        this.postToWebview('researchUpdate', state);
      }),
      this.eventBridge.onCompaction((event) => {
        this.postToWebview('compactionUpdate', event);
      }),
      this.eventBridge.onWatchEvent((event) => {
        this.postToWebview('watchEvent', event);
      }),
      this.eventBridge.onBackgroundTask((event) => {
        this.postToWebview('backgroundTaskUpdate', event);
      }),
      this.eventBridge.onReminder((event) => {
        this.postToWebview('reminderFired', event);
      }),
      this.eventBridge.onMeta((event) => {
        const e = event as { type: string; [key: string]: unknown };
        if (e.type === 'tot_start') {
          this.postToWebview('totUpdate', {
            state: { thoughts: [], scores: {}, bestThoughtId: undefined, isComplete: false, problem: '' },
          });
        } else if (e.type === 'tot_thought_generated') {
          this.postToWebview('totUpdate', {
            state: {
              thoughts: [{ id: e.thoughtId, content: e.content, score: 0, parentId: e.parentId, depth: e.depth }],
              scores: {},
              isComplete: false,
              problem: '',
            },
          });
        } else if (e.type === 'tot_complete') {
          this.postToWebview('totUpdate', {
            state: {
              thoughts: [{ id: e.bestThoughtId, content: e.content, score: e.score, parentId: undefined, depth: 0 }],
              scores: { [e.bestThoughtId as string]: e.score as number },
              bestThoughtId: e.bestThoughtId,
              isComplete: true,
              problem: '',
            },
          });
        }
      }),
    );
  }

  private wireExtensionHostHandlers(): void {
    this.onWebviewMessage('sendMessage', async (data) => {
      const { content } = data as { content: string };
      await this.engineLifecycle.sendMessage(content);
    });

    this.onWebviewMessage('cancelProcessing', async () => {
      await this.engineLifecycle.cancelCurrentTask();
    });

    this.onWebviewMessage('permissionRespond', async (data) => {
      const { requestId, decision } = data as {
        requestId: string;
        decision: 'allow-once' | 'allow-always' | 'deny';
      };
      await this.engineLifecycle.respondToPermission(requestId, decision);
    });

    this.onWebviewMessage('permissionRespondBatch', async (data) => {
      const { decision } = data as {
        decision: 'allow-once' | 'allow-always';
      };
      await this.engineLifecycle.respondToPermissionBatch(decision);
    });

    this.onWebviewMessage('planApprove', async (data) => {
      const { planId } = data as { planId: string };
      await this.engineLifecycle.approvePlan(planId);
    });

    this.onWebviewMessage('planReject', async (data) => {
      const { planId } = data as { planId: string };
      await this.engineLifecycle.rejectPlan(planId);
    });

    this.onWebviewMessage('stepApprove', async (data) => {
      const { stepId, planId } = data as { stepId: string; planId: string };
      await this.engineLifecycle.approvePlanStep(planId, stepId);
    });

    this.onWebviewMessage('stepSkip', async (data) => {
      const { stepId, planId } = data as { stepId: string; planId: string };
      await this.engineLifecycle.skipPlanStep(planId, stepId);
    });

    this.onWebviewMessage('stepModify', async (data) => {
      const { stepId, planId, modification } = data as {
        stepId: string;
        planId: string;
        modification: string;
      };
      await this.engineLifecycle.modifyPlanStep(planId, stepId, modification);
    });

    this.onWebviewMessage('clarificationResponse', async (data) => {
      const { questionId, response } = data as {
        questionId: string;
        response: string;
      };
      await this.engineLifecycle.respondToClarification(questionId, response);
    });

    this.onWebviewMessage('steerMessage', async (data) => {
      const { instruction } = data as { instruction: string };
      await this.engineLifecycle.sendSteerMessage(instruction);
    });

    this.onWebviewMessage('subAgentCancel', async (data) => {
      const { agentId } = data as { agentId: string };
      const engine = this.engineLifecycle.getEngine()?.getAgent();
      if (engine) {
        const manager = (engine as unknown as { subAgents: import('@agentx/engine').SubAgentManager }).subAgents;
        await manager.cancel(agentId);
      }
    });

    this.onWebviewMessage('backgroundTaskCancel', async (data) => {
      const { taskId } = data as { taskId: string };
      const engine = this.engineLifecycle.getEngine()?.getAgent();
      if (engine) {
        const queue = (engine as unknown as { backgroundQueue?: import('@agentx/engine').BackgroundQueue }).backgroundQueue;
        queue?.cancel(taskId);
      }
    });
  }

  notifyWorkspaceChanged(newRoot: string): void {
    this.postToWebview('statusUpdate', {
      workspaceRoot: newRoot,
    });
  }

  notifyWorkspaceRemoved(): void {
    this.postToWebview('clearMessages', {});
    this.postToWebview('error', {
      code: 'WORKSPACE_REMOVED',
      message: 'Workspace was closed. Open a folder to continue.',
      recoverable: true,
    });
  }

  restoreSession(messages: Array<{
    id: string; role: string; content: string; timestamp: number;
  }>, title: string): void {
    this.postToWebview('sessionRestored', { messages, title });
  }

  clearMessages(): void {
    this.postToWebview('clearMessages', {});
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
    this.messageHandlers.clear();
    this.pendingMessages = [];
    this.view = undefined;
    this.webviewReady = false;
    this.streamActive = false;
  }
}
