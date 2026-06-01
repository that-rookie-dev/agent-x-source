import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LockIcon from '@mui/icons-material/Lock';
import { auth } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

export function SetupAuth() {
  const { setView, setAuthenticated } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (username.length < 3) { setError('Username must be at least 3 characters'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setError('Password must contain uppercase, lowercase, number, and special character');
      return;
    }

    setLoading(true);
    try {
      await auth.setup(username, password);
      setAuthenticated(true, username);
      setView('setup-wizard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Box sx={{ width: 400, maxWidth: '90vw' }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <LockIcon sx={{ fontSize: 40, color: colors.accent.blue, mb: 1 }} />
          <Typography variant="h2" sx={{ mb: 1 }}>CREATE ROOT USER</Typography>
          <Typography variant="body2" sx={{ color: colors.text.tertiary }}>
            Set up credentials for your Agent-X console
          </Typography>
        </Box>

        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {error && <Alert severity="error" sx={{ bgcolor: '#1a0000', border: `1px solid ${colors.accent.red}40` }}>{error}</Alert>}

          <TextField
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            fullWidth
            inputProps={{ minLength: 3 }}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            helperText="Min 8 chars: uppercase, lowercase, number, special"
          />
          <TextField
            label="Confirm Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            fullWidth
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ mt: 1, py: 1.2, bgcolor: colors.text.primary, color: colors.bg.primary, fontWeight: 600, '&:hover': { bgcolor: '#ccc' } }}
          >
            {loading ? 'Creating...' : 'Create Account & Continue'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
