import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import { auth } from '../api';
import { useApp } from '../store/AppContext';
import { useGlobalError } from '../components/ErrorBand';
import { colors } from '../theme';

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  if (!pw) return { score: 0, label: '', color: colors.text.dim };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)) score++;
  if (pw.length >= 16) score++;

  if (score <= 2) return { score: Math.round((score / 7) * 100), label: 'WEAK', color: colors.accent.red };
  if (score <= 4) return { score: Math.round((score / 7) * 100), label: 'FAIR', color: colors.accent.orange };
  if (score <= 5) return { score: Math.round((score / 7) * 100), label: 'GOOD', color: colors.accent.blue };
  return { score: Math.round((score / 7) * 100), label: 'STRONG', color: colors.accent.green };
}

export function SetupAuth() {
  const { setAuthState } = useApp();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { showError, clearError } = useGlobalError();
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const strength = useMemo(() => getPasswordStrength(password), [password]);

  // Starfield background effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const stars: { x: number; y: number; r: number; speed: number; opacity: number }[] = [];

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 150; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.3,
        speed: Math.random() * 0.3 + 0.05,
        opacity: Math.random() * 0.8 + 0.2,
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const star of stars) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity * (0.5 + 0.5 * Math.sin(Date.now() * star.speed * 0.003))})`;
        ctx.fill();
        star.y += star.speed;
        if (star.y > canvas.height) { star.y = 0; star.x = Math.random() * canvas.width; }
      }
      animId = requestAnimationFrame(animate);
    };
    animate();

    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (username.length < 3) { showError('Username must be at least 3 characters'); return; }
    if (password.length < 8) { showError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { showError('Passwords do not match'); return; }

    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      showError('Password must contain uppercase, lowercase, number, and special character');
      return;
    }

    setLoading(true);
    try {
      await auth.setup(username, password);
      setAuthState('needs-setup');
      navigate('/setup/wizard');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{
      height: '100vh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: '#000', position: 'relative', overflow: 'hidden',
    }}>
      {/* Starfield canvas */}
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      {/* Scanline overlay */}
      <Box sx={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none', opacity: 0.03,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255,255,255,0.03) 1px, rgba(255,255,255,0.03) 2px)',
      }} />

      {/* Main content */}
      <Box sx={{ position: 'relative', zIndex: 2, width: 400, maxWidth: '90vw' }}>
        {/* ASCII Logo */}
        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Box sx={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', lineHeight: 1,
            color: '#ffffff', whiteSpace: 'pre', letterSpacing: '-0.5px',
            textShadow: `0 0 10px rgba(255,255,255,0.1)`,
            mb: 2,
          }}>
{` █████╗  ██████╗ ███████╗███╗   ██╗████████╗    ██╗  ██╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝    ╚██╗██╔╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║  █████╗╚███╔╝ 
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║  ╚════╝██╔██╗ 
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║       ██╔╝ ██╗
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝       ╚═╝  ╚═╝`}
          </Box>

          <Typography sx={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem',
            color: colors.text.dim, letterSpacing: '3px', mb: 1.5,
          }}>
            INITIAL SETUP TERMINAL
          </Typography>

          <Typography sx={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem',
            color: colors.accent.green, minHeight: '1.2em',
          }}>
            Create root user to proceed...
          </Typography>
        </Box>

        {/* Setup form */}
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{
            border: `1px solid ${colors.border.default}`,
            borderRadius: '6px',
            bgcolor: colors.bg.secondary,
            p: 3,
            backdropFilter: 'blur(8px)',
          }}
        >
          {/* Terminal bar */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 2.5, pb: 1.5, borderBottom: `1px solid ${colors.border.default}` }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: colors.accent.red }} />
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: colors.accent.orange }} />
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: colors.accent.green }} />
            <Typography sx={{ ml: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', color: colors.text.dim }}>
              setup@agent-x
            </Typography>
          </Box>

          {/* Username field */}
          <Box sx={{ mb: 2 }}>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem',
              color: colors.text.dim, letterSpacing: '1px', mb: 0.5,
            }}>
              USERNAME
            </Typography>
            <Box
              component="input"
              type="text"
              value={username}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              sx={{
                width: '100%', px: 1.5, py: 1,
                bgcolor: colors.bg.primary,
                border: `1px solid ${colors.border.default}`,
                borderRadius: '3px',
                color: colors.text.primary,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.75rem',
                outline: 'none',
                '&:focus': { borderColor: colors.accent.blue + '80' },
                '&::placeholder': { color: colors.text.dim },
              }}
              placeholder="admin"
            />
          </Box>

          {/* Password field */}
          <Box sx={{ mb: 2 }}>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem',
              color: colors.text.dim, letterSpacing: '1px', mb: 0.5,
            }}>
              PASSWORD
            </Typography>
            <Box
              component="input"
              type="password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              autoComplete="new-password"
              sx={{
                width: '100%', px: 1.5, py: 1,
                bgcolor: colors.bg.primary,
                border: `1px solid ${colors.border.default}`,
                borderRadius: '3px',
                color: colors.text.primary,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.75rem',
                outline: 'none',
                '&:focus': { borderColor: colors.accent.blue + '80' },
                '&::placeholder': { color: colors.text.dim },
              }}
              placeholder="••••••••"
            />
          </Box>

          {/* Password strength */}
          {password && (
            <Box sx={{ mb: 2, px: 0.5 }}>
              <LinearProgress
                variant="determinate"
                value={strength.score}
                sx={{
                  height: 4,
                  borderRadius: 2,
                  bgcolor: colors.bg.tertiary,
                  '& .MuiLinearProgress-bar': {
                    bgcolor: strength.color,
                    borderRadius: 2,
                    transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s ease',
                  },
                }}
              />
              <Typography
                sx={{
                  mt: 0.3,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.5rem',
                  letterSpacing: '2px',
                  color: strength.color,
                  transition: 'color 0.3s ease',
                }}
              >
                {strength.label}
              </Typography>
            </Box>
          )}

          {/* Confirm password field */}
          <Box sx={{ mb: 3 }}>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem',
              color: colors.text.dim, letterSpacing: '1px', mb: 0.5,
            }}>
              CONFIRM PASSWORD
            </Typography>
            <Box
              component="input"
              type="password"
              value={confirmPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              sx={{
                width: '100%', px: 1.5, py: 1,
                bgcolor: colors.bg.primary,
                border: `1px solid ${colors.border.default}`,
                borderRadius: '3px',
                color: colors.text.primary,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.75rem',
                outline: 'none',
                '&:focus': { borderColor: colors.accent.blue + '80' },
                '&::placeholder': { color: colors.text.dim },
              }}
              placeholder="••••••••"
            />
          </Box>

          {/* Submit button */}
          <Button
            type="submit"
            fullWidth
            disabled={loading || !username || !password || !confirmPassword}
            sx={{
              py: 1.2,
              bgcolor: colors.text.primary,
              color: colors.bg.primary,
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
              fontSize: '0.7rem',
              letterSpacing: '2px',
              borderRadius: '3px',
              '&:hover': { bgcolor: '#ddd' },
              '&:disabled': { bgcolor: colors.border.strong, color: colors.text.dim },
            }}
          >
            {loading ? 'CREATING...' : 'CREATE ACCOUNT & CONTINUE'}
          </Button>
        </Box>

        {/* Footer */}
        <Typography sx={{
          textAlign: 'center', mt: 2.5,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.45rem', color: colors.text.dim, letterSpacing: '1px',
        }}>
          COOKIE-BASED SESSION • AES-256-GCM • AUTO-EXPIRES
        </Typography>
      </Box>
    </Box>
  );
}
