/**
 * System capability detection for local model recommendations.
 *
 * Detects hardware capabilities (RAM, CPU, disk space) and recommends
 * appropriate local models based on system resources.
 */
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SystemCapabilities {
  // Hardware
  totalMemoryGB: number;
  availableMemoryGB: number;
  cpuCores: number;
  cpuArchitecture: 'x64' | 'arm64' | 'unknown';
  hasGPU: boolean;
  
  // Storage
  availableDiskGB: number;
  
  // Platform
  platform: 'darwin' | 'win32' | 'linux';
  
  // Computed recommendations
  recommendedModelTier: 'basic' | 'standard' | 'advanced';
  canRunAdvanced: boolean;
  canRunStandard: boolean;
  canRunBasic: boolean;
}

export class SystemCapabilityDetector {
  static isLocalModelSupported(): boolean {
    return os.totalmem() / (1024 ** 3) >= 32;
  }

  static async detect(): Promise<SystemCapabilities> {
    const totalMemoryGB = os.totalmem() / (1024 ** 3);
    const freeMemoryGB = os.freemem() / (1024 ** 3);
    const cpuCores = os.cpus().length;
    const arch = os.arch();
    const platform = os.platform() as 'darwin' | 'win32' | 'linux';
    
    // Check available disk space
    const availableDiskGB = await this.getAvailableDiskSpace(platform);
    
    // Determine capabilities
    const canRunBasic = totalMemoryGB >= 4 && cpuCores >= 2;
    const canRunStandard = totalMemoryGB >= 8 && cpuCores >= 4;
    const canRunAdvanced = totalMemoryGB >= 16 && cpuCores >= 8;
    
    // Determine recommendation
    let recommendedModelTier: 'basic' | 'standard' | 'advanced' = 'basic';
    if (canRunAdvanced) recommendedModelTier = 'advanced';
    else if (canRunStandard) recommendedModelTier = 'standard';
    
    return {
      totalMemoryGB: Math.round(totalMemoryGB * 10) / 10,
      availableMemoryGB: Math.round(freeMemoryGB * 10) / 10,
      cpuCores,
      cpuArchitecture: arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : 'unknown',
      hasGPU: false, // ONNX is CPU-focused; could add GPU detection later
      availableDiskGB: Math.round(availableDiskGB * 10) / 10,
      platform,
      recommendedModelTier,
      canRunAdvanced,
      canRunStandard,
      canRunBasic,
    };
  }
  
  private static async getAvailableDiskSpace(platform: 'darwin' | 'win32' | 'linux'): Promise<number> {
    try {
      if (platform === 'darwin') {
        const { stdout } = await execAsync('df -h / | tail -1 | awk \'{print $4}\'');
        const match = stdout.match(/(\d+(?:\.\d+)?)(G|M)/i);
        if (!match || !match[1] || !match[2]) return 10;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        return unit === 'G' ? value : value / 1024;
      } else if (platform === 'win32') {
        const { stdout } = await execAsync('wmic logicaldisk get freespace');
        const lines = stdout.split('\n').slice(1);
        let minSpace = Infinity;
        for (const line of lines) {
          const match = line.match(/\d+/);
          if (match && match[0]) {
            const bytes = parseInt(match[0]);
            const gb = bytes / (1024 ** 3);
            if (gb < minSpace) minSpace = gb;
          }
        }
        return minSpace === Infinity ? 10 : minSpace;
      } else {
        const { stdout } = await execAsync('df -h / | tail -1 | awk \'{print $4}\'');
        const match = stdout.match(/(\d+(?:\.\d+)?)(G|M)/i);
        if (!match || !match[1] || !match[2]) return 10;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        return unit === 'G' ? value : value / 1024;
      }
    } catch (e) {
      console.warn('Failed to detect disk space:', e);
      return 10; // Conservative default
    }
  }
}
