export interface ToolLedgerEntry {
  name: string;
  success: boolean;
  output: string;
  elapsed: number;
  path?: string;
  timestamp: number;
}

/** Per-turn ground-truth record of tool executions for history and validation. */
export class ToolLedger {
  private entries: ToolLedgerEntry[] = [];

  record(entry: Omit<ToolLedgerEntry, 'timestamp'> & { timestamp?: number }): void {
    this.entries.push({ ...entry, timestamp: entry.timestamp ?? Date.now() });
  }

  reset(): void {
    this.entries = [];
  }

  getEntries(): ToolLedgerEntry[] {
    return [...this.entries];
  }

  formatForHistory(): string {
    if (this.entries.length === 0) return '';
    const lines = this.entries.map((e) => {
      const status = e.success ? 'OK' : 'FAILED';
      const path = e.path ? ` path=${e.path}` : '';
      return `[TOOL ${e.name} ${status}${path}] ${e.output.slice(0, 200)}`;
    });
    return `[TURN TOOL LEDGER]\n${lines.join('\n')}\n[/TURN TOOL LEDGER]`;
  }

  getFailedWrites(): ToolLedgerEntry[] {
    return this.entries.filter((e) => !e.success);
  }

  getSuccessfulWrites(): ToolLedgerEntry[] {
    return this.entries.filter((e) => e.success);
  }
}
