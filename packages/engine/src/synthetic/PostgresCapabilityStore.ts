import { generateId, getLogger, type Capability, type CapabilityAuditEvent, type CapabilityKind, type CapabilityMeta, type CapabilityOrigin, type CapabilityStatus, type CapabilityTestCase, type CapabilityUsageRecord, type GraduationGate, type GraduationGateName, type ObservedPattern } from '@agentx/shared';
import { CapabilityStoreError } from './errors.js';
import type { CapabilityStore, ObservationQuery, QueryablePool } from './interfaces.js';
import { parseJsonField, toMillis } from './json.js';

const TRANSIENT = /deadlock|serialization|connection|timeout|ECONNRESET/i;

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      getLogger().warn('SI_STORE', msg);
      if (!TRANSIENT.test(msg) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 50 * 2 ** i));
    }
  }
  throw last instanceof Error ? last : new CapabilityStoreError(String(last));
}

function rowToCapability(row: Record<string, unknown>): Capability {
  const kind = String(row['kind'] ?? 'skill') as CapabilityKind;
  const meta = {
    id: String(row['id']),
    kind,
    name: String(row['name'] ?? ''),
    description: String(row['description'] ?? ''),
    createdAt: toMillis(row['created_at']),
    updatedAt: toMillis(row['updated_at']),
    createdBy: String(row['created_by'] ?? 'system'),
    sourceSessionId: String(row['source_session_id'] ?? ''),
    version: Number(row['version'] ?? 1),
    origin: (row['origin'] as Capability['origin']) ?? 'observed',
    userPrompt: row['user_prompt'] ? String(row['user_prompt']) : undefined,
    status: (row['status'] as CapabilityStatus) ?? 'proposed',
    useCount: Number(row['use_count'] ?? 0),
    trialCount: Number(row['trial_count'] ?? 0),
    generatedBy: row['generated_by'] ? String(row['generated_by']) : undefined,
    alternatives: parseJsonField<string[]>(row['alternatives'], []),
    mergedFrom: parseJsonField<string[]>(row['merged_from'], []),
  };
  if (kind === 'tool') {
    return {
      ...meta,
      kind: 'tool',
      language: (row['language'] as ToolLang) ?? 'typescript',
      sourceCode: String(row['source_code'] ?? ''),
      entryPoint: String(row['entry_point'] ?? 'run'),
      inputSchema: parseJsonField(row['input_schema'], {}),
      outputSchema: parseJsonField(row['output_schema'], {}),
      dependencies: parseJsonField(row['dependencies'], []),
      sideEffects: parseJsonField(row['side_effects'], []),
      approvedSideEffects: parseJsonField(row['approved_side_effects'], []),
      sandboxResult: parseJsonField(row['sandbox_result'], null),
      originalSourceCode: row['original_source_code'] ? String(row['original_source_code']) : undefined,
    };
  }
  if (kind === 'knowledge') {
    return {
      ...meta,
      kind: 'knowledge',
      domain: String(row['domain'] ?? ''),
      content: String(row['knowledge_content'] ?? ''),
      sourceReferences: parseJsonField(row['source_references'], []),
    };
  }
  return {
    ...meta,
    kind: 'skill',
    promptTemplate: String(row['prompt_template'] ?? ''),
    triggerPattern: String(row['trigger_pattern'] ?? ''),
    exampleCalls: parseJsonField(row['example_calls'], []),
  };
}

type ToolLang = 'typescript' | 'python' | 'bash' | 'javascript';

function capabilityParams(cap: Capability): unknown[] {
  const tool = cap.kind === 'tool' ? cap : null;
  const skill = cap.kind === 'skill' ? cap : null;
  const knowledge = cap.kind === 'knowledge' ? cap : null;
  return [
    cap.id,
    cap.kind,
    cap.status,
    cap.name,
    cap.description,
    new Date(cap.createdAt).toISOString(),
    new Date(cap.updatedAt).toISOString(),
    cap.createdBy,
    cap.sourceSessionId || null,
    cap.version,
    cap.origin,
    cap.userPrompt ?? null,
    cap.generatedBy ?? null,
    JSON.stringify(cap.alternatives ?? []),
    tool?.language ?? null,
    tool?.sourceCode ?? null,
    tool?.entryPoint ?? null,
    tool ? JSON.stringify(tool.inputSchema ?? {}) : null,
    tool ? JSON.stringify(tool.outputSchema ?? {}) : null,
    tool ? JSON.stringify(tool.dependencies ?? []) : null,
    tool ? JSON.stringify(tool.sideEffects ?? []) : null,
    tool ? JSON.stringify(tool.approvedSideEffects ?? []) : null,
    tool?.sandboxResult ? JSON.stringify(tool.sandboxResult) : null,
    cap.trialCount,
    cap.useCount,
    skill?.promptTemplate ?? null,
    skill?.triggerPattern ?? null,
    skill ? JSON.stringify(skill.exampleCalls ?? []) : null,
    knowledge?.domain ?? null,
    knowledge?.content ?? null,
    knowledge ? JSON.stringify(knowledge.sourceReferences ?? []) : null,
    cap.kind === 'tool' ? (cap.originalSourceCode ?? cap.sourceCode) : null,
    JSON.stringify(cap.mergedFrom ?? []),
  ];
}

export class PostgresCapabilityStore implements CapabilityStore {
  constructor(private pool: QueryablePool) {}

  async initialize(): Promise<void> {
    // Schema is applied by V014 / V015 / V016 engine migrations.
  }

  async close(): Promise<void> {
    // Shared engine pool — do not end.
  }

  async insertCapability(cap: Capability): Promise<void> {
    try {
      await withRetry(() => this.pool.query(
        `INSERT INTO capabilities (
          id, kind, status, name, description, created_at, updated_at, created_by, source_session_id,
          version, origin, user_prompt, generated_by, alternatives, language, source_code, entry_point,
          input_schema, output_schema, dependencies, side_effects, approved_side_effects, sandbox_result,
          trial_count, use_count, prompt_template, trigger_pattern, example_calls, domain, knowledge_content, source_references,
          original_source_code, merged_from
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33
        )`,
        capabilityParams(cap),
      ));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate/i.test(msg)) {
        throw new CapabilityStoreError(`Capability name already exists: ${cap.name}`);
      }
      throw new CapabilityStoreError(msg);
    }
  }

  async updateCapabilityStatus(id: string, status: CapabilityStatus): Promise<void> {
    await withRetry(() => this.pool.query(
      `UPDATE capabilities SET status = $2, updated_at = NOW() WHERE id = $1`,
      [id, status],
    ));
  }

  async updateCapability(id: string, updates: Partial<CapabilityMeta> & Record<string, unknown>): Promise<void> {
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      status: 'status',
      version: 'version',
      createdBy: 'created_by',
      sourceSessionId: 'source_session_id',
      origin: 'origin',
      userPrompt: 'user_prompt',
      generatedBy: 'generated_by',
      useCount: 'use_count',
      trialCount: 'trial_count',
      sourceCode: 'source_code',
      entryPoint: 'entry_point',
      language: 'language',
      promptTemplate: 'prompt_template',
      triggerPattern: 'trigger_pattern',
      sandboxResult: 'sandbox_result',
      alternatives: 'alternatives',
      inputSchema: 'input_schema',
      outputSchema: 'output_schema',
      dependencies: 'dependencies',
      sideEffects: 'side_effects',
      approvedSideEffects: 'approved_side_effects',
      exampleCalls: 'example_calls',
      domain: 'domain',
      content: 'knowledge_content',
      sourceReferences: 'source_references',
      originalSourceCode: 'original_source_code',
      mergedFrom: 'merged_from',
    };
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [id];
    for (const [key, col] of Object.entries(map)) {
      if (!(key in updates)) continue;
      const value = updates[key];
      params.push(
        value != null && (typeof value === 'object')
          ? JSON.stringify(value)
          : value,
      );
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length === 1) return;
    await withRetry(() => this.pool.query(
      `UPDATE capabilities SET ${sets.join(', ')} WHERE id = $1`,
      params,
    ));
  }

  async deleteCapability(id: string): Promise<void> {
    await this.updateCapabilityStatus(id, 'archived');
  }

  async getCapability(id: string): Promise<Capability | null> {
    const { rows } = await this.pool.query(`SELECT * FROM capabilities WHERE id = $1`, [id]);
    return rows[0] ? rowToCapability(rows[0]) : null;
  }

  async getCapabilities(status?: CapabilityStatus, kind?: CapabilityKind, limit = 100, offset = 0): Promise<Capability[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (kind) {
      params.push(kind);
      clauses.push(`kind = $${params.length}`);
    }
    params.push(limit, offset);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT * FROM capabilities ${where} ORDER BY updated_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map(rowToCapability);
  }

  async findCapabilityByName(name: string): Promise<Capability | null> {
    const { rows } = await this.pool.query(`SELECT * FROM capabilities WHERE name = $1`, [name]);
    return rows[0] ? rowToCapability(rows[0]) : null;
  }

  async searchCapabilities(query: string): Promise<Capability[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capabilities WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY updated_at DESC LIMIT 50`,
      [`%${query}%`],
    );
    return rows.map(rowToCapability);
  }

  async insertObservation(pattern: ObservedPattern): Promise<void> {
    const existing = await this.pool.query(
      `SELECT * FROM observed_patterns WHERE pattern = $1`,
      [pattern.pattern],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      await this.pool.query(
        `UPDATE observed_patterns SET frequency = frequency + 1, last_observed_at = NOW(), confidence = $2, context = $3 WHERE id = $1`,
        [row['id'], Math.max(Number(row['confidence'] ?? 0), pattern.confidence), pattern.context],
      );
      return;
    }
    await this.pool.query(
      `INSERT INTO observed_patterns (id, pattern, frequency, first_observed_at, last_observed_at, context, confidence, acknowledged, origin, example_inputs, rejected_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        pattern.id,
        pattern.pattern,
        pattern.frequency,
        new Date(pattern.firstObservedAt).toISOString(),
        new Date(pattern.lastObservedAt).toISOString(),
        pattern.context,
        pattern.confidence,
        pattern.acknowledged ? 1 : 0,
        pattern.origin,
        pattern.exampleInputs ? JSON.stringify(pattern.exampleInputs) : null,
        pattern.rejectedCount ?? 0,
      ],
    );
  }

  async updateObservation(id: string, updates: Partial<ObservedPattern>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    const map: Record<string, string> = {
      frequency: 'frequency',
      context: 'context',
      confidence: 'confidence',
      acknowledged: 'acknowledged',
      ignored: 'ignored',
      pattern: 'pattern',
      rejectedCount: 'rejected_count',
    };
    for (const [key, col] of Object.entries(map)) {
      if (!(key in updates)) continue;
      const value = (updates as Record<string, unknown>)[key];
      params.push(key === 'acknowledged' || key === 'ignored' ? (value ? 1 : 0) : value);
      sets.push(`${col} = $${params.length}`);
    }
    if (updates.lastObservedAt) {
      params.push(new Date(updates.lastObservedAt).toISOString());
      sets.push(`last_observed_at = $${params.length}`);
    }
    if (sets.length === 0) return;
    await this.pool.query(`UPDATE observed_patterns SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  async getObservations(minConfidence = 0, query: ObservationQuery = {}): Promise<ObservedPattern[]> {
    const minFreq = query.minFrequency ?? 0;
    const includeIgnored = query.includeIgnored === true;
    const { rows } = await this.pool.query(
      `SELECT * FROM observed_patterns
       WHERE confidence >= $1 AND frequency >= $2
         AND ($3::int = 1 OR COALESCE(ignored, 0) = 0)
       ORDER BY confidence DESC, frequency DESC`,
      [query.minConfidence ?? minConfidence, minFreq, includeIgnored ? 1 : 0],
    );
    return rows.map(rowToObservation);
  }

  async getObservation(id: string): Promise<ObservedPattern | null> {
    const { rows } = await this.pool.query(`SELECT * FROM observed_patterns WHERE id = $1`, [id]);
    return rows[0] ? rowToObservation(rows[0]) : null;
  }

  async insertAuditEvent(event: CapabilityAuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO capability_audit_events (id, capability_id, event, timestamp, actor, details)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        event.id || generateId('cae'),
        event.capabilityId ?? null,
        event.event,
        new Date(event.timestamp).toISOString(),
        event.actor,
        JSON.stringify(event.details ?? {}),
      ],
    );
  }

  async getAuditEvents(capabilityId: string): Promise<CapabilityAuditEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capability_audit_events WHERE capability_id = $1 ORDER BY timestamp ASC`,
      [capabilityId],
    );
    return rows.map((row) => ({
      id: String(row['id']),
      capabilityId: row['capability_id'] == null ? null : String(row['capability_id']),
      event: String(row['event']),
      timestamp: toMillis(row['timestamp']),
      actor: String(row['actor'] ?? 'system'),
      details: parseJsonField(row['details'], {}),
    }));
  }

  async incrementUseCount(capabilityId: string): Promise<void> {
    await this.pool.query(
      `UPDATE capabilities SET use_count = use_count + 1, updated_at = NOW() WHERE id = $1`,
      [capabilityId],
    );
  }

  async recordUsage(record: CapabilityUsageRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO capability_usage (id, capability_id, session_id, success, created_at, execution_time_ms, positive_feedback)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        record.id,
        record.capabilityId,
        record.sessionId ?? null,
        record.success ? 1 : 0,
        new Date(record.createdAt).toISOString(),
        record.executionTimeMs ?? null,
        record.positiveFeedback == null ? null : (record.positiveFeedback ? 1 : 0),
      ],
    );
    await this.incrementUseCount(record.capabilityId);
  }

  async getUsage(capabilityId: string, limit = 50): Promise<CapabilityUsageRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capability_usage WHERE capability_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [capabilityId, limit],
    );
    return rows.map((row) => ({
      id: String(row['id']),
      capabilityId: String(row['capability_id']),
      sessionId: row['session_id'] ? String(row['session_id']) : undefined,
      success: Number(row['success'] ?? 1) === 1,
      createdAt: toMillis(row['created_at']),
      executionTimeMs: row['execution_time_ms'] == null ? undefined : Number(row['execution_time_ms']),
      positiveFeedback: row['positive_feedback'] == null ? undefined : Number(row['positive_feedback']) === 1,
    }));
  }

  async getMostUsedTools(limit = 10): Promise<Capability[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capabilities WHERE kind = 'tool' AND status = 'registered' ORDER BY use_count DESC LIMIT $1`,
      [limit],
    );
    return rows.map(rowToCapability);
  }

  async upsertGates(capabilityId: string, gates: GraduationGate[]): Promise<void> {
    for (const gate of gates) {
      await this.pool.query(
        `INSERT INTO capability_gates (capability_id, gate, status, passed_at, passed_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (capability_id, gate) DO UPDATE SET
           status = EXCLUDED.status,
           passed_at = EXCLUDED.passed_at,
           passed_by = EXCLUDED.passed_by,
           notes = EXCLUDED.notes`,
        [
          capabilityId,
          gate.gate,
          gate.status,
          gate.passedAt ? new Date(gate.passedAt).toISOString() : null,
          gate.passedBy,
          gate.notes,
        ],
      );
    }
  }

  async getGates(capabilityId: string): Promise<GraduationGate[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capability_gates WHERE capability_id = $1`,
      [capabilityId],
    );
    return rows.map((row) => ({
      gate: row['gate'] as GraduationGateName,
      status: row['status'] as GraduationGate['status'],
      passedAt: row['passed_at'] ? toMillis(row['passed_at']) : null,
      passedBy: row['passed_by'] ? String(row['passed_by']) : null,
      notes: String(row['notes'] ?? ''),
    }));
  }

  async updateGate(capabilityId: string, gate: GraduationGateName, patch: Partial<GraduationGate>): Promise<void> {
    const existing = (await this.getGates(capabilityId)).find((g) => g.gate === gate);
    const next: GraduationGate = {
      gate,
      status: patch.status ?? existing?.status ?? 'pending',
      passedAt: patch.passedAt !== undefined ? patch.passedAt : (existing?.passedAt ?? null),
      passedBy: patch.passedBy !== undefined ? patch.passedBy : (existing?.passedBy ?? null),
      notes: patch.notes ?? existing?.notes ?? '',
    };
    await this.upsertGates(capabilityId, [next]);
  }

  async getStats(): Promise<{ total: number; byStatus: Record<string, number>; byKind: Record<string, number> }> {
    const { rows } = await this.pool.query(
      `SELECT status, kind, COUNT(*)::int AS n FROM capabilities GROUP BY status, kind`,
    );
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      const n = Number(row['n'] ?? 0);
      total += n;
      const status = String(row['status']);
      const kind = String(row['kind']);
      byStatus[status] = (byStatus[status] ?? 0) + n;
      byKind[kind] = (byKind[kind] ?? 0) + n;
    }
    return { total, byStatus, byKind };
  }

  async listToolExecutionAggregates(minCount = 3): Promise<Array<{ toolName: string; frequency: number; lastAt: number }>> {
    const { rows } = await this.pool.query(
      `SELECT tool_name, COUNT(*)::int AS frequency, MAX(created_at) AS last_at
       FROM tool_executions
       GROUP BY tool_name
       HAVING COUNT(*) >= $1
       ORDER BY frequency DESC`,
      [minCount],
    );
    return rows.map((row) => ({
      toolName: String(row['tool_name']),
      frequency: Number(row['frequency'] ?? 0),
      lastAt: toMillis(row['last_at']),
    }));
  }

  async listByOrigin(origin: CapabilityOrigin, limit = 100, offset = 0): Promise<Capability[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capabilities WHERE origin = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
      [origin, limit, offset],
    );
    return rows.map(rowToCapability);
  }

  async getRecentAuditEvents(limit = 20): Promise<CapabilityAuditEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capability_audit_events ORDER BY timestamp DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      id: String(row['id']),
      capabilityId: row['capability_id'] == null ? null : String(row['capability_id']),
      event: String(row['event']),
      timestamp: toMillis(row['timestamp']),
      actor: String(row['actor'] ?? 'system'),
      details: parseJsonField(row['details'], {}),
    }));
  }

  async insertTestCase(testCase: CapabilityTestCase): Promise<void> {
    await this.pool.query(
      `INSERT INTO capability_test_cases (id, capability_id, name, input, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        testCase.id,
        testCase.capabilityId,
        testCase.name,
        JSON.stringify(testCase.input ?? {}),
        new Date(testCase.createdAt).toISOString(),
      ],
    );
  }

  async listTestCases(capabilityId: string): Promise<CapabilityTestCase[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capability_test_cases WHERE capability_id = $1 ORDER BY created_at DESC`,
      [capabilityId],
    );
    return rows.map((row) => ({
      id: String(row['id']),
      capabilityId: String(row['capability_id']),
      name: String(row['name'] ?? ''),
      input: parseJsonField(row['input'], {}),
      createdAt: toMillis(row['created_at']),
    }));
  }

  async getTestCase(capabilityId: string, caseId: string): Promise<CapabilityTestCase | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM capability_test_cases WHERE capability_id = $1 AND id = $2`,
      [capabilityId, caseId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row['id']),
      capabilityId: String(row['capability_id']),
      name: String(row['name'] ?? ''),
      input: parseJsonField(row['input'], {}),
      createdAt: toMillis(row['created_at']),
    };
  }

  async updateTestCase(capabilityId: string, caseId: string, updates: Partial<CapabilityTestCase>): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [capabilityId, caseId];
    if ('name' in updates) {
      params.push(updates.name);
      sets.push(`name = $${params.length}`);
    }
    if ('input' in updates) {
      params.push(JSON.stringify(updates.input ?? {}));
      sets.push(`input = $${params.length}`);
    }
    if (sets.length === 0) return;
    await this.pool.query(
      `UPDATE capability_test_cases SET ${sets.join(', ')} WHERE capability_id = $1 AND id = $2`,
      params,
    );
  }

  async deleteTestCase(capabilityId: string, caseId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM capability_test_cases WHERE capability_id = $1 AND id = $2`,
      [capabilityId, caseId],
    );
  }

  async countAuditEvents(event: string, sinceMs: number, sessionId?: string): Promise<number> {
    if (sessionId) {
      const { rows } = await this.pool.query(
        `SELECT COUNT(*)::int AS n FROM capability_audit_events
         WHERE event = $1 AND timestamp >= $2 AND details LIKE $3`,
        [event, new Date(sinceMs).toISOString(), `%"sessionId":"${sessionId}"%`],
      );
      return Number(rows[0]?.['n'] ?? 0);
    }
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM capability_audit_events WHERE event = $1 AND timestamp >= $2`,
      [event, new Date(sinceMs).toISOString()],
    );
    return Number(rows[0]?.['n'] ?? 0);
  }
}

function rowToObservation(row: Record<string, unknown>): ObservedPattern {
  return {
    id: String(row['id']),
    pattern: String(row['pattern'] ?? ''),
    frequency: Number(row['frequency'] ?? 1),
    firstObservedAt: toMillis(row['first_observed_at']),
    lastObservedAt: toMillis(row['last_observed_at']),
    context: String(row['context'] ?? ''),
    confidence: Number(row['confidence'] ?? 0),
    origin: (row['origin'] as ObservedPattern['origin']) ?? 'autonomous',
    exampleInputs: parseJsonField(row['example_inputs'], undefined),
    acknowledged: Number(row['acknowledged'] ?? 0) === 1,
    ignored: Number(row['ignored'] ?? 0) === 1,
    rejectedCount: Number(row['rejected_count'] ?? 0),
  };
}

export { rowToCapability };
