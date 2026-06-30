import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import HubIcon from '@mui/icons-material/Hub';
import AddIcon from '@mui/icons-material/Add';
import GroupsIcon from '@mui/icons-material/Groups';
import { crewTheme } from '../../styles/crew-theme';
import { PanelHeader } from '../PanelHeader';

interface CrewScreenHeaderProps {
  crewCount: number;
  activeCount: number;
  onOpenHub: () => void;
  onCreate: () => void;
}

export function CrewScreenHeader({ crewCount, activeCount, onOpenHub, onCreate }: CrewScreenHeaderProps) {
  return (
    <PanelHeader
      title="Crews"
      subtitle={`${crewCount} deployed · ${activeCount} active`}
      icon={<GroupsIcon sx={{ fontSize: 20 }} />}
      action={
        <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<HubIcon sx={{ fontSize: 14 }} />}
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
      }
    />
  );
}
