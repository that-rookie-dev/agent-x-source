/**
 * Document Studio — primitive + compose adapter registries (spec §6, §7.1).
 *
 * One primitive = one service with typed I/O and structured errors (I12).
 * Adapters are the only place format libraries (docx/pdf/xlsx) may live.
 */

import type { ComposeStyle, JobPolicies, JobStep, JobStepOp, Master, MasterFormat, BindingSet, SectionDraft, EvidenceSet, TransformOp } from '../types.js';

// ─── Primitives ─────────────────────────────────────────────────────────────

export interface PrimitiveContext {
  jobId: string;
  sessionId?: string;
  policies: JobPolicies;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface PrimitiveResult {
  ok: boolean;
  /** Named outputs available to later steps (e.g. evidence sets, binding sets). */
  outputs?: Record<string, unknown>;
  error?: { code: string; message: string };
  warnings?: string[];
}

export type PrimitiveHandler = (step: JobStep, ctx: PrimitiveContext) => Promise<PrimitiveResult>;

export class PrimitiveRegistry {
  private readonly primitives = new Map<JobStepOp, PrimitiveHandler>();

  register(op: JobStepOp, handler: PrimitiveHandler): void {
    this.primitives.set(op, handler);
  }

  has(op: JobStepOp): boolean {
    return this.primitives.has(op);
  }

  get(op: JobStepOp): PrimitiveHandler | undefined {
    return this.primitives.get(op);
  }

  list(): JobStepOp[] {
    return [...this.primitives.keys()];
  }
}

// ─── Compose adapters ───────────────────────────────────────────────────────

export interface ComposeInput {
  master: Master; // primary
  secondary?: Master[]; // skin, annexes
  bindingSet?: BindingSet;
  sectionDrafts?: SectionDraft[];
  evidenceSet?: EvidenceSet;
  facts?: unknown[];
  transformOp?: TransformOp;
  adapterHints?: Record<string, unknown>;
  policies: JobPolicies;
}

export interface ComposeOutput {
  bytes: Uint8Array;
  format: MasterFormat;
  warnings: string[];
}

export interface ComposeAdapter {
  style: ComposeStyle;
  formats: MasterFormat[];
  compose(input: ComposeInput): Promise<ComposeOutput>;
}

export class ComposeRegistry {
  private readonly adapters: ComposeAdapter[] = [];

  register(adapter: ComposeAdapter): void {
    this.adapters.push(adapter);
  }

  /** Compile-time rejection surface: unsupported style+format is a spec error, not a runtime crash (§7.4). */
  find(style: ComposeStyle, format: MasterFormat): ComposeAdapter | undefined {
    return this.adapters.find((a) => a.style === style && a.formats.includes(format));
  }

  /** Lookup by style, ignoring format (used for render-style adapters). */
  findByStyle(style: ComposeStyle): ComposeAdapter | undefined {
    return this.adapters.find((a) => a.style === style);
  }

  supports(style: ComposeStyle, format: MasterFormat): boolean {
    return this.find(style, format) !== undefined;
  }
}
