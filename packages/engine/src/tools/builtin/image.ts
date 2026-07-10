import { existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { execSync } from 'node:child_process';
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { IS_MACOS, getOcrCheckCommand } from '../platform.js';

export async function imageView(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['file'] as string);

  if (!existsSync(filePath)) {
    return { success: false, output: 'Image file not found', error: 'NOT_FOUND' };
  }

  const ext = extname(filePath).toLowerCase();
  const supported = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
  if (!supported.includes(ext)) {
    return { success: false, output: `Unsupported format: ${ext}. Supported: ${supported.join(', ')}`, error: 'UNSUPPORTED' };
  }

  const stat = statSync(filePath);
  const info: string[] = [
    `File: ${filePath}`,
    `Format: ${ext.slice(1).toUpperCase()}`,
    `Size: ${(stat.size / 1024).toFixed(1)} KB`,
  ];

  // Try to get dimensions via sips (macOS) or identify (ImageMagick) or sharp (Node.js)
  if (IS_MACOS) {
    try {
      const dims = execSync(`sips -g pixelWidth -g pixelHeight "${filePath}" 2>/dev/null | grep pixel`, { encoding: 'utf-8' });
      const width = dims.match(/pixelWidth:\s*(\d+)/)?.[1];
      const height = dims.match(/pixelHeight:\s*(\d+)/)?.[1];
      if (width && height) info.push(`Dimensions: ${width}x${height}`);
    } catch {
      /* fall through */
    }
  }

  if (info.length === 3) {
    // No dimensions yet, try ImageMagick
    try {
      const dims = execSync(`identify -format "%wx%h" "${filePath}" 2>/dev/null`, { encoding: 'utf-8' });
      if (dims.trim()) info.push(`Dimensions: ${dims.trim()}`);
    } catch { /* no image tools available */ }
  }

  return { success: true, output: info.join('\n') };
}

export async function imageResize(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['file'] as string);
  const width = args['width'] as number;
  const height = args['height'] as number | undefined;
  const output = args['output'] as string | undefined;
  const outputPath = output ? resolve(context.scopePath, output) : filePath;

  if (!existsSync(filePath)) {
    return { success: false, output: 'Image file not found', error: 'NOT_FOUND' };
  }

  // Try sips (macOS built-in) first, then ImageMagick
  if (IS_MACOS) {
    try {
      const dims = height ? `--resampleWidth ${width} --resampleHeight ${height}` : `--resampleWidth ${width}`;
      if (outputPath !== filePath) {
        const cpCmd = IS_MACOS ? 'cp' : 'copy';
        execSync(`${cpCmd} "${filePath}" "${outputPath}"`, { encoding: 'utf-8' });
      }
      execSync(`sips ${dims} "${outputPath}" 2>/dev/null`, { encoding: 'utf-8' });
      return { success: true, output: `Resized to ${width}${height ? `x${height}` : 'w'} → ${outputPath}` };
    } catch {
      /* fall through to ImageMagick */
    }
  }

  try {
    const geometry = height ? `${width}x${height}` : `${width}`;
    execSync(`convert "${filePath}" -resize ${geometry} "${outputPath}"`, { encoding: 'utf-8' });
    return { success: true, output: `Resized to ${geometry} → ${outputPath}` };
  } catch (err) {
    return { success: false, output: `No image tool available (sips/ImageMagick): ${(err as Error).message}`, error: 'TOOL_MISSING' };
  }
}

export async function imageConvert(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const filePath = resolve(context.scopePath, args['file'] as string);
  const format = (args['format'] as string).toLowerCase();
  const outputFile = args['output'] as string | undefined;

  if (!existsSync(filePath)) {
    return { success: false, output: 'Image file not found', error: 'NOT_FOUND' };
  }

  const supported = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'];
  if (!supported.includes(format)) {
    return { success: false, output: `Unsupported target format: ${format}`, error: 'UNSUPPORTED' };
  }

  const defaultOutput = filePath.replace(/\.[^.]+$/, `.${format}`);
  const outPath = outputFile ? resolve(context.scopePath, outputFile) : defaultOutput;

  if (IS_MACOS) {
    try {
      execSync(`sips -s format ${format === 'jpg' ? 'jpeg' : format} "${filePath}" --out "${outPath}" 2>/dev/null`, { encoding: 'utf-8' });
      return { success: true, output: `Converted → ${outPath}` };
    } catch {
      /* fall through */
    }
  }

  try {
    execSync(`convert "${filePath}" "${outPath}"`, { encoding: 'utf-8' });
    return { success: true, output: `Converted → ${outPath}` };
  } catch (err) {
    return { success: false, output: `No image tool available: ${(err as Error).message}`, error: 'TOOL_MISSING' };
  }
}

export async function imageOcr(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const file = args['path'] as string ?? args['file'] as string;
  if (!file) return { success: false, output: 'path is required', error: 'MISSING_INPUT' };

  const filePath = resolve(context.scopePath, file);
  if (!existsSync(filePath)) {
    return { success: false, output: `File not found: ${file}`, error: 'NOT_FOUND' };
  }

  try {
    const ocrCheck = getOcrCheckCommand();
    execSync(ocrCheck, { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    return {
      success: false,
      output: 'Tesseract OCR is not installed (needed for image text extraction, not PDFs).\n'
        + 'Install it:\n  macOS: brew install tesseract\n  Linux: sudo apt install tesseract-ocr\n  Windows: choco install tesseract',
      error: 'TOOL_MISSING',
    };
  }

  try {
    const text = execSync(`tesseract "${filePath}" stdout 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (!text.trim()) {
      return { success: true, output: '(No text detected in image)' };
    }
    return { success: true, output: text.trim() };
  } catch (err) {
    return { success: false, output: `OCR failed: ${err instanceof Error ? err.message : String(err)}`, error: 'OCR_ERROR' };
  }
}
