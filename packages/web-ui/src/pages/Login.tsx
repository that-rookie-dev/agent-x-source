import { useState } from 'react';
import { login } from '../api';
import { useToast } from '../components/ToastProvider';

interface Props {
  onLogin: () => void;
}

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const toastCtx = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      toastCtx?.push('Username and password are required', 'warn');
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
      toastCtx?.push('Welcome back', 'success');
      onLogin();
    } catch (err: any) {
      toastCtx?.push(err.message || 'Login failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wizard" style={{ maxWidth: 420, paddingTop: '15vh' }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1" style={{ margin: '0 auto', opacity: 0.6 }}>
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div className="wizard-title" style={{ fontSize: '1.6rem' }}>Agent-X</div>
        <div className="wizard-desc">Secure access to your local AI agent</div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label className="label">Username</label>
          <input
            className="input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your username"
            autoComplete="username"
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
        </div>

        <div className="wizard-actions" style={{ marginTop: 24 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {loading ? (
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            ) : (
              'Sign In'
            )}
          </button>
        </div>
      </form>

      <div style={{ textAlign: 'center', marginTop: 24, fontSize: '0.75rem', color: '#555' }}>
        All data is encrypted at rest using AES-256-GCM.
        <br />
        If credentials are tampered, data self-destructs.
      </div>
    </div>
  );
}
