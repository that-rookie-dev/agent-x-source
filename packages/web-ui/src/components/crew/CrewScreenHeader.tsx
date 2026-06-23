import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import HubIcon from '@mui/icons-material/Hub';
import AddIcon from '@mui/icons-material/Add';
import GroupsIcon from '@mui/icons-material/Groups';
import { crewOverlineSx, crewTheme } from '../../styles/crew-theme';

interface CrewScreenHeaderProps {
  crewCount: number;
  activeCount: number;
  onOpenHub: () => void;
  onCreate: () => void;
}

export function CrewScreenHeader({ crewCount, activeCount, onOpenHub, onCreate }: CrewScreenHeaderProps) {
  return (
    <Box sx={{
      flexShrink: 0, px: 2.5, pt: 2, pb: 1.5,
      borderBottom: `1px solid ${crewTheme.border.subtle}`,
      bgcolor: crewTheme.bg.panel,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: '8px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: crewTheme.bg.inset,
            border: `1px solid ${crewTheme.border.default}`,
          }}>
            <GroupsIcon sx={{ color: crewTheme.text.primary, fontSize: 20 }} />
          </Box>
          <Box>
            <Typography sx={crewOverlineSx}>Personnel Roster</Typography>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.95rem', fontWeight: 700, letterSpacing: '1px',
              color: crewTheme.text.primary, lineHeight: 1.2,
            }}>
              CREW COMMAND
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
              <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.secondary }}>
                {crewCount} deployed
              </Typography>
              <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: crewTheme.text.dim }} />
              <Typography sx={{ fontSize: '0.65rem', color: crewTheme.accent.signal }}>
                {activeCount} active
              </Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<HubIcon sx={{ fontSize: 5.4 }} />}
            onClick={onOpenHub}
            sx={{
              borderColor: crewTheme.border.strong,
              color: crewTheme.text.primary,
              fontSize: '0.65rem',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.5px',
              px: 1.25, py: 0.5, minHeight: 30,
              '&:hover': { borderColor: crewTheme.text.primary, bgcolor: crewTheme.bg.cardHover },
            }}
          >
            CREW HUB
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon sx={{ fontSize: 15 }} />}
            onClick={onCreate}
            sx={{
              bgcolor: crewTheme.text.primary,
              color: crewTheme.bg.void,
              fontSize: '0.65rem',
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: '0.5px',
              fontWeight: 700,
              px: 1.25, py: 0.5, minHeight: 30,
              '&:hover': { bgcolor: '#e0e0e0' },
            }}
          >
            RECRUIT
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
