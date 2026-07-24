/**
 * Document Studio — service facade (spec §7.1).
 *
 * Phase 1: MasterService live (upload, honest analysis, list/get/update).
 * Binder/Job services land in Phases 2–3. Tools and HTTP routes must call
 * this service — never each other (I10).
 */

import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createContext, Script } from 'node:vm';
import { basename, dirname, extname, join } from 'node:path';
import JSZip from 'jszip';
import { generateText } from 'ai';
import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import { getAttachmentService } from '../attachments/index.js';
import { JobRunner, canTransition } from './runner/JobRunner.js';
import { ComposeRegistry, PrimitiveRegistry } from './runner/PrimitiveRegistry.js';
import { MasterStore } from './masters/MasterStore.js';
import { analyzeMasterBuffer, classifyKind, detectMasterFormat, parseCsv, profileColumn, tryCreateModel } from './masters/analyzers.js';
import { BinderStore } from './binders/BinderStore.js';
import { AnswerSetStore } from './binders/AnswerSetStore.js';
import { MappingStore, validateMapping } from './binders/MappingStore.js';
import { JobStore, ManifestStore } from './jobs/JobStore.js';
import { InstanceStore, type Instance } from './jobs/InstanceStore.js';
import { ArtifactStore } from './jobs/ArtifactStore.js';
import { composeFillClone, supportsFillClone } from './compose/fillClone.js';
import { composeMarkdown, composeHtml, composeJson, composeYaml, composeDiagram, composeLatex } from './compose/render.js';
import { composeAuthor } from './compose/author.js';
import { composeAssemble } from './compose/assemble.js';
import { composeMergePack } from './compose/mergePack.js';
import { composeTransform } from './compose/transform.js';
import { validateJobSpec } from './jobspec.js';
import { RECIPE_CATALOG, compileRecipeToSpec } from './recipes/catalog.js';
import type { Master, MasterKind, Binder, BinderSlot, AnswerSet, Mapping, MappingEntry, KbSelector, Job, JobSpec, JobStep, Artifact, ArtifactRef, ProvenanceOrigin, Manifest, ManifestRow, Fact } from './types.js';
import type { PrimitiveContext, PrimitiveResult } from './runner/PrimitiveRegistry.js';
import { getKnowledgeBaseService } from '../knowledge-base/index.js';
import type { KnowledgeBaseService } from '../knowledge-base/KnowledgeBaseService.js';
import { documentStudioEventBus } from './events/DocumentStudioEventBus.js';
import { extractJsonObject } from '../agent/task-executor-helpers.js';

export interface DocumentStudioServiceOptions {
  pool: Pool;
  /** Workspace root used for delivery paths (Phase 3+). */
  workspaceRoot?: string;
}

export type MasterAnalysisListener = (master: Master) => void;

// ─── Validate deep-check helpers ─────────────────────────────────────────────

function gatherDraftChunks(ctx: PrimitiveContext): string[] {
  const chunks: string[] = [];
  const add = (v: unknown) => {
    const s = decodeText(v);
    if (s) chunks.push(s);
  };
  for (const key of ['draft', 'content'] as const) add(ctx[key]);
  add(ctx['bytes']);
  const outputs = ctx['outputs'] as Array<{ bytes?: unknown; text?: string }> | undefined;
  if (outputs) {
    for (const o of outputs) {
      if (o.bytes) add(o.bytes);
      else if (o.text) chunks.push(o.text);
    }
  }
  const sections = ctx['sections'] as Array<{ content?: unknown; text?: string; body?: string }> | undefined;
  if (sections) {
    for (const s of sections) {
      if (s.content) add(s.content);
      if (s.text) add(s.text);
      if (s.body) add(s.body);
    }
  }
  return chunks;
}

function decodeText(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input instanceof Uint8Array) return new TextDecoder().decode(input);
  if (input && typeof input === 'object' && 'toString' in input) {
    const s = (input as any).toString();
    if (typeof s === 'string' && s !== '[object Object]') return s;
  }
  return undefined;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function ngrams(text: string, n: number): string[] {
  const words = text.split(' ').filter((w) => w.length > 0);
  const out: string[] = [];
  for (let i = 0; i <= words.length - n; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}

function evidenceTexts(facts: unknown[], evidence: unknown[]): string[] {
  const out: string[] = [];
  for (const f of facts) out.push(typeof f === 'string' ? f : ((f as any).text ?? String(f)));
  for (const e of evidence) out.push(typeof e === 'string' ? e : ((e as any).content ?? (e as any).text ?? String(e)));
  return out.filter(Boolean);
}

function isLikelyClaim(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.length < 15) return false;
  if (/\d/.test(trimmed) || /[%$]/.test(trimmed)) return true;
  const words = trimmed.split(/\s+/);
  return words.slice(1).some((w) => /^[A-Z]/.test(w));
}

function findUnsupportedClaims(chunks: string[], facts: unknown[], evidence: unknown[]): string[] {
  const ev = evidenceTexts(facts, evidence);
  const evFull = ev.map(normalizeText);
  const evNgrams = new Set<string>();
  for (const t of ev) for (const g of ngrams(normalizeText(t), 3)) evNgrams.add(g);
  const unsupported: string[] = [];
  for (const chunk of chunks) {
    const sentences = chunk.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 15) continue;
      if (!isLikelyClaim(trimmed)) continue;
      if (/[[(].*?[\])]/.test(trimmed)) continue;
      const norm = normalizeText(trimmed);
      if (norm.length < 8) continue;
      if (evFull.some((f) => norm.includes(f) || f.includes(norm))) continue;
      const sNgrams = ngrams(norm, 3);
      if (sNgrams.length > 0 && sNgrams.some((g) => evNgrams.has(g))) continue;
      unsupported.push(trimmed);
    }
  }
  return unsupported;
}

function gatherDraftHeadings(ctx: PrimitiveContext): string[] {
  const headings: string[] = [];
  for (const chunk of gatherDraftChunks(ctx)) {
    for (const line of chunk.split('\n')) {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m && m[2]) headings.push(m[2].trim());
    }
  }
  const sections = ctx['sections'] as Array<{ title?: string }> | undefined;
  if (sections) {
    for (const s of sections) if (s.title) headings.push(String(s.title).trim());
  }
  return headings;
}

function flattenSectionOutlines(sections: unknown[]): Array<{ title: string }> {
  const out: Array<{ title: string }> = [];
  for (const s of sections) {
    if (!s || typeof s !== 'object') continue;
    const obj = s as Record<string, unknown>;
    if (typeof obj.title === 'string' && obj.title) out.push({ title: obj.title });
    out.push(...flattenSectionOutlines(Array.isArray(obj.children) ? obj.children : []));
  }
  return out;
}

function fuzzyTitleMatch(heading: string, required: string): boolean {
  const h = normalizeText(heading);
  const r = normalizeText(required);
  if (h === r || h.includes(r) || r.includes(h)) return true;
  const ht = h.split(' ').filter((w) => w.length > 0);
  const rt = r.split(' ').filter((w) => w.length > 0);
  if (rt.length === 0) return false;
  const common = rt.filter((w) => ht.includes(w));
  if (common.length === rt.length) return true;
  return common.length / rt.length >= 0.5;
}

function compareInstances(instances: unknown[], keys: string[] | undefined): string[] {
  const errors: string[] = [];
  const valuesList: Record<string, unknown>[] = [];
  for (const inst of instances) {
    if (!inst || typeof inst !== 'object') continue;
    const raw = (inst as any).values ?? (inst as any).bindingSet?.values ?? inst;
    const rec = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    valuesList.push(rec);
  }
  const metaKeys = new Set(['index', 'path', 'masterId', 'bindingSetId', 'status', 'id']);
  const targetKeys =
    keys && keys.length > 0
      ? keys
      : Array.from(new Set(valuesList.flatMap((v) => Object.keys(v)))).filter(
          (k) => !metaKeys.has(k) && valuesList.filter((v) => v[k] !== undefined).length > 1,
        );
  for (const k of targetKeys) {
    const vals = valuesList.map((v) => v[k]).filter((v) => v !== undefined);
    if (vals.length < 2) continue;
    const reprs = vals.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)));
    const unique = new Set(reprs);
    if (unique.size > 1) errors.push(`Cross-doc mismatch on ${k}: ${Array.from(unique).join(' | ')}`);
  }
  return errors;
}

function normalizeBusinessRules(raw: unknown): Array<{ expression: string; message?: string }> {
  if (!raw) return [];
  if (typeof raw === 'string') return [{ expression: raw }];
  if (Array.isArray(raw)) return raw.map(normalizeBusinessRule).filter((r): r is { expression: string; message?: string } => !!r);
  const obj = raw as Record<string, unknown>;
  if (typeof obj.expression === 'string') return [{ expression: obj.expression, message: typeof obj.message === 'string' ? obj.message : undefined }];
  return [];
}

function normalizeBusinessRule(raw: unknown): { expression: string; message?: string } | null {
  if (typeof raw === 'string') return { expression: raw };
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.expression === 'string') return { expression: obj.expression, message: typeof obj.message === 'string' ? obj.message : undefined };
  }
  return null;
}

function safeEvaluateBusinessRule(expression: string, scope: Record<string, unknown>): boolean {
  const tokens = tokenize(expression);
  const ast = parseExpression(tokens);
  return isTruthy(evalNode(ast, scope));
}

interface Token {
  type: 'number' | 'string' | 'identifier' | 'operator' | 'lparen' | 'rparen';
  value: string;
}

type ExprNode =
  | { type: 'literal'; value: unknown }
  | { type: 'var'; name: string }
  | { type: 'unary'; op: string; operand: ExprNode }
  | { type: 'binary'; op: string; left: ExprNode; right: ExprNode };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr.charAt(i);
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ type: 'lparen', value: c });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ type: 'rparen', value: c });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let s = '';
      i++;
      while (i < expr.length && expr.charAt(i) !== quote) {
        if (expr.charAt(i) === '\\' && i + 1 < expr.length) {
          i++;
          s += expr.charAt(i);
        } else {
          s += expr.charAt(i);
        }
        i++;
      }
      i++;
      tokens.push({ type: 'string', value: s });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(expr.charAt(i + 1) ?? ''))) {
      let num = '';
      while (i < expr.length && /[0-9.]/.test(expr.charAt(i))) {
        num += expr.charAt(i);
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let id = '';
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr.charAt(i))) {
        id += expr.charAt(i);
        i++;
      }
      const lower = id.toLowerCase();
      if (lower === 'and') tokens.push({ type: 'operator', value: '&&' });
      else if (lower === 'or') tokens.push({ type: 'operator', value: '||' });
      else if (lower === 'not') tokens.push({ type: 'operator', value: '!' });
      else tokens.push({ type: 'identifier', value: id });
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'operator', value: two });
      i += 2;
      continue;
    }
    if (/[+\-*/%><!]/.test(c)) {
      tokens.push({ type: 'operator', value: c });
      i++;
      continue;
    }
    throw new Error(`Unexpected token at ${i}: ${c}`);
  }
  return tokens;
}

function parseExpression(tokens: Token[]): ExprNode {
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = (type?: Token['type'], value?: string): Token => {
    const t = tokens[pos];
    if (!t) throw new Error('Unexpected end of expression');
    if (type && t.type !== type) throw new Error(`Expected ${type} but got ${t.type}`);
    if (value !== undefined && t.value !== value) throw new Error(`Expected ${value} but got ${t.value}`);
    pos++;
    return t;
  };
  function parseOr(): ExprNode {
    let left = parseAnd();
    while (peek() && peek()!.type === 'operator' && peek()!.value === '||') {
      const op = consume('operator').value;
      left = { type: 'binary', op, left, right: parseAnd() };
    }
    return left;
  }
  function parseAnd(): ExprNode {
    let left = parseEquality();
    while (peek() && peek()!.type === 'operator' && peek()!.value === '&&') {
      const op = consume('operator').value;
      left = { type: 'binary', op, left, right: parseEquality() };
    }
    return left;
  }
  function parseEquality(): ExprNode {
    let left = parseNot();
    while (peek() && peek()!.type === 'operator' && (peek()!.value === '==' || peek()!.value === '!=')) {
      const op = consume('operator').value;
      left = { type: 'binary', op, left, right: parseNot() };
    }
    return left;
  }
  function parseNot(): ExprNode {
    const t = peek();
    if (t && t.type === 'operator' && t.value === '!') {
      consume('operator');
      return { type: 'unary', op: '!', operand: parseNot() };
    }
    return parseComparison();
  }

  function parseComparison(): ExprNode {
    let left = parseAdditive();
    while (peek() && peek()!.type === 'operator' && ['>', '<', '>=', '<='].includes(peek()!.value)) {
      const op = consume('operator').value;
      left = { type: 'binary', op, left, right: parseAdditive() };
    }
    return left;
  }
  function parseAdditive(): ExprNode {
    let left = parseMultiplicative();
    while (peek() && peek()!.type === 'operator' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = consume('operator').value;
      left = { type: 'binary', op, left, right: parseMultiplicative() };
    }
    return left;
  }
  function parseMultiplicative(): ExprNode {
    let left = parseUnary();
    while (peek() && peek()!.type === 'operator' && (peek()!.value === '*' || peek()!.value === '/' || peek()!.value === '%')) {
      const op = consume('operator').value;
      left = { type: 'binary', op, left, right: parseUnary() };
    }
    return left;
  }
  function parseUnary(): ExprNode {
    const t = peek();
    if (t && t.type === 'operator' && t.value === '-') {
      consume('operator');
      return { type: 'unary', op: '-', operand: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary(): ExprNode {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.type === 'lparen') {
      consume('lparen');
      const node = parseOr();
      consume('rparen');
      return node;
    }
    if (t.type === 'number') {
      consume();
      return { type: 'literal', value: parseFloat(t.value) };
    }
    if (t.type === 'string') {
      consume();
      return { type: 'literal', value: t.value };
    }
    if (t.type === 'identifier') {
      consume();
      const lower = t.value.toLowerCase();
      if (lower === 'true') return { type: 'literal', value: true };
      if (lower === 'false') return { type: 'literal', value: false };
      return { type: 'var', name: t.value };
    }
    throw new Error(`Unexpected token ${t.value}`);
  }
  const node = parseOr();
  if (pos !== tokens.length) throw new Error('Trailing tokens in expression');
  return node;
}

function evalNode(node: ExprNode, scope: Record<string, unknown>): unknown {
  if (node.type === 'literal') return node.value;
  if (node.type === 'var') return scope[node.name] ?? 0;
  if (node.type === 'unary') {
    const v = evalNode(node.operand, scope);
    if (node.op === '!') return !isTruthy(v);
    if (node.op === '-') return -toNumber(v);
    throw new Error(`Unknown unary ${node.op}`);
  }
  if (node.type === 'binary') {
    const left = evalNode(node.left, scope);
    const right = evalNode(node.right, scope);
    switch (node.op) {
      case '+':
        return toNumber(left) + toNumber(right);
      case '-':
        return toNumber(left) - toNumber(right);
      case '*':
        return toNumber(left) * toNumber(right);
      case '/':
        return toNumber(right) === 0 ? NaN : toNumber(left) / toNumber(right);
      case '%':
        return toNumber(left) % toNumber(right);
      case '>':
        return compareValues(left, right) > 0;
      case '<':
        return compareValues(left, right) < 0;
      case '>=':
        return compareValues(left, right) >= 0;
      case '<=':
        return compareValues(left, right) <= 0;
      case '==':
        return String(left) === String(right);
      case '!=':
        return String(left) !== String(right);
      case '&&':
        return isTruthy(left) && isTruthy(right);
      case '||':
        return isTruthy(left) || isTruthy(right);
      default:
        throw new Error(`Unknown operator ${node.op}`);
    }
  }
  throw new Error('Unknown expression node');
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function compareValues(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

function isTruthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return !Number.isNaN(v) && v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return false;
}

export class DocumentStudioService {
  readonly primitives = new PrimitiveRegistry();
  readonly composeAdapters = new ComposeRegistry();
  readonly runner: JobRunner;
  readonly workspaceRoot: string;
  private readonly masters: MasterStore;
  private readonly binders: BinderStore;
  private readonly answerSets: AnswerSetStore;
  private readonly mappings: MappingStore;
  private readonly jobs: JobStore;
  private readonly instances: InstanceStore;
  private readonly manifests: ManifestStore;
  private readonly artifacts: ArtifactStore;
  private readonly analyzing = new Set<string>();
  private readonly bus = documentStudioEventBus;
  private logger = getLogger();

  constructor(readonly options: DocumentStudioServiceOptions) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.masters = new MasterStore(options.pool);
    this.binders = new BinderStore(options.pool);
    this.answerSets = new AnswerSetStore(options.pool);
    this.mappings = new MappingStore(options.pool);
    this.jobs = new JobStore(options.pool);
    this.instances = new InstanceStore(options.pool);
    this.manifests = new ManifestStore(options.pool);
    this.artifacts = new ArtifactStore(options.pool);
    this.registerAdapters();
    this.registerPrimitives();
    this.runner = new JobRunner(this.primitives, this, {
      onStatus: (job) => this.emitJobProgress(job),
      onProgress: (job) => this.emitJobProgress(job),
      onGate: (job, step) => this.emitJobGate(job, step),
    });
  }

  onMasterAnalysis(listener: MasterAnalysisListener): () => void {
    return this.bus.on('master.analysis', (payload) => listener(payload.master));
  }

  private emitMasterAnalysis(master: Master | null): void {
    if (!master) return;
    this.bus.emit('master.analysis', { type: 'master.analysis', master, timestamp: new Date().toISOString() });
  }

  private emitJobProgress(job: Job): void {
    this.bus.emit('job.progress', { type: 'job.progress', job, timestamp: new Date().toISOString() });
  }

  private emitJobGate(job: Job, step: JobStep): void {
    const gate = step.op === 'review_gate' ? step.gate : 'interview';
    this.bus.emit('job.gate', { type: 'job.gate', job, gate, timestamp: new Date().toISOString() });
  }

  // ─── Masters (Phase 1) ────────────────────────────────────────────────────

  async listMasters(filter?: { kind?: MasterKind; query?: string }): Promise<Master[]> {
    return this.masters.list(filter);
  }

  async getMaster(id: string): Promise<Master | null> {
    return this.masters.get(id);
  }

  async uploadMaster(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    opts?: { kind?: MasterKind; tags?: string[] },
  ): Promise<Master> {
    const name = filename.trim() || 'master';
    const format = detectMasterFormat(name, mimeType);
    const kind = opts?.kind ?? classifyKind(format, name);
    const attachment = await getAttachmentService().saveFromBuffer(
      'doc-studio',
      name,
      buffer,
      mimeType || 'application/octet-stream',
      'upload',
    );
    const master = await this.masters.insert({
      name,
      kind,
      format,
      mimeType: attachment.mimeType || mimeType,
      storageId: attachment.id,
      checksum: createHash('sha256').update(buffer).digest('hex'),
      tags: opts?.tags,
    });
    void this.analyzeMaster(master.id); // background; state stays honest throughout
    return master;
  }

  /**
   * Register a workspace file as a Document Studio master from its file path.
   * Reads the file from disk, delegates to uploadMaster. Used by the
   * doc_master_upload tool so the agent can register @file[...] attachments
   * without needing a separate HTTP upload step.
   */
  async uploadMasterFromPath(
    filePath: string,
    opts?: { kind?: MasterKind; tags?: string[] },
  ): Promise<Master> {
    const { readFileSync } = await import('node:fs');
    const { basename, extname } = await import('node:path');
    const buffer = readFileSync(filePath);
    const name = basename(filePath);
    const ext = extname(name).toLowerCase();
    const mimeType = ext === '.pdf' ? 'application/pdf'
      : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : ext === '.pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      : ext === '.csv' ? 'text/csv'
      : ext === '.md' ? 'text/markdown'
      : ext === '.html' ? 'text/html'
      : ext === '.json' ? 'application/json'
      : ext === '.yaml' || ext === '.yml' ? 'application/x-yaml'
      : 'application/octet-stream';
    return this.uploadMaster(buffer, name, mimeType, opts);
  }

  async updateMaster(
    id: string,
    patch: { name?: string; kind?: MasterKind; tags?: string[] },
  ): Promise<Master | null> {
    const updated = await this.masters.update(id, patch);
    // Kind override invalidates prior analysis (kind-specific analyzers).
    if (updated && patch.kind) {
      await this.masters.update(id, { analysis: null, analysisState: 'pending', analysisError: null });
      void this.analyzeMaster(id);
      return this.masters.get(id);
    }
    return updated;
  }

  async deleteMaster(id: string): Promise<boolean> {
    const existing = await this.masters.get(id);
    if (!existing) return false;
    const ok = await this.masters.delete(id);
    if (ok) {
      try { await getAttachmentService().deleteAttachment(existing.storageId); } catch { /* best-effort */ }
    }
    return ok;
  }

  /** Run kind-specific analysis with honest state transitions (spec §6.1). */
  async analyzeMaster(id: string): Promise<Master | null> {
    if (this.analyzing.has(id)) return this.masters.get(id);
    this.analyzing.add(id);
    try {
      const existing = await this.masters.get(id);
      if (!existing) return null;
      await this.masters.update(id, { analysisState: 'analyzing', analysisError: null });

      const buffer = await getAttachmentService().getBuffer(existing.storageId);
      if (!buffer) {
        const failed = await this.masters.update(id, {
          analysisState: 'failed',
          analysisError: 'Master file missing from storage',
        });
        this.emitMasterAnalysis(failed);
        return failed;
      }

      const outcome = await analyzeMasterBuffer(buffer, existing.kind, existing.format, existing.name);
      const updated = await this.masters.update(id, {
        analysis: outcome.analysis,
        analysisState: outcome.state,
        analysisError: outcome.error ?? null,
      });
      this.emitMasterAnalysis(updated);
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('DOC_STUDIO', `Master analysis failed for ${id}: ${message}`);
      const failed = await this.masters.update(id, { analysisState: 'failed', analysisError: message });
      this.emitMasterAnalysis(failed);
      return failed;
    } finally {
      this.analyzing.delete(id);
    }
  }

  async getMasterBuffer(id: string): Promise<Buffer | null> {
    const master = await this.masters.get(id);
    if (!master) return null;
    return getAttachmentService().getBuffer(master.storageId);
  }

  // ─── Binders (Phase 2) ─────────────────────────────────────────────────────

  async listBinders(query?: string): Promise<Binder[]> {
    return this.binders.list(query);
  }

  async getBinder(id: string): Promise<Binder | null> {
    const binder = await this.binders.get(id);
    if (!binder) return null;
    return this.resolveBinder(binder);
  }

  async createBinder(input: { name: string; description?: string; slots?: BinderSlot[] }): Promise<Binder> {
    return this.binders.insert(input);
  }

  async updateBinder(id: string, patch: { name?: string; description?: string; slots?: BinderSlot[] }): Promise<Binder | null> {
    const updated = await this.binders.update(id, patch);
    if (!updated) return null;
    return this.resolveBinder(updated);
  }

  async deleteBinder(id: string): Promise<boolean> {
    return this.binders.delete(id);
  }

  /**
   * Resolve a binder's slots: substitute answerSet/mapping ids with current
   * values so the UI/agent always sees material truth (I10).
   */
  private async resolveBinder(binder: Binder): Promise<Binder> {
    const resolved: BinderSlot[] = [];
    for (const slot of binder.slots) {
      if (slot.role === 'answers' && slot.answerSetId) {
        const as = await this.answerSets.get(slot.answerSetId);
        resolved.push({ ...slot, answerSetId: as?.id ?? slot.answerSetId });
      } else if (slot.role === 'mapping' && slot.mappingId) {
        const mp = await this.mappings.get(slot.mappingId);
        resolved.push({ ...slot, mappingId: mp?.id ?? slot.mappingId });
      } else {
        resolved.push(slot);
      }
    }
    return { ...binder, slots: resolved };
  }

  // ─── Answer sets (Phase 2) ─────────────────────────────────────────────────

  async createAnswerSet(values: Record<string, unknown> = {}): Promise<AnswerSet> {
    return this.answerSets.create(values);
  }

  async getAnswerSet(id: string): Promise<AnswerSet | null> {
    return this.answerSets.get(id);
  }

  async updateAnswerSet(id: string, patch: { values?: Record<string, unknown> }): Promise<AnswerSet | null> {
    return this.answerSets.update(id, patch);
  }

  // ─── Mappings (Phase 2) ────────────────────────────────────────────────────

  async createMapping(input: { dataMasterId: string; schemaRef: string; entries?: MappingEntry[]; confirmed?: boolean }): Promise<Mapping> {
    return this.mappings.insert({ ...input, confirmed: input.confirmed ?? false });
  }

  async getMapping(id: string): Promise<Mapping | null> {
    return this.mappings.get(id);
  }

  async updateMapping(id: string, patch: { entries?: MappingEntry[]; confirmed?: boolean }): Promise<Mapping | null> {
    return this.mappings.update(id, patch);
  }

  /**
   * Propose a column-to-variable mapping from a data master to a layout master
   * schema (spec §5.9). Uses deterministic name normalization, not LLM guesses.
   */
  async proposeMapping(dataMasterId: string, schemaRef: string): Promise<Mapping> {
    const data = await this.masters.get(dataMasterId);
    const layout = await this.masters.get(schemaRef);
    if (!data) throw new Error(`Data master ${dataMasterId} not found`);
    if (!layout) throw new Error(`Schema master ${schemaRef} not found`);

    const columns = data.analysis?.dataProfile?.columns ?? [];
    const variables = layout.analysis?.variables ?? [];
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    const entries: MappingEntry[] = [];
    for (const col of columns) {
      const target = variables.find((v) => normalize(v.key) === normalize(col.name) || normalize(v.label) === normalize(col.name));
      entries.push({ column: col.name, variableKey: target?.key ?? '', confidence: target ? 1.0 : 0.0 });
    }
    const mapping = await this.mappings.insert({ dataMasterId, schemaRef, entries, confirmed: false });
    const validation = validateMapping(mapping, data, layout);
    return { ...mapping, coercionPreview: validation.coercionPreview, validationWarnings: validation.warnings };
  }

  // ─── KB selector preview (Phase 2) ─────────────────────────────────────────

  async previewKbSelector(selector: KbSelector, topK = 5): Promise<{ count: number; samples: unknown[]; warning?: string }> {
    const kb = getKnowledgeBaseService();
    if (!kb) throw new Error('Knowledge base unavailable');
    const hits: Array<{ id: string; content: string; sourceId: string; sourceName: string }> = [];
    if (selector.mode === 'ids') {
      for (const sourceId of selector.sourceIds) {
        const found = await kb.search('*', topK, sourceId);
        hits.push(...found);
      }
    } else if (selector.mode === 'prefix') {
      const ids = await kb.listSources().then((list) => list.filter((s) => s.name.startsWith(selector.prefix)).map((s) => s.id));
      for (const sourceId of ids.slice(0, 10)) {
        const found = await kb.search('*', topK, sourceId);
        hits.push(...found);
      }
    } else if (selector.mode === 'query') {
      const sourceIds = selector.sourceIds;
      hits.push(...await kb.search(selector.text, selector.topK ?? topK, sourceIds?.[0]));
    } else if (selector.mode === 'collection') {
      const { ids, supported } = await this.collectionSources(kb, selector.collectionId);
      if (!supported) {
        return { count: 0, samples: [], warning: `COLLECTION_NOT_SUPPORTED: no collection catalog for "${selector.collectionId}"; falling back to metadata collection field` };
      }
      for (const sourceId of ids.slice(0, 10)) {
        const found = await kb.search('*', topK, sourceId);
        hits.push(...found);
      }
    } else if (selector.mode === 'tags') {
      const { ids, supported } = await this.taggedSourceIds(kb, selector.tags, selector.match);
      if (!supported) {
        return { count: 0, samples: [], warning: `TAGS_NOT_SUPPORTED: source tags are not exposed by the current KB API` };
      }
      for (const sourceId of ids.slice(0, 10)) {
        const found = await kb.search('*', topK, sourceId);
        hits.push(...found);
      }
    }
    const dedup = [...new Map(hits.map((h) => [h.id, h])).values()];
    return {
      count: dedup.length,
      samples: dedup.slice(0, topK).map((h) => ({ id: h.id, sourceName: h.sourceName, content: h.content.slice(0, 250) })),
    };
  }

  private async collectionSources(kb: KnowledgeBaseService, collectionId: string): Promise<{ ids: string[]; supported: boolean }> {
    // No dedicated collection catalog/table yet; fall back to source metadata.
    const sources = await kb.listSources();
    const withCollection = sources.filter((s) => (s as any).metadata?.collection != null);
    const ids = withCollection.filter((s) => (s as any).metadata.collection === collectionId).map((s) => s.id);
    return { ids, supported: withCollection.length > 0 };
  }

  private async taggedSourceIds(kb: KnowledgeBaseService, tags: string[], match: 'all' | 'any'): Promise<{ ids: string[]; supported: boolean }> {
    const sources = await kb.listSources();
    const withTags = sources.filter((s) => Array.isArray((s as any).metadata?.tags));
    const ids = withTags
      .filter((s) => {
        const sourceTags = (s as any).metadata.tags as unknown[];
        const present = new Set(sourceTags.map((t) => String(t)));
        if (match === 'all') return tags.every((t) => present.has(t));
        return tags.some((t) => present.has(t));
      })
      .map((s) => s.id);
    return { ids, supported: withTags.length > 0 };
  }

  // ─── Compose adapters (Phase 3) ────────────────────────────────────────────

  private registerAdapters(): void {
    this.composeAdapters.register({ style: 'fill_clone', formats: ['docx', 'xlsx', 'pdf'], compose: (input) => composeFillClone({ ...input, workspaceRoot: this.workspaceRoot }) });
    this.composeAdapters.register({ style: 'markdown', formats: ['md'], compose: composeMarkdown });
    this.composeAdapters.register({ style: 'html', formats: ['html'], compose: composeHtml });
    this.composeAdapters.register({ style: 'json', formats: ['json'], compose: composeJson });
    this.composeAdapters.register({ style: 'yaml', formats: ['yaml'], compose: composeYaml });
    this.composeAdapters.register({ style: 'diagram', formats: ['mmd'], compose: composeDiagram });
    this.composeAdapters.register({ style: 'latex', formats: ['tex'], compose: composeLatex });
    this.composeAdapters.register({ style: 'author', formats: ['md'], compose: composeAuthor });
    this.composeAdapters.register({ style: 'assemble', formats: ['md'], compose: composeAssemble });
    this.composeAdapters.register({ style: 'merge_pack', formats: ['md'], compose: composeMergePack });
    this.composeAdapters.register({ style: 'transform', formats: ['md', 'html', 'other'], compose: composeTransform });
  }

  // ─── Primitives (Phase 3) ──────────────────────────────────────────────────

  private registerPrimitives(): void {
    this.primitives.register('analyze', (step, ctx) => this.primitiveAnalyze(step, ctx));
    this.primitives.register('interview', (step, ctx) => this.primitiveInterview(step, ctx));
    this.primitives.register('compose', (step, ctx) => this.primitiveCompose(step, ctx));
    this.primitives.register('deliver', (step, ctx) => this.primitiveDeliver(step, ctx));
    this.primitives.register('plan_instances', () => Promise.resolve({ ok: true, outputs: { instances: [{ index: 0, path: '', masterId: '', status: 'planned' }] } }));
    this.primitives.register('derive', () => Promise.resolve({ ok: true }));
    this.primitives.register('validate', () => Promise.resolve({ ok: true }));
    this.primitives.register('review_gate', () => Promise.resolve({ ok: true }));
    this.primitives.register('select_evidence', () => Promise.resolve({ ok: true }));
    this.primitives.register('extract_facts', () => Promise.resolve({ ok: true }));
    this.primitives.register('map_schema', () => Promise.resolve({ ok: true }));
  }

  async executePrimitive(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    const cp = (ctx as Record<string, unknown>)['__checkpoint'] as
      | { stepIndex: number; total: number; stepResults: Record<string, unknown>; spec: JobSpec }
      | undefined;

    if (cp) {
      await this.jobs.update(ctx.jobId, {
        status: 'running',
        progress: { done: cp.stepIndex, total: cp.total },
        spec: cp.spec,
        stepResults: cp.stepResults,
      }).catch(() => undefined);
    }

    let result: PrimitiveResult;
    switch (step.op) {
      case 'analyze': result = await this.primitiveAnalyze(step, ctx); break;
      case 'interview': result = await this.primitiveInterview(step, ctx); break;
      case 'compose': result = await this.primitiveCompose(step, ctx); break;
      case 'deliver': result = await this.primitiveDeliver(step, ctx); break;
      case 'plan_instances': result = await this.primitivePlanInstances(step, ctx); break;
      case 'derive': result = await this.primitiveDerive(step, ctx); break;
      case 'validate': result = await this.primitiveValidate(step, ctx); break;
      case 'review_gate': result = await this.primitiveReviewGate(step, ctx); break;
      case 'select_evidence': result = await this.primitiveSelectEvidence(step, ctx); break;
      case 'extract_facts': result = await this.primitiveExtractFacts(step, ctx); break;
      case 'map_schema': result = await this.primitiveMapSchema(step, ctx); break;
      default: result = { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Primitive not implemented' } };
    }

    if (cp) {
      cp.stepResults[cp.stepIndex] = JSON.parse(JSON.stringify(result, (_key, value) => (value instanceof Uint8Array ? { byteLength: value.length } : value)));
      let status: Job['status'] = result.ok ? 'running' : 'failed';
      if (!result.ok && result.error?.code === 'AWAITING_INPUT') status = 'awaiting_input';
      if (!result.ok && result.error?.code === 'CANCELLED') status = 'cancelled';
      const after: Partial<Job> = {
        status,
        progress: { done: result.ok ? cp.stepIndex + 1 : cp.stepIndex, total: cp.total, detail: result.error?.message },
        spec: cp.spec,
        stepResults: cp.stepResults,
      };
      const artifacts = result.outputs?.artifacts;
      if (Array.isArray(artifacts)) after.artifacts = artifacts as ArtifactRef[];
      if (result.error && result.error.code !== 'AWAITING_INPUT') after.error = JSON.stringify(result.error);
      await this.jobs.update(ctx.jobId, after).catch(() => undefined);
    }

    return result;
  }

  private async primitiveAnalyze(step: JobStep, _ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'analyze') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not analyze' } };
    const master = await this.masters.get(step.masterId);
    if (!master) return { ok: false, error: { code: 'MASTER_NOT_FOUND', message: `Master ${step.masterId} not found` } };
    let resolved = master;
    if (master.analysisState !== 'ready' && master.analysisState !== 'partial') {
      await this.analyzeMaster(master.id);
      const refreshed = await this.masters.get(master.id);
      if (!refreshed || (refreshed.analysisState !== 'ready' && refreshed.analysisState !== 'partial')) {
        return { ok: false, error: { code: 'ANALYSIS_NOT_READY', message: `Master ${master.id} is ${refreshed?.analysisState ?? 'unknown'}` } };
      }
      resolved = refreshed;
    }
    // Extract prior values from the master's variables (sampleValues) so the
    // derive primitive can reference them as `prior.<key>` in forecast formulas.
    const prior: Record<string, string> = {};
    for (const v of resolved.analysis?.variables ?? []) {
      if (v.sampleValue) prior[v.key] = v.sampleValue;
    }
    return { ok: true, outputs: { master: resolved, prior } };
  }

  private async primitiveInterview(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'interview') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not interview' } };
    const master: Master | undefined = ctx['master'] as Master;
    if (!master) return { ok: false, error: { code: 'NO_MASTER', message: 'interview requires a preceding analyze step' } };
    const variables = master.analysis?.variables ?? [];
    const required = variables.filter((v) => v.required && v.locator);
    if (required.length === 0) return { ok: true, outputs: { answers: {}, unresolved: [] } };
    const answers = (ctx['answers'] as Record<string, unknown> | undefined) ?? {};
    const missing = required.filter((v) => answers[v.key] === undefined || String(answers[v.key]).trim() === '');
    if (missing.length > 0) {
      return {
        ok: false,
        error: { code: 'AWAITING_INPUT', message: `Missing required values: ${missing.map((v) => v.key).join(', ')}. Use doc_job_answer.` },
        outputs: { questions: missing.map((v) => ({ key: v.key, label: v.label, datatype: v.datatype, required: true })) },
      };
    }
    return { ok: true, outputs: { answers, unresolved: [] } };
  }

  private async primitiveCompose(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'compose') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not compose' } };
    const master: Master | undefined = ctx['master'] as Master;
    if (!master) return { ok: false, error: { code: 'NO_MASTER', message: 'compose requires a preceding analyze step' } };

    // Anti-fallback guard: when the job intent signals "replicate" / "exact copy"
    // / "clone", the master's design MUST be cloned via fill_clone — NEVER
    // free-authored. Free-form authoring (compose:author / markdown / html)
    // rebuilds the document from scratch and loses the original layout, which is
    // the exact failure this guard prevents. If fill_clone can't proceed (wrong
    // style or no locators), throw a HARD error naming the missing locators
    // instead of silently degrading to authoring.
    const intent = typeof ctx['intent'] === 'string' ? (ctx['intent'] as string).toLowerCase() : '';
    const isReplicateIntent = /\b(replicate|exact copy|clone|same design|same layout|copy with|duplicate with|recreate)\b/.test(intent);
    if (isReplicateIntent && (master.format === 'pdf' || master.format === 'docx' || master.format === 'xlsx')) {
      if (step.style !== 'fill_clone') {
        return {
          ok: false,
          error: {
            code: 'REPLICATE_REQUIRES_FILL_CLONE',
            message: `Intent "${ctx['intent']}" requires compose:fill_clone to preserve the original design, but step style is "${step.style}". Free-form authoring is blocked for replicate/forecast intent. Re-compile the job with the replicate_forecast recipe (r32).`,
          },
        };
      }
      const variables = master.analysis?.variables ?? [];
      const located = variables.filter((v) => v.locator !== null);
      if (located.length === 0) {
        const allKeys = variables.map((v) => v.key).slice(0, 20).join(', ');
        return {
          ok: false,
          error: {
            code: 'NO_LOCATABLE_VARIABLES',
            message: `Replicate/forecast intent requires locatable variables for fill_clone, but master "${master.id}" has 0 variables with locators (out of ${variables.length} total: ${allKeys}). Re-analyze the master to extract grid-cell pdf_region locators, or provide explicit {{placeholder}} tokens.`,
          },
        };
      }
    }
    const instances = (ctx['instances'] as Array<{ index: number; values: Record<string, unknown>; path: string }> | undefined);
    const answers: Record<string, unknown> = (ctx['answers'] as Record<string, unknown> | undefined) ?? {};
    // Merge derived values (from a preceding derive step) into the answer set so
    // they flow into the binding set for fill_clone. Derived values take
    // precedence over answers (they are the computed forecast values).
    const derivedValues = (ctx['derivedValues'] as Record<string, unknown> | undefined) ?? {};
    const mergedAnswers: Record<string, unknown> = { ...answers, ...derivedValues };
    const facts = ctx['facts'] as unknown[] | undefined;
    const valuesList = instances && instances.length > 0 ? instances : [{ index: 0, values: mergedAnswers, path: 'out' }];
    const now = new Date().toISOString();
    const fromInstances = Array.isArray(instances) && instances.length > 0;
    const piiPolicy = ctx.policies.pii;
    const variables = master.analysis?.variables ?? [];
    const limit = ctx.policies.maxInstances ?? 5;

    // Load persisted instance statuses for resume / status tracking.
    const persistedInstances = ctx.jobId ? await this.instances.getByJob(ctx.jobId).catch(() => []) : [];
    const instanceMap = new Map(persistedInstances.map((inst) => [inst.index, inst]));

    const outputs: { bytes: Uint8Array; format: string; path: string; index: number }[] = [];
    const errors: string[] = [];

    class Semaphore {
      private queue: Array<() => void> = [];
      constructor(private count: number) {}
      async acquire(): Promise<void> {
        if (this.count > 0) { this.count--; return; }
        await new Promise<void>((resolve) => this.queue.push(resolve));
      }
      release(): void {
        const next = this.queue.shift();
        if (next) next(); else this.count++;
      }
    }
    const sem = new Semaphore(limit);
    const signal = ctx.signal;

    const processItem = async (item: { index: number; values: Record<string, unknown>; path: string }) => {
      const instance = instanceMap.get(item.index);
      if (instance && (instance.status === 'completed' || instance.status === 'delivered' || instance.status === 'composed')) {
        return;
      }
      if (signal?.aborted) {
        errors.push('cancelled');
        return;
      }
      if (instance) {
        await this.instances.updateStatus(instance.id, 'pending').catch(() => undefined);
      }
      await sem.acquire();
      if (signal?.aborted) {
        sem.release();
        errors.push('cancelled');
        return;
      }
      if (instance) {
        await this.instances.updateStatus(instance.id, 'running').catch(() => undefined);
      }
      try {
        const origin: ProvenanceOrigin = fromInstances ? 'dataset' : 'user';
        const provenance: Record<string, { origin: ProvenanceOrigin; ref?: string; at: string }> = {};
        const safeValues: Record<string, unknown> = { ...item.values };
        for (const key of Object.keys(item.values)) {
          const variable = variables.find((v) => v.key === key);
          const sensitivity = variable?.sensitivity;
          if (sensitivity && sensitivity !== 'none') {
            if (piiPolicy === 'refuse_export') {
              throw new Error(`Sensitive value '${key}' (${sensitivity}) refused by pii policy`);
            }
            if (piiPolicy === 'vault') {
              safeValues[key] = '[VAULTED]';
            }
          }
          provenance[key] = { origin, ref: fromInstances ? String(item.index) : undefined, at: now };
        }
        const bindingSet = { id: 'bs-' + master.id + '-' + item.index, schemaRef: master.id, values: safeValues, provenance, unresolved: [], errors: [] };
        let output;
        if (step.style === 'fill_clone') {
          if (!supportsFillClone(master)) throw new Error(`fill_clone not supported for ${master.format}`);
          output = await this.composeAdapters.find('fill_clone', master.format)!.compose({ master, bindingSet, policies: ctx.policies });
        } else {
          const adapter = this.composeAdapters.findByStyle(step.style);
          if (!adapter) throw new Error(`compose style ${step.style} not registered`);
          output = await adapter.compose({ master, bindingSet, facts, transformOp: step.transformOp, adapterHints: step.adapterHints, policies: ctx.policies });
        }
        outputs.push({ bytes: output.bytes, format: output.format, path: item.path, index: item.index });
        if (instance) {
          await this.instances.updateStatus(instance.id, 'completed').catch(() => undefined);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (instance) {
          await this.instances.updateStatus(instance.id, 'failed', message).catch(() => undefined);
        }
        errors.push(message);
        if (message.toLowerCase().includes('cancel')) {
          return;
        }
      } finally {
        sem.release();
      }
    };

    await Promise.all(valuesList.map((item) => processItem(item)));

    if (errors.length > 0) {
      if (ctx.policies.partialBatch === 'fail_job' || errors.length === valuesList.length) {
        return { ok: false, error: { code: 'COMPOSE_FAILED', message: errors.join('; ') } };
      }
      return { ok: true, outputs: { outputs }, warnings: errors };
    }

    if (outputs.length === 1) return { ok: true, outputs: { bytes: outputs[0]!.bytes, format: outputs[0]!.format, index: outputs[0]!.index } };
    return { ok: true, outputs: { outputs } };
  }

  private async primitiveDeliver(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'deliver') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not deliver' } };
    const ctxOutputs = (ctx['outputs'] as { bytes: Uint8Array; format: string; path: string; index?: number }[] | undefined);
    const singleBytes = ctx['bytes'] as Uint8Array | undefined;
    const singleFormat = ctx['format'] as string | undefined;
    const items = ctxOutputs ?? (singleBytes && singleFormat ? [{ bytes: singleBytes, format: singleFormat, path: '', index: 0 }] : []);
    if (items.length === 0) return { ok: false, error: { code: 'NOTHING_TO_DELIVER', message: 'deliver requires bytes from compose' } };

    const target = step.target;
    const overwrite = ctx.policies.overwrite ?? 'fail';
    const artifacts: Artifact[] = [];
    const manifestRows: ManifestRow[] = [];

    const persistedInstances = ctx.jobId ? await this.instances.getByJob(ctx.jobId).catch(() => []) : [];
    const instanceMap = new Map(persistedInstances.map((inst) => [inst.index, inst]));

    const writeArtifact = async (relPath: string, bytes: Uint8Array, format: string, instanceIndex?: number): Promise<void> => {
      const fullPath = join(this.workspaceRoot, relPath);
      await mkdir(dirname(fullPath), { recursive: true });
      const finalRelPath = await this.resolveCollision(relPath, fullPath, overwrite);
      const finalFullPath = join(this.workspaceRoot, finalRelPath);
      await writeFile(finalFullPath, Buffer.from(bytes));
      const storage = await getAttachmentService().saveFromBuffer('doc-studio', finalRelPath, Buffer.from(bytes), 'application/octet-stream', 'tool');
      const artifact = await this.artifacts.create({
        jobId: ctx.jobId,
        path: finalRelPath,
        storageId: storage.id,
        format,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        instanceIndex,
      });
      artifacts.push(artifact);
      manifestRows.push({ index: manifestRows.length, path: finalRelPath, status: 'ok', artifactId: artifact.id });
      if (instanceIndex !== undefined) {
        const inst = instanceMap.get(instanceIndex);
        if (inst) await this.instances.updateStatus(inst.id, 'delivered').catch(() => undefined);
      }
      this.bus.emit('artifact.ready', { type: 'artifact.ready', artifact, jobId: ctx.jobId, timestamp: new Date().toISOString() });
    }

    if (target.kind === 'single' || target.kind === 'tree' || target.kind === 'hold_for_release') {
      const base = target.kind === 'hold_for_release' ? join('_hold', target.releaseTo) : (target.kind === 'tree' ? (target as { base?: string }).base ?? '' : '');
      for (const item of items) {
        const relPath = target.kind === 'single' ? target.path : join(base, item.path || 'out');
        await writeArtifact(relPath, item.bytes, item.format, item.index);
      }
    } else if (target.kind === 'zip' || target.kind === 'dual') {
      const zip = new JSZip();
      for (const item of items) {
        const name = item.path ? basename(item.path) : `artifact-${manifestRows.length}.${item.format}`;
        zip.file(name, item.bytes);
      }
      const zipPath = target.kind === 'zip' ? target.path : (target as { zip: { path: string } }).zip.path;
      const zipBuffer = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;
      await writeArtifact(zipPath, new Uint8Array(zipBuffer), 'zip');
      if (target.kind === 'dual') {
        const treeBase = (target as { tree: { base: string } }).tree.base;
        for (const item of items) {
          const relPath = join(treeBase, item.path || 'out');
          await writeArtifact(relPath, item.bytes, item.format, item.index);
        }
      }
    } else {
      return { ok: false, error: { code: 'DELIVERY_TARGET_UNKNOWN', message: `Unknown delivery target kind: ${(target as { kind?: string }).kind}` } };
    }

    const ok = manifestRows.filter((r) => r.status === 'ok').length;
    const failed = manifestRows.filter((r) => r.status === 'failed').length;
    const skipped = manifestRows.filter((r) => r.status === 'skipped').length;
    const manifest = await this.manifests.create(ctx.jobId, manifestRows, { ok, failed, skipped });
    await this.jobs.update(ctx.jobId, { manifestId: manifest.id });
    return { ok: true, outputs: { artifacts, artifact: artifacts[0], manifest } };
  }

  /**
   * Apply a workspace naming template. Supported tokens: `{{key}}` for any value
   * in the supplied map, and `{{index}}` for the row index. Only `{{index}}`
   * was previously supported; this implements the DSL described in §11.
   */
  private applyNamingTemplate(template: string, values: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key: string) => {
      const value = values[key];
      return value == null ? '' : String(value);
    });
  }

  /** Resolve a workspace path collision according to the configured overwrite policy. */
  private async resolveCollision(relPath: string, fullPath: string, overwrite: 'fail' | 'version' | 'replace'): Promise<string> {
    try {
      await stat(fullPath);
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === 'ENOENT') return relPath;
      throw err;
    }
    switch (overwrite) {
      case 'replace':
        return relPath;
      case 'version': {
        const ext = extname(relPath);
        const stem = relPath.slice(0, -ext.length) || relPath;
        let n = 1;
        while (true) {
          const candidate = `${stem}-${n}${ext}`;
          try {
            await stat(join(this.workspaceRoot, candidate));
            n++;
          } catch (err) {
            const e = err as { code?: string };
            if (e.code === 'ENOENT') return candidate;
            throw err;
          }
        }
      }
      case 'fail':
      default:
        throw new Error(`Path already exists and overwrite policy is 'fail': ${relPath}`);
    }
  }

  // ─── Phase 5/6 primitives ──────────────────────────────────────────────────

  private async primitiveMapSchema(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'map_schema') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not map_schema' } };
    const extras = step as unknown as { dataMasterId?: string; layoutMasterId?: string };
    const mappingId = step.mappingId ?? (ctx['mappingId'] as string | undefined);
    const dataMaster = extras.dataMasterId ? await this.masters.get(extras.dataMasterId) : undefined;
    const layoutMaster = extras.layoutMasterId ? await this.masters.get(extras.layoutMasterId) : (ctx['master'] as Master | undefined);
    let mapping = mappingId ? await this.mappings.get(mappingId) : null;
    if (!mapping && dataMaster && layoutMaster) {
      mapping = await this.proposeMapping(dataMaster.id, layoutMaster.id);
    }
    if (!mapping) return { ok: false, error: { code: 'NO_MAPPING', message: 'No mapping available for map_schema' } };

    const resolvedDataMaster = dataMaster ?? (await this.masters.get(mapping.dataMasterId));
    const resolvedLayoutMaster = layoutMaster ?? (await this.masters.get(mapping.schemaRef));
    if (!resolvedDataMaster || !resolvedLayoutMaster) {
      return { ok: false, error: { code: 'MASTER_NOT_FOUND', message: 'Data or layout master for mapping not found' } };
    }

    const values = (ctx['values'] as Record<string, unknown> | undefined) ?? {};
    const mapped: Record<string, unknown> = { ...values };
    for (const e of mapping.entries) {
      if (e.variableKey && values[e.column] !== undefined) mapped[e.variableKey] = values[e.column];
    }
    const validation = validateMapping(mapping, resolvedDataMaster, resolvedLayoutMaster);
    return { ok: mapping.confirmed, outputs: { mappedValues: mapped, mappingId: mapping.id, mapping, dataMaster: resolvedDataMaster, layoutMaster: resolvedLayoutMaster, coercionPreview: validation.coercionPreview, validationWarnings: validation.warnings }, error: mapping.confirmed ? undefined : { code: 'AWAITING_INPUT', message: 'Mapping not confirmed; use doc_mapping_set to confirm.' } };
  }

  private async primitivePlanInstances(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'plan_instances') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not plan_instances' } };
    const extras = step as unknown as { dataMasterId?: string; layoutMasterId?: string };
    const dataMaster = extras.dataMasterId ? await this.masters.get(extras.dataMasterId) : (ctx['dataMaster'] as Master | undefined);
    const layoutMaster = extras.layoutMasterId ? await this.masters.get(extras.layoutMasterId) : (ctx['master'] as Master | undefined);
    const mapping = (ctx['mapping'] as Mapping | undefined) ?? null;
    if (!dataMaster) return { ok: false, error: { code: 'NO_DATA_MASTER', message: 'plan_instances requires a data master' } };
    const buffer = await getAttachmentService().getBuffer(dataMaster.storageId);
    if (!buffer) return { ok: false, error: { code: 'MASTER_MISSING', message: 'Data master file missing' } };
    const rows = parseCsv(buffer.toString());
    const header = rows[0] ?? [];
    const body = rows.slice(1);
    const columns = header.map((h, i) => profileColumn(h, body.map((r) => r[i] ?? '')));
    const sensitiveColumns = columns.filter((c) => c.sensitivity === 'pii' || c.sensitivity === 'financial');
    const looksLikePayroll = body.length >= 10 && sensitiveColumns.length >= 2;
    const piiPolicy = ctx.policies?.pii ?? 'allow';
    if (looksLikePayroll && piiPolicy === 'refuse_export') {
      return { ok: false, error: { code: 'PII_REFUSED', message: 'Data master appears to contain PII/payroll data; export refused by pii policy.' } };
    }
    const piiWarning = looksLikePayroll && (piiPolicy === 'allow' || piiPolicy == null)
      ? `Data master looks like a payroll/person table (${sensitiveColumns.length} sensitive columns, ${body.length} rows). Review PII policy.`
      : undefined;

    const buildValues = (row: string[]): Record<string, unknown> => {
      const values: Record<string, unknown> = {};
      for (let c = 0; c < header.length; c++) values[header[c]!] = row[c];
      if (mapping) for (const e of mapping.entries) if (e.variableKey && values[e.column] !== undefined) values[e.variableKey] = values[e.column];
      return values;
    };

    const resolveMasterId = (values: Record<string, unknown>): string | undefined => {
      for (const rule of step.masterRules ?? []) {
        if (rule.predicate) {
          try { if (safeEvaluateBusinessRule(rule.predicate, values)) return rule.masterId; } catch { /* continue */ }
        } else if (rule.when) {
          const value = values[rule.when.column];
          if (rule.when.equals !== undefined && String(value) === String(rule.when.equals)) return rule.masterId;
          if (rule.when.matches) {
            try { if (new RegExp(rule.when.matches).test(String(value))) return rule.masterId; } catch { /* continue */ }
          }
        }
      }
      return layoutMaster?.id;
    };

    const isIncluded = async (rowIndex: number, values: Record<string, unknown>): Promise<{ included: boolean; reason?: string }> => {
      const filter = step.filter;
      if (!filter || filter.kind === 'all') return { included: true };
      if (filter.kind === 'predicate') {
        try { return { included: safeEvaluateBusinessRule(filter.expression, values) }; } catch (err) { return { included: false, reason: `Filter error: ${err instanceof Error ? err.message : String(err)}` }; }
      }
      if (filter.kind === 'exclude_predicate') {
        try { return { included: !safeEvaluateBusinessRule(filter.expression, values) }; } catch (err) { return { included: false, reason: `Filter error: ${err instanceof Error ? err.message : String(err)}` }; }
      }
      if (filter.kind === 'failures_only') {
        const manifest = await this.manifests.get(filter.manifestId).catch(() => null);
        if (!manifest) return { included: true, reason: `failures_only manifest ${filter.manifestId} not found` };
        const failed = new Set(manifest.rows.filter((r) => r.status === 'failed').map((r) => r.index));
        return { included: failed.has(rowIndex) };
      }
      return { included: true };
    };

    const candidateRows: Array<{ originalIndex: number; values: Record<string, unknown>; masterId: string | undefined }> = [];
    for (let i = 0; i < body.length; i++) {
      const row = body[i]!;
      const values = buildValues(row);
      const { included, reason } = await isIncluded(i, values);
      if (!included) {
        await this.instances.create(ctx.jobId, i, { status: 'filtered', error: reason ?? 'Filtered by instance filter' });
        continue;
      }
      candidateRows.push({ originalIndex: i, values, masterId: resolveMasterId(values) });
    }

    const instances = [];
    if (step.grouping && step.grouping.length > 0) {
      const groups = new Map<string, Array<{ originalIndex: number; values: Record<string, unknown>; masterId: string | undefined }>>();
      for (const inst of candidateRows) {
        const groupKey = JSON.stringify(step.grouping.map((g) => inst.values[g.key]));
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey)!.push(inst);
      }
      let groupIdx = 0;
      for (const [, members] of groups) {
        const first = members[0]!;
        const groupValues: Record<string, unknown> = { ...first.values };
        for (const g of step.grouping) groupValues[g.as ?? g.key] = first.values[g.key];
        const path = this.applyNamingTemplate(step.naming ?? '{{index}}', { index: groupIdx, ...groupValues });
        await this.instances.create(ctx.jobId, groupIdx, { path, masterId: first.masterId, status: 'grouped' });
        instances.push({ index: groupIdx, values: groupValues, masterId: first.masterId, path });
        groupIdx++;
      }
    } else {
      for (const inst of candidateRows) {
        const path = this.applyNamingTemplate(step.naming ?? '{{index}}', { index: inst.originalIndex, ...inst.values });
        await this.instances.create(ctx.jobId, inst.originalIndex, { path, masterId: inst.masterId, status: 'planned' });
        instances.push({ index: inst.originalIndex, values: inst.values, masterId: inst.masterId, path });
      }
    }

    const outputs: Record<string, unknown> = { instances, instanceCount: instances.length };
    if (piiWarning) outputs.piiWarning = piiWarning;
    return { ok: true, outputs };
  }

  private async primitiveDerive(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'derive') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not derive' } };
    const values = (ctx['mappedValues'] as Record<string, unknown> | undefined) ?? (ctx['answers'] as Record<string, unknown> | undefined) ?? {};
    const derived: Record<string, unknown> = { ...values };

    const prior = ctx['prior'] as Record<string, unknown> | undefined;
    const index = Number(ctx['index'] ?? 0);
    const tableCache: Record<string, unknown[]> = {};

    const resolveTable = async (tableId: string): Promise<unknown[]> => {
      const master = await this.masters.get(tableId);
      if (master && (master.kind === 'data' || master.format === 'csv')) {
        const buffer = await getAttachmentService().getBuffer(master.storageId);
        if (buffer) return parseCsv(buffer.toString('utf8'));
      }
      const mapping = await this.mappings.get(tableId);
      if (mapping?.dataMasterId) {
        const dataMaster = await this.masters.get(mapping.dataMasterId);
        if (dataMaster) {
          const buffer = await getAttachmentService().getBuffer(dataMaster.storageId);
          if (buffer) return parseCsv(buffer.toString('utf8'));
        }
      }
      return [];
    };

    const findInRows = (key: unknown, rows: unknown[]): unknown => {
      const target = String(key);
      for (const row of rows) {
        if (Array.isArray(row)) {
          if (String(row[0]) === target) return row[1] ?? row;
        } else if (row !== null && typeof row === 'object') {
          const obj = row as Record<string, unknown>;
          if (String(obj['key']) === target) return obj['value'] ?? obj;
        }
      }
      return undefined;
    };

    const lookup = (key: unknown, table: unknown): unknown => {
      let rows: unknown[] | undefined;
      if (typeof table === 'string') rows = tableCache[table];
      else if (Array.isArray(table)) rows = table;
      if (!rows) return undefined;
      return findInRows(key, rows);
    };

    const counter = (start: unknown = 0, step: unknown = 1): number => Number(start) + index * Number(step);
    const next = (_key?: unknown): number => index + 1;

    const toDate = (d: unknown): Date => {
      if (d instanceof Date) return new Date(d.getTime());
      if (typeof d === 'string' || typeof d === 'number') {
        const parsed = new Date(d);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
      return new Date(NaN);
    };

    const dateAdd = (date: unknown, amount: unknown, unit: unknown): Date | undefined => {
      const d = toDate(date);
      if (Number.isNaN(d.getTime())) return undefined;
      const n = Number(amount) || 0;
      const u = String(unit).toLowerCase();
      if (u === 'day' || u === 'days') d.setDate(d.getDate() + n);
      else if (u === 'month' || u === 'months') d.setMonth(d.getMonth() + n);
      else if (u === 'year' || u === 'years') d.setFullYear(d.getFullYear() + n);
      return d;
    };

    const dateDiff = (a: unknown, b: unknown, unit: unknown): number => {
      const da = toDate(a);
      const db = toDate(b);
      if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return NaN;
      const u = String(unit).toLowerCase();
      if (u === 'day' || u === 'days') return Math.floor((da.getTime() - db.getTime()) / (1000 * 60 * 60 * 24));
      if (u === 'month' || u === 'months') return (da.getFullYear() * 12 + da.getMonth()) - (db.getFullYear() * 12 + db.getMonth());
      if (u === 'year' || u === 'years') return da.getFullYear() - db.getFullYear();
      return NaN;
    };

    function* extractLookups(formula: string) {
      let cursor = 0;
      while (cursor < formula.length) {
        const start = formula.indexOf('lookup', cursor);
        if (start === -1) break;
        const paren = formula.indexOf('(', start + 6);
        if (paren === -1) break;
        if (formula.slice(start + 6, paren).trim() !== '') { cursor = start + 6; continue; }
        let depth = 1;
        let comma = -1;
        let end = -1;
        for (let j = paren + 1; j < formula.length; j++) {
          const ch = formula[j];
          if (ch === '(') depth++;
          else if (ch === ')') {
            depth--;
            if (depth === 0) { end = j; break; }
          } else if (ch === ',' && depth === 1 && comma === -1) comma = j;
        }
        if (comma === -1 || end === -1) break;
        yield { keyExpr: formula.slice(paren + 1, comma).trim(), tableExpr: formula.slice(comma + 1, end).trim() };
        cursor = end + 1;
      }
    }

    for (const rule of step.rules) {
      for (const { tableExpr } of extractLookups(rule.formula)) {
        let tableId: string | undefined;
        const litMatch = tableExpr.match(/^(['"])(.*)\1$/);
        if (litMatch) {
          tableId = litMatch[2];
        } else if (/^[a-zA-Z_]\w*$/.test(tableExpr) && typeof values[tableExpr] === 'string') {
          tableId = String(values[tableExpr]);
        }
        if (tableId && !(tableId in tableCache)) {
          tableCache[tableId] = await resolveTable(tableId);
        }
      }
    }

    function evaluateFormula(formula: string, scope: Record<string, unknown>): unknown {
      const code = String(formula).trim();
      const script = new Script(`(function() { 'use strict'; return (${code}); })()`, { filename: 'derive-formula.vm' });
      const sandbox = createContext({ ...scope });
      return script.runInContext(sandbox, { timeout: 500, displayErrors: true });
    }

    for (const rule of step.rules) {
      // Skip placeholder rules (used by the replicate recipe when the agent
      // hasn't supplied real derive rules yet — user provides values directly).
      if (rule.key === '__placeholder__') continue;
      const formula = String(rule.formula ?? '');
      if (!formula.trim()) {
        derived[rule.key] = values[rule.key];
        continue;
      }
      try {
        const scope: Record<string, unknown> = { ...values, prior, lookup, counter, next, dateAdd, dateDiff, Math, Date };
        derived[rule.key] = evaluateFormula(formula, scope);
      } catch {
        derived[rule.key] = values[rule.key];
      }
    }

    return { ok: true, outputs: { derivedValues: derived } };
  }

  private async primitiveValidate(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'validate') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not validate' } };
    const master: Master | undefined = ctx['master'] as Master;
    const values = (ctx['answers'] as Record<string, unknown> | undefined) ?? (ctx['mappedValues'] as Record<string, unknown> | undefined) ?? {};
    const errors: string[] = [];
    const warnings: string[] = [];
    const facts = (ctx['facts'] as unknown[] | undefined) ?? [];
    const evidence = (ctx['evidence'] as unknown[] | undefined) ?? [];
    for (const check of step.checks) {
      switch (check.kind) {
        case 'completeness':
        case 'schema': {
          for (const v of master?.analysis?.variables ?? []) {
            if (v.required && (values[v.key] === undefined || String(values[v.key]).trim() === '')) errors.push(`Missing required value: ${v.key}`);
          }
          for (const v of master?.analysis?.variables ?? []) {
            const val = values[v.key];
            if (val !== undefined && v.datatype === 'number' && Number.isNaN(Number(val))) errors.push(`Expected number for ${v.key}`);
            if (val !== undefined && v.datatype === 'boolean' && typeof val !== 'boolean' && val !== 'true' && val !== 'false') errors.push(`Expected boolean for ${v.key}`);
          }
          break;
        }
        case 'cite_coverage': {
          if (ctx.policies.citations === 'off') break;
          const chunks = gatherDraftChunks(ctx);
          const unsupported = findUnsupportedClaims(chunks, facts, evidence);
          for (const s of unsupported) {
            errors.push(`Uncited claim: ${s.length > 80 ? s.slice(0, 80) + '...' : s}`);
          }
          break;
        }
        case 'guideline_sections': {
          const required = flattenSectionOutlines(master?.analysis?.requiredSections ?? []);
          const headings = gatherDraftHeadings(ctx);
          const matched = new Set<number>();
          for (const r of required) {
            if (!r.title) continue;
            const idx = headings.findIndex((h) => fuzzyTitleMatch(h, r.title));
            if (idx === -1) {
              errors.push(`Missing required section: ${r.title}`);
            } else {
              matched.add(idx);
            }
          }
          if (required.length > 0) {
            for (let i = 0; i < headings.length; i++) {
              if (!matched.has(i)) warnings.push(`Unexpected extra section: ${headings[i]}`);
            }
          }
          break;
        }
        case 'business_rule': {
          const raw = check.spec?.['rule'] ?? (step as any).rules;
          const rules = normalizeBusinessRules(raw);
          for (const r of rules) {
            if (!r.expression) continue;
            try {
              const ok = safeEvaluateBusinessRule(r.expression, values);
              if (!ok) errors.push(r.message ?? `Business rule failed: ${r.expression}`);
            } catch {
              errors.push(`Business rule could not evaluate: ${r.expression}`);
            }
          }
          break;
        }
        case 'cross_doc': {
          const keys = check.spec?.['keys'] as string[] | undefined;
          const instances = (ctx['instances'] as unknown[] | undefined) ?? (ctx['doc_instances'] as unknown[] | undefined);
          if (instances && instances.length > 1) {
            for (const m of compareInstances(instances, keys)) errors.push(m);
          }
          const prior = ctx['priorValues'] as Record<string, unknown> | undefined;
          if (prior && keys) for (const k of keys) if (values[k] !== prior[k]) errors.push(`Cross-doc mismatch on ${k}`);
          break;
        }
      }
    }
    const outputs: Record<string, unknown> = { validationErrors: errors };
    if (warnings.length > 0) outputs.validationWarnings = warnings;
    return { ok: errors.length === 0, outputs, error: errors.length ? { code: 'VALIDATION_FAILED', message: errors.join(', ') } : undefined };
  }

  private async primitiveReviewGate(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'review_gate') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not review_gate' } };
    const gate = step.gate;
    const confirmKeys: Record<string, string> = { mapping: 'mappingConfirmed', dry_run: 'dryRunApproved', section: 'sectionApproved', final: 'confirmed' };
    const key = confirmKeys[gate];
    if (key && !ctx[key]) return { ok: false, error: { code: 'AWAITING_INPUT', message: `${gate} review gate requires ${key}; set it or use doc_job_confirm.` } };
    return { ok: true, outputs: { gate: step.gate, approved: true } };
  }

  private async primitiveSelectEvidence(step: JobStep, _ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'select_evidence') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not select_evidence' } };
    const selector = step.selector;
    try {
      const result = await this.previewKbSelector(selector, 5);
      const outputs: Record<string, unknown> = { evidence: result.samples, evidenceCount: result.count };
      if (result.warning) outputs.warning = result.warning;
      return { ok: true, outputs };
    } catch (err) {
      return { ok: true, outputs: { evidence: [], evidenceCount: 0 } };
    }
  }

  private async primitiveExtractFacts(step: JobStep, ctx: PrimitiveContext): Promise<PrimitiveResult> {
    if (step.op !== 'extract_facts') return { ok: false, error: { code: 'INVALID_ARGS', message: 'not extract_facts' } };
    const evidence = (ctx['evidence'] as unknown[] | undefined) ?? [];
    const items = evidence.map((e, i) => {
      const sample = e as { id?: string; content?: string; sourceName?: string; sourceId?: string; text?: string };
      return {
        id: sample.id ?? `chunk-${i}`,
        content: sample.content ?? sample.text ?? String(e),
        source: sample.sourceName ?? sample.sourceId ?? 'kb',
      };
    });
    if (items.length === 0) return { ok: true, outputs: { facts: [] } };

    const normalizeFact = (raw: unknown, fallbackSource: string): Fact => {
      const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const text = typeof obj.text === 'string' ? obj.text : '';
      const source = typeof obj.source === 'string' ? obj.source : fallbackSource;
      const id = typeof obj.id === 'string' ? obj.id : `f-${Math.random().toString(36).slice(2)}`;
      const rawType = typeof obj.type === 'string' ? obj.type : 'claim';
      const type = (['entity', 'event', 'claim', 'obligation'] as const).includes(rawType as Fact['type']) ? (rawType as Fact['type']) : 'claim';
      const confidence = typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.7;
      return { id, text, source, type, confidence };
    };

    const deduplicateFacts = (facts: Fact[]): Fact[] => {
      const seen = new Map<string, Fact>();
      for (const f of facts) {
        const key = f.text.toLowerCase().replace(/[^\w\s]+/g, '').replace(/\s+/g, ' ').trim();
        if (!key || seen.has(key)) continue;
        seen.set(key, f);
      }
      return [...seen.values()];
    };

    const toFallbackFacts = (): Fact[] =>
      items.map((it) => ({
        id: `f-${it.id}`,
        text: it.content,
        source: it.source,
        type: 'claim' as const,
        confidence: 0.3,
      }));

    const model = tryCreateModel();
    if (!model) {
      const facts = deduplicateFacts(toFallbackFacts());
      return { ok: true, outputs: { facts, warnings: ['No AI model available; facts are pass-through snippets with low confidence.'] } };
    }

    const evidenceText = items.map((it) => `--- source: ${it.source} (id:${it.id}) ---\n${it.content}`).join('\n\n');
    const modelHint = step.model ? ` Focus on facts related to: ${step.model}.` : '';
    const prompt = `You are extracting structured facts from evidence snippets for a document-authoring pipeline.\n\nEvidence snippets:\n${evidenceText}\n\nInstructions:\n- For each fact, produce a JSON object with: id, text, source, type (one of: entity, event, claim, obligation), and confidence (0..1).${modelHint}\n- Do not invent facts that are not supported by the evidence.\n- Return ONLY a JSON object in the form: {"facts": [...]}`;

    try {
      const { text: out } = await generateText({ model, prompt, maxOutputTokens: 4096, temperature: 0.1 });
      const parsed = extractJsonObject<{ facts?: unknown[] }>(out);
      const rawFacts = Array.isArray(parsed?.facts) ? (parsed!.facts as unknown[]) : [];
      const normalized = rawFacts.length ? rawFacts.map((r) => normalizeFact(r, items[0]!.source)) : toFallbackFacts();
      const facts = deduplicateFacts(normalized);
      return { ok: true, outputs: { facts } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('DOC_STUDIO', `Fact extraction failed: ${message}`);
      const facts = deduplicateFacts(toFallbackFacts());
      return { ok: true, outputs: { facts, warnings: [`Fact extraction failed: ${message}; falling back to pass-through snippets.`] } };
    }
  }

  // ─── Jobs (Phase 3) ────────────────────────────────────────────────────────

  async listRecipes(tag?: string, phase?: string): Promise<{ id: string; name: string; description: string; tags: string[]; phases: string[] }[]> {
    const list = RECIPE_CATALOG.filter((r) => (!tag || r.tags.includes(tag)) && (!phase || r.phases.includes(phase)));
    return list.map((r) => ({ id: r.id, name: r.name, description: r.description, tags: r.tags, phases: r.phases }));
  }

  async getRecipe(id: string): Promise<{ recipe: typeof RECIPE_CATALOG[0]; spec: JobSpec } | null> {
    const recipe = RECIPE_CATALOG.find((r) => r.id === id);
    if (!recipe) return null;
    const spec = compileRecipeToSpec(id);
    if (!spec) return null;
    return { recipe, spec };
  }

  async createJob(title: string, spec: JobSpec, recipeId?: string, binderId?: string): Promise<Job> {
    const job = await this.jobs.create(title, spec, recipeId, binderId);
    return this.runner.compile(job);
  }

  async compileJob(input: { intent?: string; recipeId?: string; binderId?: string; spec?: JobSpec; params?: Record<string, unknown> }): Promise<{ spec: JobSpec; gaps: string[] } | null> {
    if (input.spec) {
      const v = validateJobSpec(input.spec);
      if (!v.ok) return null;
      return { spec: input.spec, gaps: v.issues.map((i) => `${i.path}: ${i.message}`) };
    }
    if (input.recipeId) {
      const params: Record<string, unknown> = { intent: input.intent, ...input.params };
      if (input.binderId) {
        const binder = await this.getBinder(input.binderId);
        const masterIds: Record<string, string> = {};
        let kbSelector: KbSelector | undefined;
        for (const slot of binder?.slots ?? []) {
          if (slot.role.endsWith('_master')) masterIds[slot.role] = (slot as unknown as { masterId: string }).masterId;
          if (slot.role === 'kb_selector') {
            const selector = (slot as unknown as { selector?: KbSelector }).selector;
            if (selector) {
              kbSelector = selector;
              if (selector.mode === 'ids') masterIds['kb'] = selector.sourceIds.join(',');
            }
          }
        }
        params['masterIds'] = masterIds;
        if (kbSelector) params['kbSelector'] = kbSelector;
      }
      const spec = compileRecipeToSpec(input.recipeId, params as { title?: string; intent?: string; masterIds?: Record<string, string>; kbSelector?: KbSelector });
      if (!spec) return null;
      return { spec, gaps: [] };
    }
    return null;
  }

  async createJobFromRecipe(title: string, recipeId: string, params: Record<string, unknown> = {}, binderId?: string): Promise<Job | null> {
    const compiled = await this.compileJob({ recipeId, params, binderId });
    if (!compiled) return null;
    return this.createJob(title, compiled.spec, recipeId, binderId);
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id);
  }

  async listJobs(filter?: { status?: string; limit?: number }): Promise<Job[]> {
    return this.jobs.list(filter as { status?: 'draft' | 'compiled' | 'awaiting_input' | 'dry_run' | 'running' | 'partial' | 'completed' | 'failed' | 'cancelled'; limit?: number });
  }

  async runJob(id: string): Promise<Job | null> {
    const job = await this.jobs.get(id);
    if (!job) return null;
    const instances = await this.instances.getByJob(id).catch(() => [] as Instance[]);
    const resumeFromStep = this.computeResumeFromStep(job, instances);
    const ran = await this.runner.run(job, {}, { resumeFromStep });
    return this.jobs.update(ran.id, ran);
  }

  async cancelJob(id: string): Promise<Job | null> {
    this.runner.cancel(id);
    const job = await this.jobs.get(id);
    if (!job) return null;
    const patch: Partial<Job> = { cancelled: true, cancelledAt: new Date().toISOString(), error: 'Cancelled by user' };
    if (canTransition(job.status, 'cancelled')) {
      const cancelled = this.runner.cancel(job);
      patch.status = cancelled.status;
    }
    return this.jobs.update(id, patch);
  }

  private computeResumeFromStep(job: Job, instances: Instance[]): number | undefined {
    const stepResults = (job.stepResults as Record<string, { ok: boolean }> | undefined) ?? {};
    const total = job.spec.steps.length;
    for (let i = 0; i < total; i++) {
      const result = stepResults[String(i)];
      if (result && result.ok) continue;
      return i;
    }
    // All recorded steps succeeded but there are still unfinished instances;
    // resume at the compose step so it can skip completed/delivered instances.
    const composeIdx = job.spec.steps.findIndex((s) => s.op === 'compose');
    const hasPending = instances.some((inst) => inst.status !== 'delivered' && inst.status !== 'completed' && inst.status !== 'composed');
    if (composeIdx >= 0 && hasPending) return composeIdx;
    return undefined;
  }

  async submitAnswers(jobId: string, answers: Record<string, unknown>): Promise<Job | null> {
    const job = await this.jobs.get(jobId);
    if (!job) return null;
    // Merge answers into the spec's answer set output; for Phase 3 store inline in spec.
    const specRecord = job.spec as unknown as Record<string, unknown>;
    const existing = (specRecord['answers'] as Record<string, unknown> | undefined) ?? {};
    const merged = { ...existing, ...answers };
    const updated = await this.jobs.update(jobId, { spec: { ...specRecord, answers: merged } as unknown as JobSpec });
    if (!updated) return null;
    // Resume from awaiting_input.
    if (updated.status === 'awaiting_input') {
      const ctx: Record<string, unknown> = { answers: merged };
      return this.runWithContext(updated, ctx);
    }
    return updated;
  }

  private async runWithContext(job: Job, ctx: Record<string, unknown>): Promise<Job | null> {
    const ran = await this.runner.run(job, ctx);
    return this.jobs.update(ran.id, ran) ?? null;
  }

  async listArtifacts(jobId: string): Promise<Artifact[]> {
    return this.artifacts.list(jobId);
  }

  async getArtifact(id: string): Promise<Artifact | null> {
    return this.artifacts.get(id);
  }

  async openPath(relPath: string): Promise<{ path: string }> {
    const fullPath = join(this.workspaceRoot, relPath);
    const platform = process.platform;
    const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', fullPath] : [fullPath];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
    return { path: fullPath };
  }

  // ─── Phase 4 batch gates, dry-run, manifest ─────────────────────────────────

  async confirmJobGate(id: string): Promise<Job | null> {
    const job = await this.jobs.get(id);
    if (!job) return null;
    if (job.status !== 'dry_run') return job;
    return this.jobs.update(id, { status: 'compiled' });
  }

  async dryRunJob(id: string): Promise<Job | null> {
    const job = await this.jobs.get(id);
    if (!job) return null;
    // Phase 4 dry-run: compile and simulate one instance; no delivery, no artifacts.
    const compiled = this.runner.compile(job);
    await this.jobs.update(id, compiled);
    const dummyCtx: Record<string, unknown> = { dryRun: true };
    const ran = await this.runner.run({ ...compiled, status: 'compiled' }, dummyCtx);
    if (ran.status === 'completed') {
      return this.jobs.update(id, { status: 'dry_run' });
    }
    return this.jobs.update(id, ran);
  }

  async getManifest(jobId: string): Promise<Manifest | null> {
    const job = await this.jobs.get(jobId);
    if (!job || !job.manifestId) return null;
    return this.manifests.get(job.manifestId);
  }
}

// ─── Global accessor (same pattern as KnowledgeBaseService) ────────────────

let service: DocumentStudioService | null = null;

export function setDocumentStudioService(next: DocumentStudioService | null): void {
  service = next;
}

export function getDocumentStudioService(): DocumentStudioService | null {
  return service;
}
