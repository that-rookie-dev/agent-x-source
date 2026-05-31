import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPut, apiPost } from '../api';
import { useToast } from '../components/ToastProvider';

interface ComparisonRow {
  feature: string;
  sqlite: string;
  postgresql: string;
}

interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: string;
  updatedAt: string;
  isBuiltin: boolean;
}

interface PluginConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: Array<{ label: string; value: string }>;
}

interface PluginHubEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  category: string;
  tags: string[];
  config?: Record<string, PluginConfigField>;
  isBuiltin: boolean;
}

export default function PluginDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const [plugin, setPlugin] = useState<InstalledPlugin | null>(null);
  const [catalogEntry, setCatalogEntry] = useState<PluginHubEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; version?: string; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [comparison, setComparison] = useState<ComparisonRow[] | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  useEffect(() => {
    if (id) loadPlugin(id);
  }, [id]);

  async function loadPlugin(pluginId: string) {
    setLoading(true);
    try {
      const res = await apiGet<{ plugin: InstalledPlugin }>(`/api/plugins/${pluginId}`);
      setPlugin(res.plugin);
      setFormValues(Object.fromEntries(
        Object.entries(res.plugin.config).map(([k, v]) => [k, String(v ?? '')])
      ));
      // Fetch catalog entry for config schema
      const avail = await apiGet<{ plugins: PluginHubEntry[] }>('/api/plugins/available');
      const installed = await apiGet<{ plugins: PluginHubEntry[] }>('/api/plugins/installed');
      const all = [...avail.plugins, ...installed.plugins];
      const entry = all.find((p) => p.id === pluginId);
      setCatalogEntry(entry ?? null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load plugin';
      toast.push(msg, 'error');
    }
    setLoading(false);
  }

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    try {
      const parsed: Record<string, unknown> = {};
      const fields = catalogEntry?.config ?? {};
      for (const [key, field] of Object.entries(fields)) {
        const val = formValues[key] ?? '';
        if (field.type === 'number') {
          parsed[key] = Number(val);
        } else if (field.type === 'boolean') {
          parsed[key] = val === 'true';
        } else {
          parsed[key] = val;
        }
      }
      await apiPut(`/api/plugins/${id}/config`, { config: parsed });
      toast.push('Configuration saved', 'success');
      if (id) loadPlugin(id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.push(msg, 'error');
    }
    setSaving(false);
  }

  async function handleToggle() {
    if (!id) return;
    try {
      const res = await apiPost<{ enabled: boolean }>(`/api/plugins/${id}/toggle`);
      toast.push(res.enabled ? 'Plugin enabled' : 'Plugin disabled', 'success');
      if (id) loadPlugin(id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Toggle failed';
      toast.push(msg, 'error');
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiPost<{ ok: boolean; version?: string }>('/api/plugins/postgresql/test-connection', {
        connectionString: formValues['connectionString'] ?? '',
      });
      setTestResult({ ok: true, version: res.version });
    } catch (e: unknown) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : 'Connection failed' });
    }
    setTesting(false);
  }

  async function loadComparison() {
    if (comparison) { setShowComparison(!showComparison); return; }
    try {
      const res = await apiGet<{ comparison: ComparisonRow[] }>('/api/plugins/postgresql/comparison');
      setComparison(res.comparison);
      setShowComparison(true);
    } catch {
      toast.push('Failed to load comparison', 'error');
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h2>Plugin</h2>
        </div>
        <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>Loading...</div>
      </div>
    );
  }

  if (!plugin) {
    return (
      <div className="page">
        <div className="page-header">
          <h2>Plugin</h2>
        </div>
        <div className="empty-state">
          <p>Plugin not found.</p>
          <button className="btn btn-sm" onClick={() => navigate('/plugins')}>Back to Plugin Hub</button>
        </div>
      </div>
    );
  }

  const fields = catalogEntry?.config ?? {};

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-sm" onClick={() => navigate('/plugins')}>← Back</button>
          <h2 style={{ margin: 0 }}>{plugin.name}</h2>
          <span className="plugin-version">v{plugin.version}</span>
        </div>
      </div>

      <div className="plugin-detail-card">
        <p className="plugin-detail-desc">{plugin.description}</p>
        <div className="plugin-detail-meta">
          <div className="plugin-detail-row">
            <span className="plugin-detail-label">Status</span>
            <span className={`plugin-status ${plugin.enabled ? 'enabled' : 'disabled'}`}>
              {plugin.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <button className="btn btn-sm" onClick={handleToggle} style={{ marginLeft: 8 }}>
              {plugin.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
          <div className="plugin-detail-row">
            <span className="plugin-detail-label">Category</span>
            <span>{plugin.category}</span>
          </div>
          <div className="plugin-detail-row">
            <span className="plugin-detail-label">Installed</span>
            <span>{new Date(plugin.installedAt).toLocaleDateString()}</span>
          </div>
          {plugin.isBuiltin && (
            <div className="plugin-detail-row">
              <span className="plugin-detail-label">Type</span>
              <span className="plugin-builtin-badge">Built-in</span>
            </div>
          )}
        </div>
      </div>

      {Object.keys(fields).length > 0 && (
        <div className="plugin-config-section">
          <h3>Configuration</h3>
          <div className="plugin-config-form">
            {Object.entries(fields).map(([key, field]) => (
              <div key={key} className="form-group">
                <label className="form-label">
                  {field.label}
                  {field.required && <span className="form-required">*</span>}
                </label>
                {field.description && <div className="form-hint">{field.description}</div>}
                {field.type === 'boolean' ? (
                  <select
                    className="form-input"
                    value={formValues[key] ?? String(field.default ?? false)}
                    onChange={(e) => setFormValues({ ...formValues, [key]: e.target.value })}
                  >
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : field.type === 'select' && field.options ? (
                  <select
                    className="form-input"
                    value={formValues[key] ?? String(field.default ?? '')}
                    onChange={(e) => setFormValues({ ...formValues, [key]: e.target.value })}
                  >
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="form-input"
                    type={field.type === 'number' ? 'number' : 'text'}
                    placeholder={String(field.default ?? '')}
                    value={formValues[key] ?? ''}
                    onChange={(e) => setFormValues({ ...formValues, [key]: e.target.value })}
                  />
                )}
              </div>
            ))}
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      )}

      {plugin.id === 'postgresql' && (
        <div className="plugin-pg-section">
          <h3>PostgreSQL Setup</h3>

          {/* Test Connection */}
          {formValues['connectionString'] && (
            <div className="plugin-pg-test">
              <p className="form-hint">After entering a connection string, test connectivity before saving.</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn btn-primary btn-sm" onClick={handleTestConnection} disabled={testing}>
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                {testResult && (
                  <span style={{ color: testResult.ok ? '#8c8' : '#c88', fontSize: '0.85rem' }}>
                    {testResult.ok ? `Connected — ${testResult.version ?? ''}` : `Failed: ${testResult.error}`}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* DB Comparison */}
          <div className="plugin-pg-comparison">
            <button className="btn btn-sm" onClick={loadComparison}>
              {showComparison ? 'Hide' : 'Show'} SQLite vs PostgreSQL Comparison
            </button>
            {showComparison && comparison && (
              <table className="comparison-table">
                <thead>
                  <tr><th>Feature</th><th>SQLite</th><th>PostgreSQL</th></tr>
                </thead>
                <tbody>
                  {comparison.map((row, i) => (
                    <tr key={i}>
                      <td className="comparison-feature">{row.feature}</td>
                      <td className="comparison-sqlite">{row.sqlite}</td>
                      <td className="comparison-pg">{row.postgresql}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
