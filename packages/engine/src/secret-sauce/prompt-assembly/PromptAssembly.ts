import type {
  PromptSection,
  SourceSnapshot,
  Generation,
  ReconcileResult,
  ReplacementResult,
} from './types.js';

interface LoadedEntry {
  readonly key: string;
  readonly value: unknown;
  readonly snapshot: SourceSnapshot;
  readonly baselineText?: string;
  readonly unavailable: boolean;
}

export class PromptAssembly {
  private sections = new Map<string, PromptSection>();

  register<T>(section: PromptSection<T>): this {
    if (this.sections.has(section.key)) {
      throw new Error(`Duplicate prompt section key: ${section.key}`);
    }
    this.sections.set(section.key, section as PromptSection);
    return this;
  }

  get size(): number {
    return this.sections.size;
  }

  has(key: string): boolean {
    return this.sections.has(key);
  }

  remove(key: string): void {
    this.sections.delete(key);
  }

  /** Sync initialisation — produces baseline + snapshot from currently registered sections.
   *  Requires all sections to have sync load() methods at this point. */
  initializeSync(): Generation {
    const entries = this.loadAllSync();
    const available = entries.filter(e => !e.unavailable);

    const baseline = available
      .map(e => e.baselineText!)
      .join('\n\n');

    const snapshot: Record<string, SourceSnapshot> = {};
    for (const entry of available) {
      snapshot[entry.key] = entry.snapshot;
    }

    return { baseline, snapshot };
  }

  /** Full async initialisation — allows sections with async load(). */
  async initialize(): Promise<Generation> {
    const entries = await this.loadAllAsync();
    const available = entries.filter(e => !e.unavailable);

    const baseline = available
      .map(e => e.baselineText!)
      .join('\n\n');

    const snapshot: Record<string, SourceSnapshot> = {};
    for (const entry of available) {
      snapshot[entry.key] = entry.snapshot;
    }

    return { baseline, snapshot };
  }

  /** Reconciles current state against a previous snapshot. Returns diffs for changed sections. */
  async reconcile(previous: Record<string, SourceSnapshot>): Promise<ReconcileResult> {
    const entries = await this.loadAllAsync();
    const available = entries.filter(e => !e.unavailable);

    // Check if any previously-admitted section is now unavailable → blocked
    const admittedKeys = Object.keys(previous);
    for (const key of admittedKeys) {
      const entry = entries.find(e => e.key === key);
      if (entry?.unavailable) {
        return { tag: 'replacement-blocked' };
      }
    }

    // Check for keys removed without a removal renderer
    const currentKeys = new Set(available.map(e => e.key));
    for (const key of admittedKeys) {
      if (!currentKeys.has(key)) {
        const section = this.sections.get(key);
        if (!section?.removed) {
          return { tag: 'replacement-needed', generation: await this.buildGeneration() };
        }
      }
    }

    const updates: string[] = [];
    const snapshot: Record<string, SourceSnapshot> = {};
    let changed = false;

    for (const entry of available) {
      const stored = previous[entry.key];

      if (!stored) {
        updates.push(entry.baselineText!);
        snapshot[entry.key] = entry.snapshot;
        changed = true;
        continue;
      }

      const section = this.sections.get(entry.key)!;
      const previousValue = stored.value;
      const currentValue = entry.value;

      if (this.deepEqual(previousValue, currentValue)) {
        snapshot[entry.key] = stored;
        continue;
      }

      const diffText = section.diff(previousValue, currentValue);
      if (diffText === null) {
        snapshot[entry.key] = stored;
        continue;
      }

      updates.push(diffText);
      snapshot[entry.key] = entry.snapshot;
      changed = true;
    }

    // Handle removed sections
    for (const key of admittedKeys) {
      if (!currentKeys.has(key)) {
        const section = this.sections.get(key);
        if (section?.removed) {
          const prevValue = previous[key]?.value;
          if (prevValue !== undefined) {
            updates.push(section.removed(prevValue));
            changed = true;
          }
        }
      }
    }

    if (!changed) return { tag: 'unchanged' };
    return { tag: 'updated', update: { text: updates.join('\n\n'), snapshot } };
  }

  /** Replace the entire generation (forced baseline rebuild). */
  async replace(previous: Record<string, SourceSnapshot>): Promise<ReplacementResult> {
    const entries = await this.loadAllAsync();

    const admittedKeys = new Set(Object.keys(previous));
    for (const entry of entries) {
      if (entry.unavailable && admittedKeys.has(entry.key)) {
        return { tag: 'replacement-blocked' };
      }
    }

    const available = entries.filter(e => !e.unavailable);
    const baseline = available.map(e => e.baselineText!).join('\n\n');
    const snapshot: Record<string, SourceSnapshot> = {};
    for (const entry of available) {
      snapshot[entry.key] = entry.snapshot;
    }

    return { tag: 'replacement-ready', generation: { baseline, snapshot } };
  }

  private loadAllSync(): LoadedEntry[] {
    const results: LoadedEntry[] = [];
    for (const [, section] of this.sections) {
      try {
        const value = section.load();
        if (value instanceof Promise) {
          // If any section is async during sync init, treat as unavailable
          results.push({
            key: section.key,
            unavailable: true,
            value: null,
            snapshot: { value: null },
            baselineText: undefined,
          });
          continue;
        }
        const baselineText = section.render(value);
        if (baselineText.length === 0) {
          results.push({
            key: section.key,
            unavailable: true,
            value: null,
            snapshot: { value: this.toJson(value) },
            baselineText: undefined,
          });
          continue;
        }
        results.push({
          key: section.key,
          value,
          unavailable: false,
          snapshot: {
            value: this.toJson(value),
            ...(section.removed ? { removed: section.removed(value) } : {}),
          },
          baselineText,
        });
      } catch {
        results.push({ key: section.key, unavailable: true, value: null, snapshot: { value: null }, baselineText: undefined });
      }
    }
    return results;
  }

  private async loadAllAsync(): Promise<LoadedEntry[]> {
    const results = await Promise.all(
      [...this.sections.entries()].map(async ([key, section]) => {
        try {
          const value = await Promise.resolve(section.load());
          const valueJson = this.toJson(value);
          const baselineText = section.render(value);
          if (baselineText.length === 0) {
            return { key, unavailable: true, value: null, snapshot: { value: valueJson }, baselineText: undefined };
          }
          return {
            key,
            value,
            unavailable: false,
            snapshot: {
              value: valueJson,
              ...(section.removed ? { removed: section.removed(value) } : {}),
            },
            baselineText,
          };
        } catch {
          return { key, unavailable: true, value: null, snapshot: { value: null }, baselineText: undefined };
        }
      }),
    );
    return results;
  }

  private async buildGeneration(): Promise<Generation> {
    return this.initialize();
  }

  private toJson(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'object') {
      if (Array.isArray(value)) return value.map(v => this.toJson(v));
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        obj[k] = this.toJson(v);
      }
      return obj;
    }
    return String(value);
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
