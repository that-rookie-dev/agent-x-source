import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import { auth } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

export function Login() {
  const { setAuthenticated, initialize } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.login(username, password);
      setAuthenticated(true, res.username);
      // Re-initialize to determine next view
      await initialize();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Box sx={{ width: 380, maxWidth: '90vw' }}>
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <LockOpenIcon sx={{ fontSize: 40, color: colors.accent.blue, mb: 1 }} />
          <Typography variant="h2" sx={{ mb: 1 }}>AUTHENTICATE</Typography>
          <Typography variant="body2" sx={{ color: colors.text.tertiary }}>
            Enter your credentials to access Agent-X
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
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
          />
          <Button
            type="submit"
            variant="contained"
            disabled={loading || !username || !password}
            sx={{ mt: 1, py: 1.2, bgcolor: colors.text.primary, color: colors.bg.primary, fontWeight: 600, '&:hover': { bgcolor: '#ccc' } }}
          >
            {loading ? 'Authenticating...' : 'Login'}
          </Button>
        </Box>

        <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 3, color: colors.text.dim }}>
          Sessions are cookie-based • Auto-expires after inactivity
        </Typography>
      </Box>
    </Box>
  );
}
