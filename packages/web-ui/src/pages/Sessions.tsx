import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiDelete, apiPost } from '../api';
import { useToast } from '../components/ToastProvider';

interface Session {
  id: string;
  title: string;
  status: string;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
}

export default function Sessions() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    try {
      const data = await apiGet<Session[]>('/api/sessions');
      setSessions(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load sessions';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  useEffect(() => { load(); }, []);

  async function deleteSession(id: string) {
    setConfirmDelete(null);
    try {
      try { toast.clear(); } catch { /* ignore */ }
      await apiDelete(`/api/sessions/${id}`);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      try { toast.push('Session deleted', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete session';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function restoreSession(id: string) {
    try {
      try { toast.clear(); } catch { /* ignore */ }
      navigate(`/chat?session_id=${encodeURIComponent(id)}`);
      try { toast.push('Session restored', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to restore session';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function viewSession(id: string) {
    try {
      const data = await apiGet(`/api/sessions/${id}`);
      setDetail(data as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load session';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function createNew() {
    try {
      try { toast.clear(); } catch { /* ignore */ }
      const data = await apiPost<{ sessionId: string }>('/api/sessions');
      navigate(`/chat?session_id=${encodeURIComponent(data.sessionId)}`);
      await load();
      try { toast.push('New session created', 'success'); } catch { /* ignore */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create session';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString();
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">Management</div>
          <div className="topbar-value">Sessions</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-sm btn-secondary" onClick={createNew}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}><path d="M8 3v10M3 8h10"/></svg>
            New Session
          </button>
        </div>
      </div>

      <div className="page-scroll">
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto', width: '100%' }}>
          {/* Detail overlay */}
          {detail && (
            <div className="overlay" onClick={() => setDetail(null)}>
              <div className="overlay-box" onClick={(e) => e.stopPropagation()}>
                <button className="overlay-close" onClick={() => setDetail(null)}>&times;</button>
                <div className="overlay-title">Session Details</div>
                <pre style={{ background: '#080808', padding: 16, borderRadius: 8, fontSize: '0.75rem', color: '#aaa', overflow: 'auto', maxHeight: 400 }}>
                  {JSON.stringify(detail, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sessions.map((s) => (
              <div key={s.id} className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">{s.title}</div>
                    <div className="card-subtitle">
                      {s.providerId} / {s.modelId?.split('/').pop()} &middot; {formatDate(s.createdAt)}
                    </div>
                  </div>
                  <div className="flex gap-8">
                    <button className="btn btn-sm btn-ghost" onClick={() => viewSession(s.id)}>View</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => restoreSession(s.id)}>Restore</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(s.id)}>Delete</button>
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#555' }}>
                  Status: {s.status} &middot; Updated: {formatDate(s.updatedAt)}
                </div>
              </div>
            ))}
          </div>

          {sessions.length === 0 && (
            <div className="card" style={{ textAlign: 'center', color: '#666', padding: 40 }}>
              No sessions yet. Start a chat to create one.
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-title">Delete Session?</div>
            <div className="overlay-desc">This will permanently delete this session and all its messages. This cannot be undone.</div>
            <div className="wizard-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-secondary" style={{ borderColor: '#442222', color: '#ff6b6b' }} onClick={() => deleteSession(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
