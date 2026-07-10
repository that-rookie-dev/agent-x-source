export class TokenTracker {
  private used = 0;
  private total: number;
  private history: Array<{ timestamp: number; tokens: number }> = [];
  private inputTokens = 0;
  private outputTokens = 0;

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

  get inputTokenCount(): number {
    return this.inputTokens;
  }

  get outputTokenCount(): number {
    return this.outputTokens;
  }

  /** Cost tracking removed — always 0. */
  get totalCost(): number {
    return 0;
  }

  addUsage(tokens: number): void {
    this.used += tokens;
    this.history.push({ timestamp: Date.now(), tokens });
  }

  addTokenUsage(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
    this.used += input + output;
    this.history.push({ timestamp: Date.now(), tokens: input + output });
  }

  setUsed(tokens: number): void {
    this.used = tokens;
  }

  setTotal(contextWindow: number): void {
    this.total = contextWindow;
  }

  reset(): void {
    this.used = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.history = [];
  }

  getHistory(): Array<{ timestamp: number; tokens: number }> {
    return [...this.history];
  }

  getRecentRate(windowMs = 60_000): number {
    const cutoff = Date.now() - windowMs;
    const recent = this.history.filter((h) => h.timestamp >= cutoff);
    return recent.reduce((sum, h) => h.tokens + sum, 0);
  }
}
