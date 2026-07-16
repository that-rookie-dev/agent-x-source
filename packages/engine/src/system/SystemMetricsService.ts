import os from 'node:os';

export interface SystemMetricsSnapshot {
  timestamp: string;
  uptime: number;
  cpu: {
    process: number;
    system: number;
  };
  memory: {
    used: number;
    total: number;
    percent: number;
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

export class SystemMetricsService {
  private lastCpuUsage: NodeJS.CpuUsage;
  private lastCpuTime: number;
  private lastSystemCpu: number;

  constructor() {
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();
    this.lastSystemCpu = this.getSystemCpuTime();
  }

  getMetrics(): SystemMetricsSnapshot {
    const now = Date.now();
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
    const currentSystemCpu = this.getSystemCpuTime();

    const elapsedMs = now - this.lastCpuTime;
    const processCpuMs = (currentCpuUsage.user + currentCpuUsage.system) / 1000;
    const processCpuPercent = elapsedMs > 0
      ? Math.min(100, Math.max(0, (processCpuMs / elapsedMs) * 100))
      : 0;

    const systemCpuDelta = currentSystemCpu - this.lastSystemCpu;
    const systemCpuPercent = elapsedMs > 0
      ? Math.min(100, Math.max(0, (systemCpuDelta / elapsedMs) * 100))
      : 0;

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;
    this.lastSystemCpu = currentSystemCpu;

    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const mem = process.memoryUsage();

    return {
      timestamp: new Date(now).toISOString(),
      uptime: process.uptime(),
      cpu: {
        process: Number(processCpuPercent.toFixed(1)),
        system: Number(systemCpuPercent.toFixed(1)),
      },
      memory: {
        used: usedMemory,
        total: totalMemory,
        percent: totalMemory > 0 ? Number(((usedMemory / totalMemory) * 100).toFixed(1)) : 0,
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external ?? 0,
      },
    };
  }

  private getSystemCpuTime(): number {
    const cpus = os.cpus();
    let total = 0;
    for (const cpu of cpus) {
      total += Object.values(cpu.times).reduce((sum, t) => sum + t, 0);
    }
    return total;
  }
}

let instance: SystemMetricsService | null = null;

export function getSystemMetricsService(): SystemMetricsService {
  if (!instance) instance = new SystemMetricsService();
  return instance;
}

export function resetSystemMetricsService(): void {
  instance = null;
}
