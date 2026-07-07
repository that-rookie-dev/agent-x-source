/** Content types for rich deep-search result cards. */
export type DeepSearchContentType =
  | 'article'
  | 'video'
  | 'image'
  | 'product'
  | 'movie'
  | 'event'
  | 'social_profile'
  | 'social_post'
  | 'place'
  | 'document'
  | 'generic';

export type DeepSearchDepth = 'quick' | 'standard' | 'deep';

export interface DeepSearchScores {
  relevance: number;
  authority: number;
  freshness: number;
  extractQuality: number;
  typeFit: number;
  final: number;
}

export interface DeepSearchExtracted {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  author?: string;
  publishedAt?: string;
  duration?: string;
  price?: string;
  rating?: string;
  excerpt?: string;
  videoId?: string;
}

export interface DeepSearchResult {
  id: string;
  url: string;
  title: string;
  snippet: string;
  domain: string;
  faviconUrl?: string;
  contentType: DeepSearchContentType;
  scores: DeepSearchScores;
  extracted: DeepSearchExtracted;
  source: {
    provider: string;
    fetchedAt: string;
  };
}

export interface DeepSearchPlan {
  subQueries: string[];
  intent: string[];
}

export interface DeepSearchStats {
  searched: number;
  fetched: number;
  kept: number;
  ms: number;
  /** Search providers queried for this run (e.g. duckduckgo, brave). */
  providers?: string[];
}

export interface DeepSearchProgress {
  phase: 'planning' | 'searching' | 'fetching' | 'scoring' | 'done';
  message: string;
  searched?: number;
  fetched?: number;
  total?: number;
}

export interface DeepSearchResultBundle {
  query: string;
  depth: DeepSearchDepth;
  plan: DeepSearchPlan;
  stats: DeepSearchStats;
  results: DeepSearchResult[];
  summary: string;
  progress?: DeepSearchProgress;
}

export interface DeepSearchRequest {
  query: string;
  depth?: DeepSearchDepth;
  maxResults?: number;
}
