import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api';
import { useToast } from '../components/ToastProvider';

interface Crew {
  id: string;
  name: string;
  systemPrompt: string;
  emotion?: string;
  isDefault?: boolean;
}

const EMOTIONS = ['professional', 'friendly', 'witty', 'kind', 'funny', 'arrogant', 'flirty', 'happy', 'sad', 'sarcastic'];

export default function Crews() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [activeId, setActiveId] = useState('');
  const [editing, setEditing] = useState<Crew | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const toast = useToast();

  // New crew form
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('You are a helpful AI assistant.');
  const [newEmotion, setNewEmotion] = useState('professional');

  async function load() {
    try {
      const data = await apiGet<{ crews: Crew[]; activeId: string }>('/api/crews');
      setCrews(data.crews);
      setActiveId(data.activeId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load crews';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!newName.trim()) return;
    const id = `crew-${Date.now()}`;
    try {
      try { toast.clear(); } catch { /* ignore */ }
      await apiPost('/api/crews', { id, name: newName, systemPrompt: newPrompt, emotion: newEmotion });
      setNewName('');
      setNewPrompt('You are a helpful AI assistant.');
      setNewEmotion('professional');
      setCreating(false);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create crew';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function updateCrew() {
    if (!editing) return;
    try {
      try { toast.clear(); } catch { /* ignore */ }
      await apiPut(`/api/crews/${editing.id}`, {
        name: editing.name,
        systemPrompt: editing.systemPrompt,
        emotion: editing.emotion,
      });
      setEditing(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update crew';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function deleteCrew(id: string) {
    setConfirmDelete(null);
    try {
      try { toast.clear(); } catch { /* ignore */ }
      await apiDelete(`/api/crews/${id}`);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete crew';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  async function switchCrew(id: string) {
    try {
      try { toast.clear(); } catch { /* ignore */ }
      await apiPost('/api/crew/switch', { id });
      setActiveId(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to switch crew';
      try { toast.push(msg, 'error'); } catch { /* ignore */ }
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-label">Management</div>
          <div className="topbar-value">Crews</div>
        </div>
        <div className="topbar-right">
          <button className="btn btn-sm btn-secondary" onClick={() => setCreating(!creating)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ width: 12, height: 12 }}><path d="M8 3v10M3 8h10"/></svg>
            New Crew
          </button>
        </div>
      </div>

      <div className="page-scroll">
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto', width: '100%' }}>
          {/* Create form */}
          {creating && (
            <div className="card mb-16">
              <div className="card-title mb-16">Create Crew</div>
              <div className="field">
                <label className="label">Name</label>
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Crew name" />
              </div>
              <div className="field">
                <label className="label">System Prompt</label>
                <textarea className="input" value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} rows={3} style={{ resize: 'vertical' }} />
              </div>
              <div className="field">
                <label className="label">Tone</label>
                <select className="select" value={newEmotion} onChange={(e) => setNewEmotion(e.target.value)}>
                  {EMOTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div className="wizard-actions">
                <button className="btn btn-primary btn-sm" onClick={create}>Create</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </div>
          )}

          {/* Crew list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {crews.map((crew) => (
              editing?.id === crew.id ? (
                <div key={crew.id} className="card">
                  <div className="field">
                    <label className="label">Name</label>
                    <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="label">System Prompt</label>
                    <textarea className="input" value={editing.systemPrompt} onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })} rows={3} style={{ resize: 'vertical' }} />
                  </div>
                  <div className="field">
                    <label className="label">Tone</label>
                    <select className="select" value={editing.emotion} onChange={(e) => setEditing({ ...editing, emotion: e.target.value })}>
                      {EMOTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-8">
                    <button className="btn btn-sm btn-primary" onClick={updateCrew}>Save</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={crew.id} className="card" style={{ borderColor: crew.id === activeId ? '#444' : undefined }}>
                  <div className="card-header">
                    <div>
                      <div className="card-title">{crew.name}</div>
                      <div className="card-subtitle">{crew.emotion} &middot; {crew.id === activeId ? 'Active' : ''}</div>
                    </div>
                    <div className="flex gap-8">
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...crew })}>Edit</button>
                      {crew.id !== activeId && (
                        <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(crew.id)}>Delete</button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#777', lineHeight: 1.6 }}>{crew.systemPrompt}</div>
                  {crew.id !== activeId && (
                    <button className="btn btn-sm btn-secondary mt-8" onClick={() => switchCrew(crew.id)}>Switch to this crew</button>
                  )}
                </div>
              )
            ))}
          </div>

          {crews.length === 0 && (
            <div className="card" style={{ textAlign: 'center', color: '#666', padding: 40 }}>
              No crews yet. Create one to get started.
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)}>
          <div className="overlay-box" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-title">Delete Crew?</div>
            <div className="overlay-desc">This will permanently delete this crew member and its settings. This cannot be undone.</div>
            <div className="wizard-actions" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-secondary" style={{ borderColor: '#442222', color: '#ff6b6b' }} onClick={() => deleteCrew(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
