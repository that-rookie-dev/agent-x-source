import CodeIcon from '@mui/icons-material/Code';
import StorageIcon from '@mui/icons-material/Storage';
import PaletteIcon from '@mui/icons-material/Palette';
import GavelIcon from '@mui/icons-material/Gavel';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SchoolIcon from '@mui/icons-material/School';
import FavoriteIcon from '@mui/icons-material/Favorite';
import HomeIcon from '@mui/icons-material/Home';
import BrushIcon from '@mui/icons-material/Brush';
import GroupsIcon from '@mui/icons-material/Groups';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import CampaignIcon from '@mui/icons-material/Campaign';
import AdsClickIcon from '@mui/icons-material/AdsClick';
import WorkIcon from '@mui/icons-material/Work';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import ApartmentIcon from '@mui/icons-material/Apartment';
import PolicyIcon from '@mui/icons-material/Policy';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import FactoryIcon from '@mui/icons-material/Factory';
import ConstructionIcon from '@mui/icons-material/Construction';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import FlightIcon from '@mui/icons-material/Flight';
import BoltIcon from '@mui/icons-material/Bolt';
import TranslateIcon from '@mui/icons-material/Translate';
import NewspaperIcon from '@mui/icons-material/Newspaper';
import SportsIcon from '@mui/icons-material/Sports';
import LocalFloristIcon from '@mui/icons-material/LocalFlorist';
import StorefrontIcon from '@mui/icons-material/Storefront';
import DirectionsBoatIcon from '@mui/icons-material/DirectionsBoat';
import WebIcon from '@mui/icons-material/Web';
import LayersIcon from '@mui/icons-material/Layers';
import DevicesIcon from '@mui/icons-material/Devices';
import SportsEsportsIcon from '@mui/icons-material/SportsEsports';
import BugReportIcon from '@mui/icons-material/BugReport';
import LanIcon from '@mui/icons-material/Lan';
import DnsIcon from '@mui/icons-material/Dns';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import ScienceIcon from '@mui/icons-material/Science';
import BiotechIcon from '@mui/icons-material/Biotech';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SailingIcon from '@mui/icons-material/Sailing';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import PetsIcon from '@mui/icons-material/Pets';
import MuseumIcon from '@mui/icons-material/Museum';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import LocalPoliceIcon from '@mui/icons-material/LocalPolice';
import SearchIcon from '@mui/icons-material/Search';
import CloudIcon from '@mui/icons-material/Cloud';
import MemoryIcon from '@mui/icons-material/Memory';
import type { CategoryIconId } from '../../data/crew-hub/prebuilt-crews-index';

const ICON_SX = { fontSize: 15 } as const;

const ICON_BY_ID: Record<string, React.ReactNode> = {
  code: <CodeIcon sx={ICON_SX} />,
  web: <WebIcon sx={ICON_SX} />,
  layers: <LayersIcon sx={ICON_SX} />,
  devices: <DevicesIcon sx={ICON_SX} />,
  videogame: <SportsEsportsIcon sx={ICON_SX} />,
  bug_report: <BugReportIcon sx={ICON_SX} />,
  lan: <LanIcon sx={ICON_SX} />,
  database: <DnsIcon sx={ICON_SX} />,
  analytics: <AnalyticsIcon sx={ICON_SX} />,
  cloud: <CloudIcon sx={ICON_SX} />,
  memory: <MemoryIcon sx={ICON_SX} />,
  storage: <StorageIcon sx={ICON_SX} />,
  palette: <PaletteIcon sx={ICON_SX} />,
  gavel: <GavelIcon sx={ICON_SX} />,
  verified: <VerifiedUserIcon sx={ICON_SX} />,
  autoawesome: <AutoAwesomeIcon sx={ICON_SX} />,
  school: <SchoolIcon sx={ICON_SX} />,
  favorite: <FavoriteIcon sx={ICON_SX} />,
  home: <HomeIcon sx={ICON_SX} />,
  brush: <BrushIcon sx={ICON_SX} />,
  groups: <GroupsIcon sx={ICON_SX} />,
  trending: <TrendingUpIcon sx={ICON_SX} />,
  campaign: <CampaignIcon sx={ICON_SX} />,
  ads: <AdsClickIcon sx={ICON_SX} />,
  work: <WorkIcon sx={ICON_SX} />,
  balance: <AccountBalanceIcon sx={ICON_SX} />,
  voice: <RecordVoiceOverIcon sx={ICON_SX} />,
  support: <SupportAgentIcon sx={ICON_SX} />,
  shipping: <LocalShippingIcon sx={ICON_SX} />,
  apartment: <ApartmentIcon sx={ICON_SX} />,
  policy: <PolicyIcon sx={ICON_SX} />,
  volunteer: <VolunteerActivismIcon sx={ICON_SX} />,
  volunteer_activism: <VolunteerActivismIcon sx={ICON_SX} />,
  restaurant: <RestaurantIcon sx={ICON_SX} />,
  factory: <FactoryIcon sx={ICON_SX} />,
  construction: <ConstructionIcon sx={ICON_SX} />,
  landmark: <AccountBalanceOutlinedIcon sx={ICON_SX} />,
  account_balance: <AccountBalanceIcon sx={ICON_SX} />,
  hospital: <LocalHospitalIcon sx={ICON_SX} />,
  local_hospital: <LocalHospitalIcon sx={ICON_SX} />,
  cart: <ShoppingCartIcon sx={ICON_SX} />,
  flight: <FlightIcon sx={ICON_SX} />,
  energy: <BoltIcon sx={ICON_SX} />,
  translate: <TranslateIcon sx={ICON_SX} />,
  news: <NewspaperIcon sx={ICON_SX} />,
  sports: <SportsIcon sx={ICON_SX} />,
  eco: <LocalFloristIcon sx={ICON_SX} />,
  storefront: <StorefrontIcon sx={ICON_SX} />,
  maritime: <DirectionsBoatIcon sx={ICON_SX} />,
  science: <ScienceIcon sx={ICON_SX} />,
  biotech: <BiotechIcon sx={ICON_SX} />,
  rocket_launch: <RocketLaunchIcon sx={ICON_SX} />,
  sailing: <SailingIcon sx={ICON_SX} />,
  agriculture: <AgricultureIcon sx={ICON_SX} />,
  pets: <PetsIcon sx={ICON_SX} />,
  museum: <MuseumIcon sx={ICON_SX} />,
  menu_book: <MenuBookIcon sx={ICON_SX} />,
  police: <LocalPoliceIcon sx={ICON_SX} />,
  forensic: <SearchIcon sx={ICON_SX} />,
};

/** Fallback icons by category id when manifest icon is generic or missing. */
const ICON_BY_CATEGORY_ID: Partial<Record<string, CategoryIconId>> = {
  'frontend-engineering': 'web',
  'platform-fullstack': 'layers',
  'mobile-embedded-iot': 'devices',
  'game-graphics-realtime': 'videogame',
  'quality-testing': 'bug_report',
  'networking-systems': 'lan',
  'database-infrastructure': 'database',
  'data-engineering-analytics': 'analytics',
  'devops-cloud-sre': 'cloud',
  'government-executive-legislative': 'landmark',
  'government-regulatory-agencies': 'policy',
  'immigration-border-civil-services': 'translate',
  'urban-planning-municipal-services': 'apartment',
  'law-enforcement-public-safety': 'police',
  'forensic-science-investigation': 'forensic',
  'veterinary-animal-health': 'pets',
  'religious-chaplaincy-spiritual-care': 'volunteer_activism',
  'library-information-science': 'menu_book',
  'higher-education-research-admin': 'school',
};

export function resolveCategoryIcon(iconId: string | undefined, categoryId: string): React.ReactElement {
  const resolvedId = iconId && ICON_BY_ID[iconId]
    ? iconId
    : (ICON_BY_CATEGORY_ID[categoryId] ?? iconId ?? 'code');
  return (ICON_BY_ID[resolvedId] ?? <CodeIcon sx={ICON_SX} />) as React.ReactElement;
}
