import { useState } from 'react';
import { setupAuth } from '../api';
import { useToast } from '../components/ToastProvider';

interface Props {
  onComplete: () => void;
}

export default function SetupAuth({ onComplete }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const toastCtx = useToast();

  const validatePassword = (pwd: string): string | null => {
    if (pwd.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(pwd)) return 'Password must contain an uppercase letter';
    if (!/[a-z]/.test(pwd)) return 'Password must contain a lowercase letter';
    if (!/[0-9]/.test(pwd)) return 'Password must contain a number';
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)) return 'Password must contain a special character';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || username.trim().length < 3) {
      toastCtx?.push('Username must be at least 3 characters', 'warn');
      return;
    }

    const pwdError = validatePassword(password);
    if (pwdError) {
      toastCtx?.push(pwdError, 'warn');
      return;
    }

    if (password !== confirmPassword) {
      toastCtx?.push('Passwords do not match', 'warn');
      return;
    }

    setLoading(true);
    try {
      await setupAuth(username.trim(), password);
      toastCtx?.push('Root user created successfully', 'success');
      onComplete();
    } catch (err: any) {
      toastCtx?.push(err.message || 'Setup failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const pwdStrength = (() => {
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++;
    return score;
  })();

  const strengthLabels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const strengthColors = ['#c44', '#c84', '#cc4', '#8c4', '#4c4', '#4c8'];
  const strengthIndex = Math.min(pwdStrength, strengthLabels.length - 1);

  return (
    <div className="wizard" style={{ maxWidth: 480, paddingTop: '10vh' }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1" style={{ margin: '0 auto', opacity: 0.6 }}>
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div className="wizard-title" style={{ fontSize: '1.6rem' }}>Secure Your Agent</div>
        <div className="wizard-desc">
          Create a root user to protect your Agent-X instance.
          <br />
          Your password will encrypt all stored data including API keys.
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label className="label">Username</label>
          <input
            className="input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Choose a username (min 3 characters)"
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
            placeholder="Create a strong password"
            autoComplete="new-password"
          />
          {password && (
              <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1, height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${(pwdStrength / 6) * 100}%`,
                      background: strengthColors[strengthIndex],
                      transition: 'all .3s',
                      borderRadius: 2,
                    }}
                  />
                </div>
                <span style={{ fontSize: '0.7rem', color: strengthColors[strengthIndex], fontWeight: 600 }}>
                  {strengthLabels[strengthIndex]}
                </span>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#555' }}>
                Min 8 chars, uppercase, lowercase, number, special char
              </div>
            </div>
          )}
        </div>

        <div className="field">
          <label className="label">Confirm Password</label>
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            autoComplete="new-password"
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
              'Create Root User'
            )}
          </button>
        </div>
      </form>

      <div style={{ marginTop: 32, padding: 16, background: '#0a0a0a', borderRadius: 8, border: '1px solid #1a1a1a' }}>
        <div style={{ fontSize: '0.75rem', color: '#888', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
          Security Architecture
        </div>
        <div style={{ fontSize: '0.75rem', color: '#666', lineHeight: 1.7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: '#4c8' }}>●</span>
            Scrypt memory-hard key derivation (resistant to GPU/ASIC attacks)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: '#4c8' }}>●</span>
            AES-256-GCM authenticated encryption with random IV per operation
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ color: '#4c8' }}>●</span>
            Data Encryption Key (DEK) is never stored in plaintext
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#c44' }}>●</span>
            Self-destruct: if credentials are tampered, all data is permanently lost
          </div>
        </div>
      </div>
    </div>
  );
}
