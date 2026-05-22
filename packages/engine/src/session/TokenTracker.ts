export class TokenTracker {
  private used = 0;
  private total: number;
  private history: Array<{ timestamp: number; tokens: number }> = [];

  constructor(contextWindow: number) {
    this.total = contextWindow;
  }

  get tokensUsed(): number {
    return this.used;
  }

  get tokensTotal(): number {
    return this.total;
  }

  get tokensRemaining(): number {
    return Math.max(0, this.total - this.used);
  }

  get percentage(): number {
    return this.total > 0 ? this.used / this.total : 0;
  }

  get isNearLimit(): boolean {
    return this.percentage >= 0.7;
  }

  get isAtLimit(): boolean {
    return this.percentage >= 0.95;
  }

  addUsage(tokens: number): void {
    this.used += tokens;
    this.history.push({ timestamp: Date.now(), tokens });
  }

  setUsed(tokens: number): void {
    this.used = tokens;
  }

  setTotal(contextWindow: number): void {
    this.total = contextWindow;
  }

  reset(): void {
    this.used = 0;
    this.history = [];
  }

  getHistory(): Array<{ timestamp: number; tokens: number }> {
    return [...this.history];
  }

  getRecentRate(windowMs = 60_000): number {
    const cutoff = Date.now() - windowMs;
    const recent = this.history.filter((h) => h.timestamp >= cutoff);
    return recent.reduce((sum, h) => sum + h.tokens, 0);
  }
}
