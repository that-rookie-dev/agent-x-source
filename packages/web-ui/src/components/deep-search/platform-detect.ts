import type { DeepSearchResult } from '@agentx/shared/browser';

export type PlatformKind = 'youtube' | 'imdb' | 'instagram' | 'default';

export function detectPlatform(result: DeepSearchResult): PlatformKind {
  const host = result.domain.replace(/^www\./, '');
  if (/youtube\.com|youtu\.be/.test(host) || result.extracted.videoId) return 'youtube';
  if (/imdb\.com/.test(host) || result.contentType === 'movie') return 'imdb';
  if (/instagram\.com/.test(host) || result.contentType === 'social_profile' || result.contentType === 'social_post') {
    return 'instagram';
  }
  return 'default';
}

export function resultHasPreviewImage(result: DeepSearchResult): boolean {
  if (result.extracted.imageUrl) return true;
  if (detectPlatform(result) === 'youtube') {
    const videoId = result.extracted.videoId
      ?? result.url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/i)?.[1];
    return Boolean(videoId);
  }
  return false;
}
