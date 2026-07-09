import { execFile } from 'node:child_process';
import { dirname, normalize, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FfmpegOptions {
  ffmpegPath?: string;
  timeoutMs?: number;
  voiceTempDir?: string;
}

export async function ensureFfmpegAvailable(options: FfmpegOptions = {}): Promise<void> {
  await execFfmpeg(['-version'], options);
}

export async function convertOggToWav16kMono(inputPath: string, outputPath: string, options: FfmpegOptions = {}): Promise<void> {
  assertSafeAudioPath(inputPath, options.voiceTempDir);
  assertSafeAudioPath(outputPath, options.voiceTempDir);
  await execFfmpeg([
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '16000',
    '-f', 'wav',
    outputPath,
  ], options);
}

export async function convertWavToOggOpus(inputPath: string, outputPath: string, options: FfmpegOptions = {}): Promise<void> {
  assertSafeAudioPath(inputPath, options.voiceTempDir);
  assertSafeAudioPath(outputPath, options.voiceTempDir);
  await execFfmpeg([
    '-y',
    '-i', inputPath,
    '-c:a', 'libopus',
    '-b:a', '32k',
    '-vbr', 'on',
    outputPath,
  ], options);
}

export async function convertPcmToWav(inputPath: string, outputPath: string, sampleRate: number, options: FfmpegOptions = {}): Promise<void> {
  assertSafeAudioPath(inputPath, options.voiceTempDir);
  assertSafeAudioPath(outputPath, options.voiceTempDir);
  await execFfmpeg([
    '-y',
    '-f', 's16le',
    '-ar', String(sampleRate),
    '-ac', '1',
    '-i', inputPath,
    '-f', 'wav',
    outputPath,
  ], options);
}

function assertSafeAudioPath(filePath: string, voiceTempDir?: string): void {
  if (!voiceTempDir) {
    return;
  }

  const normalizedFile = normalize(resolve(filePath));
  const normalizedTemp = normalize(resolve(voiceTempDir));
  const normalizedParent = normalize(resolve(dirname(filePath)));
  if (!normalizedFile.startsWith(normalizedTemp) && normalizedParent !== normalizedTemp) {
    throw new Error(`Audio path is outside the voice temp directory: ${filePath}`);
  }
}

function defaultFfmpegPath(): string {
  return process.env['AGENTX_FFMPEG_PATH'] || 'ffmpeg';
}

async function execFfmpeg(args: string[], options: FfmpegOptions): Promise<void> {
  await execFileAsync(options.ffmpegPath ?? defaultFfmpegPath(), args, {
    timeout: options.timeoutMs ?? 60_000,
  });
}
