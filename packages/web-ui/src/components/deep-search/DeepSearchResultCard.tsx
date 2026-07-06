import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { DeepSearchResult } from '@agentx/shared/browser';
import { colors } from '../../theme';
import { ScoreBadge, TypeBadge } from './shared';
import { HasImageChip, searchCardSx, searchCardItemSx, OpenLinkHint, openSearchResultUrl } from './card-utils';
import { detectPlatform, resultHasPreviewImage } from './platform-detect';
import { PlatformResultBody, PlatformCardChrome } from './PlatformResultCard';
import { formatSearchProviderLabel } from './provider-labels';

const PLATFORM_ACCENTS: Record<string, string> = {
  youtube: '#ff000044',
  imdb: '#f5c51844',
  instagram: '#E1306C44',
};

function openOnActivate(
  e: React.KeyboardEvent | React.MouseEvent,
  open: () => void,
) {
  if ('key' in e && e.key !== 'Enter' && e.key !== ' ') return;
  if ('key' in e) e.preventDefault();
  open();
}

function resultSourceMeta(rank: number, result: DeepSearchResult): string {
  const provider = result.source?.provider ? formatSearchProviderLabel(result.source.provider) : null;
  return provider ? `#${rank} · ${result.domain} · ${provider}` : `#${rank} · ${result.domain}`;
}

export function DeepSearchResultCard({ result, rank }: { result: DeepSearchResult; rank: number }) {
  const platform = detectPlatform(result);
  const hasImage = resultHasPreviewImage(result);
  const handleOpen = () => openSearchResultUrl(result.url);
  const sourceMeta = resultSourceMeta(rank, result);

  if (platform !== 'default') {
    return (
      <Box sx={searchCardItemSx}>
        <PlatformCardChrome
          result={result}
          rank={rank}
          accent={PLATFORM_ACCENTS[platform]}
          hasImage={hasImage}
          onOpen={handleOpen}
        >
          <PlatformResultBody result={result} compact />
        </PlatformCardChrome>
      </Box>
    );
  }

  return (
    <Box sx={searchCardItemSx}>
      <Box
        role="link"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => openOnActivate(e, handleOpen)}
        sx={{
          ...searchCardSx,
          height: '100%',
          border: `1px solid ${colors.border.default}`,
          '&:hover': searchCardSx['&:hover'],
        }}
      >
        <Box sx={{ p: 0.85, flex: 1, display: 'flex', flexDirection: 'column', gap: 0.45 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {result.faviconUrl && (
              <Box component="img" src={result.faviconUrl} alt="" sx={{ width: 12, height: 12, borderRadius: '2px' }} />
            )}
            <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim, fontFamily: "'JetBrains Mono', monospace" }}>
              {sourceMeta}
            </Typography>
            {hasImage && <HasImageChip />}
            <Box sx={{ flex: 1 }} />
            <TypeBadge type={result.contentType} />
          </Box>

          <Typography sx={{
            fontSize: '0.72rem',
            fontWeight: 600,
            color: colors.text.primary,
            lineHeight: 1.3,
            fontFamily: "'Inter', sans-serif",
          }}>
            {result.title}
          </Typography>

          {(result.extracted.description || result.snippet) && (
            <Typography sx={{
              fontSize: '0.62rem',
              color: colors.text.secondary,
              lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {result.extracted.description || result.snippet}
            </Typography>
          )}

          {result.extracted.author && (
            <Typography sx={{ fontSize: '0.52rem', color: colors.text.dim }}>
              {result.extracted.author}
              {result.extracted.publishedAt ? ` · ${new Date(result.extracted.publishedAt).toLocaleDateString()}` : ''}
            </Typography>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 'auto', pt: 0.25 }}>
            <ScoreBadge score={result.scores.final} />
            <OpenLinkHint />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
