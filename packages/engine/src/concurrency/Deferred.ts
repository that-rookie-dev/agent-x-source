/**
 * A Promise that can be resolved or rejected externally.
 */
export class Deferred<T = void> {
  readonly promise: Promise<T>;
  private _resolve!: (value: T | PromiseLike<T>) => void;
  private _reject!: (reason: unknown) => void;
  private _settled = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  get settled(): boolean {
    return this._settled;
  }

  resolve(value: T): void {
    if (this._settled) return;
    this._settled = true;
    this._resolve(value);
  }

  reject(reason: unknown): void {
    if (this._settled) return;
    this._settled = true;
    this._reject(reason);
  }
}
