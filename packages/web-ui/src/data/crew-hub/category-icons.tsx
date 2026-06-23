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
import type { CategoryIconId } from './prebuilt-crews-index';

export function getCategoryIcon(iconId: CategoryIconId): React.JSX.Element {
  switch (iconId) {
    case 'code':
      return <CodeIcon sx={{ fontSize: 16 }} />;
    case 'storage':
      return <StorageIcon sx={{ fontSize: 16 }} />;
    case 'palette':
      return <PaletteIcon sx={{ fontSize: 16 }} />;
    case 'gavel':
      return <GavelIcon sx={{ fontSize: 16 }} />;
    case 'verified':
      return <VerifiedUserIcon sx={{ fontSize: 16 }} />;
    case 'autoawesome':
      return <AutoAwesomeIcon sx={{ fontSize: 16 }} />;
    case 'school':
      return <SchoolIcon sx={{ fontSize: 16 }} />;
    case 'favorite':
      return <FavoriteIcon sx={{ fontSize: 16 }} />;
    case 'home':
      return <HomeIcon sx={{ fontSize: 16 }} />;
    case 'brush':
      return <BrushIcon sx={{ fontSize: 16 }} />;
    case 'groups':
      return <GroupsIcon sx={{ fontSize: 16 }} />;
    case 'trending':
      return <TrendingUpIcon sx={{ fontSize: 16 }} />;
    case 'campaign':
      return <CampaignIcon sx={{ fontSize: 16 }} />;
    case 'ads':
      return <AdsClickIcon sx={{ fontSize: 16 }} />;
    case 'work':
      return <WorkIcon sx={{ fontSize: 16 }} />;
    case 'balance':
      return <AccountBalanceIcon sx={{ fontSize: 16 }} />;
    case 'voice':
      return <RecordVoiceOverIcon sx={{ fontSize: 16 }} />;
    case 'support':
      return <SupportAgentIcon sx={{ fontSize: 16 }} />;
    case 'shipping':
      return <LocalShippingIcon sx={{ fontSize: 16 }} />;
    case 'apartment':
      return <ApartmentIcon sx={{ fontSize: 16 }} />;
    case 'policy':
      return <PolicyIcon sx={{ fontSize: 16 }} />;
    case 'volunteer':
      return <VolunteerActivismIcon sx={{ fontSize: 16 }} />;
    case 'restaurant':
      return <RestaurantIcon sx={{ fontSize: 16 }} />;
    case 'factory':
      return <FactoryIcon sx={{ fontSize: 16 }} />;
    case 'construction':
      return <ConstructionIcon sx={{ fontSize: 16 }} />;
    case 'landmark':
      return <AccountBalanceOutlinedIcon sx={{ fontSize: 16 }} />;
    case 'hospital':
      return <LocalHospitalIcon sx={{ fontSize: 16 }} />;
    case 'cart':
      return <ShoppingCartIcon sx={{ fontSize: 16 }} />;
    case 'flight':
      return <FlightIcon sx={{ fontSize: 16 }} />;
    case 'energy':
      return <BoltIcon sx={{ fontSize: 16 }} />;
    case 'translate':
      return <TranslateIcon sx={{ fontSize: 16 }} />;
    case 'news':
      return <NewspaperIcon sx={{ fontSize: 16 }} />;
    case 'sports':
      return <SportsIcon sx={{ fontSize: 16 }} />;
    case 'eco':
      return <LocalFloristIcon sx={{ fontSize: 16 }} />;
    case 'storefront':
      return <StorefrontIcon sx={{ fontSize: 16 }} />;
    case 'maritime':
      return <DirectionsBoatIcon sx={{ fontSize: 16 }} />;
    default:
      return <CodeIcon sx={{ fontSize: 16 }} />;
  }
}
