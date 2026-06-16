type FiberFn<T> = (signal: AbortSignal) => Promise<T>;

export class Fiber<T = unknown> {
  private _promise: Promise<T>;
  private _cancel: () => void;
  private _disposed = false;
  private _name: string;
  private _parent: Fiber | null = null;
  private _children: Fiber[] = [];
  private _startTime: number;

  static spawn<T>(name: string, fn: FiberFn<T>, scope?: Scope): Fiber<T> {
    const abort = new AbortController();
    const fiber = new Fiber<T>(name, fn, abort);
    if (scope) scope.acquire(fiber);
    return fiber;
  }

  constructor(name: string, fn: FiberFn<T>, abort: AbortController) {
    this._name = name;
    this._startTime = Date.now();
    this._cancel = () => { if (!abort.signal.aborted) { abort.abort(); } };
    this._promise = (async () => {
      try {
        return await fn(abort.signal);
      } finally {
        this._disposed = true;
      }
    })();
  }

  get name(): string { return this._name; }
  get disposed(): boolean { return this._disposed; }
  get elapsed(): number { return Date.now() - this._startTime; }
  get parent(): Fiber | null { return this._parent; }
  get children(): readonly Fiber[] { return [...this._children]; }

  join(): Promise<T> { return this._promise; }

  cancel(): void {
    if (this._disposed) return;
    this._cancel();
    for (const child of this._children) child.cancel();
    this._disposed = true;
  }

  addChild(child: Fiber): void {
    this._children.push(child);
    child._parent = this;
  }
}

import { Scope } from './Scope.js';
