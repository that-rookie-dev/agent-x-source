/**
 * Document Studio — Artifact persistence (spec §14).
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Artifact, EvidenceLink } from '../types.js';

export class ArtifactStore {
  constructor(private readonly pool: Pool) {}

  private rowToArtifact(row: Record<string, unknown>): Artifact {
    return {
      id: String(row['id']),
      jobId: String(row['job_id']),
      instanceIndex: row['instance_index'] != null ? Number(row['instance_index']) : undefined,
      path: String(row['path']),
      storageId: row['storage_id'] != null ? String(row['storage_id']) : undefined,
      format: String(row['format']),
      checksum: String(row['checksum']),
      bindingSetId: row['binding_set_id'] != null ? String(row['binding_set_id']) : undefined,
      evidenceMap: (row['evidence_map'] as EvidenceLink[] | undefined) ?? undefined,
      createdAt: row['created_at'] instanceof Date ? row['created_at'].toISOString() : String(row['created_at']),
    };
  }

  async create(input: Omit<Artifact, 'id' | 'createdAt'>): Promise<Artifact> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO doc_artifacts (id, job_id, instance_index, path, storage_id, format, checksum, binding_set_id, evidence_map) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING *`,
      [id, input.jobId, input.instanceIndex ?? null, input.path, input.storageId ?? null, input.format, input.checksum, input.bindingSetId ?? null, JSON.stringify(input.evidenceMap ?? [])],
    );
    if (!rows[0]) throw new Error('Failed to create artifact');
    return this.rowToArtifact(rows[0]);
  }

  async list(jobId: string): Promise<Artifact[]> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_artifacts WHERE job_id = $1 ORDER BY created_at DESC`, [jobId]);
    return rows.map((r) => this.rowToArtifact(r));
  }

  async get(id: string): Promise<Artifact | null> {
    const { rows } = await this.pool.query(`SELECT * FROM doc_artifacts WHERE id = $1`, [id]);
    return rows[0] ? this.rowToArtifact(rows[0]) : null;
  }
}
