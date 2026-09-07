export interface DownloadProgress {
  phase: 'connecting' | 'downloading' | 'done' | 'error';
  /** Human-readable status line for UI. */
  message: string;
  /** Downloaded bytes so far. */
  downloadedBytes?: number;
  /** Total bytes if known from Content-Length. */
  totalBytes?: number;
  /** 0-100 when total is known. */
  percent?: number;
  /** Output file path relative to workspace. */
  outputPath?: string;
}

export interface DownloadResult {
  url: string;
  outputPath: string;
  size: number;
  mimeType?: string;
  filename: string;
}
