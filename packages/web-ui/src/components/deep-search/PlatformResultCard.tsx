import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import MovieFilterIcon from '@mui/icons-material/MovieFilter';
import InstagramIcon from '@mui/icons-material/Instagram';
import type { DeepSearchResult } from '@agentx/shared/browser';
import { colors, alphaColor } from '../../theme';
import { brands } from '../../styles/brands';
import { ScoreBadge } from './shared';
import { HasImageChip, searchCardSx, OpenLinkHint } from './card-utils';
import { detectPlatform } from './platform-detect';
import { formatSearchProviderLabel } from './provider-labels';

export type { PlatformKind } from './platform-detect';
export { detectPlatform } from './platform-detect';

function YouTubeBody({ result, compact }: { result: DeepSearchResult; compact?: boolean }) {
  const videoId = result.extracted.videoId
    ?? result.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/i)?.[1];

  if (!compact) {
    const thumb = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : result.extracted.imageUrl;
    return (
      <>
        {thumb && (
          <Box sx={{ position: 'relative', mb: 0.75 }}>
            <Box
              component="img"
              src={thumb}
              alt=""
              sx={{
                width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: '8px',
                border: `1px solid ${colors.border.subtle}`,
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <Box sx={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alphaColor(colors.bg.primary, 0.35), borderRadius: '8px',
            }}>
              <PlayCircleOutlineIcon sx={{ fontSize: 40, color: colors.ink }} />
            </Box>
          </Box>
        )}
      </>
    );
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.15 }}>
        <PlayCircleOutlineIcon sx={{ fontSize: 11, color: brands.youtube }} />
        <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
          YOUTUBE {videoId ? `· ${videoId}` : ''}
        </Typography>
      </Box>
      {result.extracted.duration && (
        <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim }}>Duration: {result.extracted.duration}</Typography>
      )}
    </>
  );
}

function IMDbBody({ result, compact }: { result: DeepSearchResult; compact?: boolean }) {
  if (!compact && result.extracted.imageUrl) {
    return (
      <Box
        component="img"
        src={result.extracted.imageUrl}
        alt=""
        sx={{
          width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: '8px',
          border: `1px solid ${colors.border.subtle}`, mb: 0.75,
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.15 }}>
      <MovieFilterIcon sx={{ fontSize: 11, color: brands.imdb }} />
      <Typography sx={{ fontSize: '0.52rem', color: brands.imdb, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
        IMDb
      </Typography>
      {result.extracted.rating && (
        <Typography sx={{
          fontSize: '0.52rem', color: colors.text.primary, fontWeight: 700,
          bgcolor: alphaColor(brands.imdb, '22'), px: 0.45, borderRadius: '4px',
        }}>
          ★ {result.extracted.rating}
        </Typography>
      )}
    </Box>
  );
}

function InstagramBody({ result, compact }: { result: DeepSearchResult; compact?: boolean }) {
  const isProfile = result.contentType === 'social_profile';

  if (!compact && result.extracted.imageUrl) {
    return (
      <Box
        component="img"
        src={result.extracted.imageUrl}
        alt=""
        sx={{
          width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: isProfile ? '50%' : '8px',
          border: `1px solid ${colors.border.subtle}`, mb: 0.75, maxWidth: isProfile ? 120 : '100%',
        }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.15 }}>
      <InstagramIcon sx={{ fontSize: 11, color: brands.instagram }} />
      <Typography sx={{ fontSize: '0.52rem', color: brands.instagram, fontFamily: "'JetBrains Mono', monospace" }}>
        INSTAGRAM · {isProfile ? 'PROFILE' : 'POST'}
      </Typography>
    </Box>
  );
}

export function PlatformResultBody({ result, compact }: { result: DeepSearchResult; compact?: boolean }) {
  const platform = detectPlatform(result);
  switch (platform) {
    case 'youtube': return <YouTubeBody result={result} compact={compact} />;
    case 'imdb': return <IMDbBody result={result} compact={compact} />;
    case 'instagram': return <InstagramBody result={result} compact={compact} />;
    default: return null;
  }
}

export function PlatformCardChrome({
  result,
  rank,
  children,
  accent,
  hasImage,
  onOpen,
}: {
  result: DeepSearchResult;
  rank: number;
  children?: React.ReactNode;
  accent?: string;
  hasImage?: boolean;
  onOpen?: () => void;
}) {
  const borderAccent = accent ?? colors.border.default;
  const provider = result.source?.provider ? formatSearchProviderLabel(result.source.provider) : null;
  const sourceMeta = provider ? `#${rank} · ${result.domain} · ${provider}` : `#${rank} · ${result.domain}`;
  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && onOpen) {
          e.preventDefault();
          onOpen();
        }
      }}
      sx={{
        ...searchCardSx,
        height: '100%',
        border: `1px solid ${borderAccent}`,
        '&:hover': {
          ...searchCardSx['&:hover'],
          borderColor: borderAccent,
        },
      }}
    >
      <Box sx={{ p: 0.85, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.45 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
            {sourceMeta}
          </Typography>
          {hasImage && <HasImageChip />}
        </Box>
        {children}
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: colors.text.primary, lineHeight: 1.3 }}>
          {result.title}
        </Typography>
        {(result.extracted.description || result.snippet) && (
          <Typography sx={{
            fontSize: '0.62rem', color: colors.text.secondary, lineHeight: 1.45,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {result.extracted.description || result.snippet}
          </Typography>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 'auto', pt: 0.25 }}>
          <ScoreBadge score={result.scores.final} />
          <OpenLinkHint />
        </Box>
      </Box>
    </Box>
  );
}
