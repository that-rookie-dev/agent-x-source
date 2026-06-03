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
