import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { InstanceStore } from '../src/document-studio/jobs/InstanceStore.js';
import { ManifestStore } from '../src/document-studio/jobs/JobStore.js';

class MockPool {
  private instances: Record<string, unknown>[] = [];
  private manifests: Record<string, unknown>[] = [];

  async query(text: string, values: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    if (text.includes('INSERT INTO doc_instances')) {
      const [id, jobId, index, bindingSetId, path, masterId, status, error] = values;
      const row = { id, job_id: jobId, index, binding_set_id: bindingSetId, path, master_id: masterId, status, error };
      this.instances.push(row);
      return { rows: [row] };
    }
    if (text.includes('SELECT * FROM doc_instances WHERE job_id = $1')) {
      return { rows: this.instances.filter((r) => r['job_id'] === values[0]) };
    }
    if (text.includes('UPDATE doc_instances SET status = $1, error = $2 WHERE id = $3')) {
      const row = this.instances.find((r) => r['id'] === values[2]);
      if (row) {
        row['status'] = values[0];
        row['error'] = values[1];
        return { rows: [row] };
      }
      return { rows: [] };
    }
    if (text.includes('INSERT INTO doc_manifests')) {
      const [id, jobId, rowsStr, ok, failed, skipped] = values;
      const row = {
        id,
        job_id: jobId,
        rows: JSON.parse(rowsStr as string) as unknown,
        summary_ok: ok,
        summary_failed: failed,
        summary_skipped: skipped,
      };
      this.manifests.push(row);
      return { rows: [row] };
    }
    if (text.includes('SELECT * FROM doc_manifests WHERE id = $1')) {
      return { rows: this.manifests.filter((r) => r['id'] === values[0]) };
    }
    throw new Error(`Unexpected query: ${text}`);
  }
}

function mockPool(): Pool {
  return new MockPool() as unknown as Pool;
}

describe('InstanceStore', () => {
  it('creates and retrieves planned instances for a job', async () => {
    const store = new InstanceStore(mockPool());
    const created = await store.create('job-1', 0, { path: 'out/0.pdf', masterId: 'm1', status: 'planned' });
    expect(created.jobId).toBe('job-1');
    expect(created.index).toBe(0);
    expect(created.path).toBe('out/0.pdf');
    expect(created.masterId).toBe('m1');
    expect(created.status).toBe('planned');

    const list = await store.getByJob('job-1');
    expect(list).toHaveLength(1);
    expect(list[0]!.path).toBe('out/0.pdf');
  });

  it('updates an instance status', async () => {
    const store = new InstanceStore(mockPool());
    const created = await store.create('job-1', 1, { path: 'out/1.pdf' });
    const updated = await store.updateStatus(created.id, 'bound');
    expect(updated?.status).toBe('bound');
  });
});

describe('ManifestStore', () => {
  it('creates and retrieves a manifest for a job', async () => {
    const store = new ManifestStore(mockPool());
    const manifest = await store.create(
      'job-1',
      [
        { index: 0, path: 'out/0.pdf', status: 'ok', artifactId: 'a1' },
        { index: 1, path: 'out/1.pdf', status: 'failed', error: 'boom' },
      ],
      { ok: 1, failed: 1, skipped: 0 },
    );
    expect(manifest.jobId).toBe('job-1');
    expect(manifest.summary).toEqual({ ok: 1, failed: 1, skipped: 0 });
    expect(manifest.rows).toHaveLength(2);

    const got = await store.get(manifest.id);
    expect(got).not.toBeNull();
    expect(got!.jobId).toBe('job-1');
    expect(got!.rows[1]!.status).toBe('failed');
  });
});
