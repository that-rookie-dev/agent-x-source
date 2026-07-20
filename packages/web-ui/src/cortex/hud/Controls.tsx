import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { glassPanel } from './hudStyles';

export interface ControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onRelayout: () => void;
  relayoutBusy: boolean;
}

const btnSx = {
  color: 'rgba(199,210,240,0.85)',
  borderRadius: '8px',
  '&:hover': { bgcolor: 'rgba(125,145,255,0.12)', color: '#fff' },
};

export function Controls({ onZoomIn, onZoomOut, onFit, onRelayout, relayoutBusy }: ControlsProps) {
  return (
    <Box sx={{ ...glassPanel, position: 'absolute', bottom: 16, right: 16, display: 'flex', flexDirection: 'column', p: 0.5, gap: 0.25, pointerEvents: 'auto' }}>
      <Tooltip title="Zoom in" placement="left"><IconButton size="small" sx={btnSx} onClick={onZoomIn}><AddIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
      <Tooltip title="Zoom out" placement="left"><IconButton size="small" sx={btnSx} onClick={onZoomOut}><RemoveIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
      <Tooltip title="Fit cortex" placement="left"><IconButton size="small" sx={btnSx} onClick={onFit}><CenterFocusStrongIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
      <Tooltip title="Re-map cortex — recompute regions & layout" placement="left">
        <span>
          <IconButton size="small" sx={btnSx} onClick={onRelayout} disabled={relayoutBusy}>
            {relayoutBusy ? <CircularProgress size={15} sx={{ color: '#8fb4ff' }} /> : <AutoFixHighIcon sx={{ fontSize: 17 }} />}
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}
