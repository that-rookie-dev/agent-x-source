import { createHash, randomBytes } from 'node:crypto';

export interface PkceChallenge {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  providerId: string;
  connectionId?: string;
  redirectUri: string;
  remoteResourceUrl?: string;
  createdAt: number;
}

export class OAuthPkceStore {
  private pending = new Map<string, PkceChallenge>();
  /** Generous TTL: first-time users may sign up (email verification etc.) mid-flow. */
  private readonly ttlMs = 30 * 60 * 1000;

  create(providerId: string, redirectUri: string, options?: { connectionId?: string; remoteResourceUrl?: string }): PkceChallenge {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const state = randomBytes(16).toString('hex');
    const challenge: PkceChallenge = {
      state,
      codeVerifier,
      codeChallenge,
      providerId,
      connectionId: options?.connectionId,
      redirectUri,
      remoteResourceUrl: options?.remoteResourceUrl,
      createdAt: Date.now(),
    };
    this.pending.set(state, challenge);
    this.prune();
    return challenge;
  }

  consume(state: string): PkceChallenge | undefined {
    const challenge = this.pending.get(state);
    if (!challenge) return undefined;
    this.pending.delete(state);
    if (Date.now() - challenge.createdAt > this.ttlMs) return undefined;
    return challenge;
  }

  /** Non-destructive lookup — used while polling for OAuth completion. */
  peek(state: string): PkceChallenge | undefined {
    const challenge = this.pending.get(state);
    if (!challenge) return undefined;
    if (Date.now() - challenge.createdAt > this.ttlMs) {
      this.pending.delete(state);
      return undefined;
    }
    return challenge;
  }

  private prune(): void {
    const now = Date.now();
    for (const [state, challenge] of this.pending.entries()) {
      if (now - challenge.createdAt > this.ttlMs) this.pending.delete(state);
    }
  }
}
