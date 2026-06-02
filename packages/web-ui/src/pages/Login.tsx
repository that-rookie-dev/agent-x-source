import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import { auth } from '../api';
import { useApp } from '../store/AppContext';
import { colors } from '../theme';

export function Login() {
  const { setAuthenticated, initialize } = useApp();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [typedText, setTypedText] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    // Create stars
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

  // Typewriter for subtitle
  useEffect(() => {
    const text = 'Identity verification required...';
    let idx = 0;
    const timer = setInterval(() => {
      idx++;
      setTypedText(text.slice(0, idx));
      if (idx >= text.length) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await auth.login(username, password);
      setAuthenticated(true, res.username);
      await initialize();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
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
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.5rem', lineHeight: 1.1,
            color: colors.accent.blue, whiteSpace: 'pre', letterSpacing: '-0.5px',
            textShadow: `0 0 10px ${colors.accent.blue}40`,
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
            SECURE ACCESS TERMINAL
          </Typography>

          <Typography sx={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.65rem',
            color: colors.accent.green, minHeight: '1.2em',
          }}>
            {typedText}
            <Box component="span" sx={{
              display: 'inline-block', width: 6, height: '1em', bgcolor: colors.accent.green,
              verticalAlign: 'text-bottom', ml: 0.3,
              animation: 'blink 1s step-end infinite',
              '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } },
            }} />
          </Typography>
        </Box>

        {/* Login form */}
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
              auth@agent-x
            </Typography>
          </Box>

          {/* Error */}
          {error && (
            <Box sx={{
              mb: 2, px: 1.5, py: 0.8,
              border: `1px solid ${colors.accent.red}40`,
              borderRadius: '3px',
              bgcolor: colors.accent.red + '10',
            }}>
              <Typography sx={{ fontSize: '0.6rem', color: colors.accent.red, fontFamily: "'JetBrains Mono', monospace" }}>
                ✕ {error}
              </Typography>
            </Box>
          )}

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
              placeholder="operator"
            />
          </Box>

          {/* Password field */}
          <Box sx={{ mb: 3 }}>
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
              autoComplete="current-password"
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
            disabled={loading || !username || !password}
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
            {loading ? 'AUTHENTICATING...' : 'AUTHENTICATE'}
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
