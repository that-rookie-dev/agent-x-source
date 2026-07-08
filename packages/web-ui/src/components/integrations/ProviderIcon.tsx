import Box from '@mui/material/Box';
import HubIcon from '@mui/icons-material/Hub';
import FlightIcon from '@mui/icons-material/Flight';
import MapIcon from '@mui/icons-material/Map';
import HotelIcon from '@mui/icons-material/Hotel';
import StorefrontIcon from '@mui/icons-material/Storefront';
import PaymentsIcon from '@mui/icons-material/Payments';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import HomeIcon from '@mui/icons-material/Home';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import SpeakerIcon from '@mui/icons-material/Speaker';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import ChatIcon from '@mui/icons-material/Chat';
import MailIcon from '@mui/icons-material/Mail';
import SmsIcon from '@mui/icons-material/Sms';
import VideoCallIcon from '@mui/icons-material/VideoCall';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import NotesIcon from '@mui/icons-material/Notes';
import SearchIcon from '@mui/icons-material/Search';
import StorageIcon from '@mui/icons-material/Storage';
import FolderIcon from '@mui/icons-material/Folder';
import LanguageIcon from '@mui/icons-material/Language';
import PsychologyIcon from '@mui/icons-material/Psychology';
import BugReportIcon from '@mui/icons-material/BugReport';
import CodeIcon from '@mui/icons-material/Code';
import { settingsTheme } from '../../styles/settings-theme';

import { alphaColor } from '../../theme';
const ICON_MAP: Record<string, typeof HubIcon> = {
  hub: HubIcon,
  github: CodeIcon,
  notion: NotesIcon,
  linear: CodeIcon,
  slack: ChatIcon,
  discord: ChatIcon,
  telegram: ChatIcon,
  teams: VideoCallIcon,
  mail: MailIcon,
  sms: SmsIcon,
  video: VideoCallIcon,
  support: SupportAgentIcon,
  chat: ChatIcon,
  flight: FlightIcon,
  map: MapIcon,
  hotel: HotelIcon,
  store: StorefrontIcon,
  payments: PaymentsIcon,
  bank: AccountBalanceIcon,
  accounting: AccountBalanceIcon,
  card: PaymentsIcon,
  crypto: PaymentsIcon,
  chart: PaymentsIcon,
  home: HomeIcon,
  light: LightbulbIcon,
  thermostat: ThermostatIcon,
  speaker: SpeakerIcon,
  camera: CameraAltIcon,
  drive: FolderIcon,
  folder: FolderIcon,
  database: StorageIcon,
  web: LanguageIcon,
  search: SearchIcon,
  brain: PsychologyIcon,
  sentry: BugReportIcon,
  jira: CodeIcon,
  asana: NotesIcon,
  monday: NotesIcon,
  clickup: NotesIcon,
  trello: NotesIcon,
  notes: NotesIcon,
};

export interface ProviderIconProps {
  icon: string;
  size?: number;
  accent?: string;
}

export function ProviderIcon({ icon, size = 40, accent }: ProviderIconProps) {
  const Icon = ICON_MAP[icon] ?? HubIcon;
  const color = accent ?? settingsTheme.accent.hud;
  return (
    <Box sx={{
      width: size,
      height: size,
      borderRadius: '14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: `${alphaColor(color, '18')}`,
      border: `1px solid ${alphaColor(color, '33')}`,
      flexShrink: 0,
    }}>
      <Icon sx={{ fontSize: size * 0.5, color }} />
    </Box>
  );
}
