import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import type { CrewMatchCandidate } from '@agentx/shared/browser';
import { crewTheme } from '../../styles/crew-theme';
import { colors, alphaColor } from '../../theme';
import { MedicalCrewCardStripe } from './MedicalDisclaimerBanner';

function originLabel(origin: CrewMatchCandidate['origin']): string {
  if (origin === 'custom') return 'CLASSIFIED · CUSTOM';
  if (origin === 'hub_roster') return 'ROSTER · ACTIVE';
  return 'HUB · RECRUIT';
}

function rankAccent(rank: number): string {
  if (rank === 1) return crewTheme.text.primary;
  if (rank === 2) return crewTheme.text.secondary;
  return crewTheme.text.dim;
}

export interface CrewRecruitCardProps {
  candidate: CrewMatchCandidate;
  rank: number;
  selected: boolean;
  onToggle: () => void;
  onViewDossier?: () => void;
  isMedical: boolean;
}

/** Match-score recruit card — shared by suggestion modal and in-chat roster picker. */
export function CrewRecruitCard({
  candidate,
  rank,
  selected,
  onToggle,
  onViewDossier,
  isMedical,
}: CrewRecruitCardProps) {
  const pct = Math.round(candidate.matchScore * 100);
  const topReason = candidate.reasons[0];

  return (
    <Box
      onClick={onToggle}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 196,
        border: `1px solid ${selected ? crewTheme.accent.tactical : crewTheme.border.default}`,
        borderRadius: '8px',
        overflow: 'hidden',
        cursor: 'pointer',
        bgcolor: selected ? alphaColor(colors.ink, 0.04) : crewTheme.bg.card,
        transition: 'border-color 0.15s, background-color 0.15s',
        '&:hover': { borderColor: crewTheme.border.strong, bgcolor: crewTheme.bg.cardHover },
      }}
    >
      {isMedical && <MedicalCrewCardStripe />}
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, p: 1.35, position: 'relative', minHeight: 0 }}>
        <Box sx={{
          position: 'absolute',
          top: 10,
          left: 10,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: rank === 1 ? '0.82rem' : '0.68rem',
          fontWeight: rank <= 2 ? 700 : 500,
          color: rankAccent(rank),
          opacity: rank === 1 ? 0.9 : 0.55,
          lineHeight: 1,
          letterSpacing: '-0.5px',
        }}>
          {String(rank).padStart(2, '0')}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', mb: 0.5, minHeight: 22 }}>
          <Checkbox
            size="small"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggle}
            sx={{ p: 0.25, mt: -0.25, color: crewTheme.text.dim, '&.Mui-checked': { color: crewTheme.accent.tactical } }}
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, pl: 0.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.45, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={originLabel(candidate.origin)}
              sx={{
                height: 18,
                fontSize: '0.48rem',
                fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: '0.4px',
                bgcolor: 'transparent',
                border: `1px solid ${crewTheme.border.default}`,
                color: crewTheme.text.dim,
              }}
            />
            {candidate.onRoster && (
              <Chip
                size="small"
                label="ON ROSTER"
                sx={{
                  height: 18,
                  fontSize: '0.48rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  bgcolor: 'transparent',
                  border: `1px solid ${crewTheme.border.subtle}`,
                  color: crewTheme.text.dim,
                }}
              />
            )}
          </Box>

          <Typography sx={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.74rem',
            fontWeight: 700,
            color: crewTheme.text.primary,
            lineHeight: 1.25,
            mb: 0.25,
          }}>
            {candidate.name}
          </Typography>

          <Typography sx={{
            fontSize: '0.6rem',
            color: crewTheme.text.secondary,
            lineHeight: 1.35,
            mb: 0.5,
          }}>
            {candidate.title}
            {candidate.categoryLabel ? ` · ${candidate.categoryLabel}` : ''}
          </Typography>

          {candidate.description && (
            <Typography sx={{
              fontSize: '0.58rem',
              color: crewTheme.text.dim,
              lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              mb: 0.6,
            }}>
              {candidate.description}
            </Typography>
          )}

          {topReason && (
            <Typography sx={{
              fontSize: '0.55rem',
              color: crewTheme.text.secondary,
              fontStyle: 'italic',
              lineHeight: 1.35,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              mb: 0.65,
            }}>
              {topReason}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.35, mb: 0.75 }}>
            {candidate.expertise.slice(0, 4).map((e) => (
              <Chip key={e} label={e} size="small" sx={{
                height: 18,
                fontSize: '0.5rem',
                bgcolor: crewTheme.bg.void,
                color: crewTheme.text.dim,
                border: `1px solid ${crewTheme.border.subtle}`,
              }} />
            ))}
          </Box>
        </Box>

        <Box sx={{ mt: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.52rem',
              color: crewTheme.text.dim,
              letterSpacing: '0.5px',
            }}>
              {pct}% FIT
            </Typography>
            {onViewDossier && (
              <Button
                size="small"
                variant="outlined"
                onClick={(e) => { e.stopPropagation(); onViewDossier(); }}
                sx={{
                  minWidth: 0,
                  py: 0.15,
                  px: 0.85,
                  fontSize: '0.52rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  textTransform: 'none',
                  letterSpacing: '0.3px',
                  color: crewTheme.text.secondary,
                  borderColor: crewTheme.border.default,
                  '&:hover': { borderColor: crewTheme.border.strong, bgcolor: crewTheme.bg.void },
                }}
              >
                View details
              </Button>
            )}
          </Box>
          <LinearProgress
            variant="determinate"
            value={pct}
            sx={{
              height: 3,
              borderRadius: 2,
              bgcolor: crewTheme.bg.void,
              '& .MuiLinearProgress-bar': { bgcolor: rank === 1 ? crewTheme.accent.tactical : crewTheme.text.dim },
            }}
          />
        </Box>
      </Box>
    </Box>
  );
}
