export interface UiApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: Record<string, unknown>;
}

export interface UiApiResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface UiRouteInfo {
  method: string;
  path: string;
  description?: string;
}

let uiApiInvoker: ((req: UiApiRequest) => Promise<UiApiResponse>) | null = null;
let uiRouteLister: (() => UiRouteInfo[]) | null = null;

export function setUiApiInvoker(invoker: (req: UiApiRequest) => Promise<UiApiResponse>): void {
  uiApiInvoker = invoker;
}

export function getUiApiInvoker(): ((req: UiApiRequest) => Promise<UiApiResponse>) | null {
  return uiApiInvoker;
}

export function setUiRouteLister(lister: () => UiRouteInfo[]): void {
  uiRouteLister = lister;
}

export function getUiRouteLister(): (() => UiRouteInfo[]) | null {
  return uiRouteLister;
}
