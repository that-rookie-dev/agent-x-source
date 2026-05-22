import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { execSync } from 'node:child_process';

/**
 * Browser automation tools using Playwright (optional dependency).
 * Falls back gracefully if playwright is not installed.
 */

let playwrightAvailable: boolean | null = null;

function checkPlaywright(): boolean {
  if (playwrightAvailable !== null) return playwrightAvailable;
  try {
    execSync('npx playwright --version', { stdio: 'pipe', timeout: 5000 });
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
  return playwrightAvailable;
}

export async function browserOpen(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  if (!url) return { success: false, output: 'url is required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(${JSON.stringify(url)}, { timeout: ${context.timeout} });
      const title = await page.title();
      const text = await page.evaluate(() => document.body.innerText.slice(0, 10000));
      await browser.close();
      console.log(JSON.stringify({ title, text, url: page.url() }));
    })();
  `;

  try {
    const result = execSync(`node -e ${JSON.stringify(script)}`, {
      timeout: context.timeout,
      encoding: 'utf-8',
      cwd: context.scopePath,
    });
    const parsed = JSON.parse(result.trim());
    return { success: true, output: `Title: ${parsed.title}\nURL: ${parsed.url}\n\n${parsed.text}` };
  } catch (error) {
    return { success: false, output: `Browser open failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}

export async function browserScreenshot(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const outputPath = (args['output'] as string) ?? 'screenshot.png';
  if (!url) return { success: false, output: 'url is required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(${JSON.stringify(url)}, { timeout: ${context.timeout} });
      await page.screenshot({ path: ${JSON.stringify(outputPath)}, fullPage: true });
      await browser.close();
      console.log('ok');
    })();
  `;

  try {
    execSync(`node -e ${JSON.stringify(script)}`, {
      timeout: context.timeout,
      encoding: 'utf-8',
      cwd: context.scopePath,
    });
    return { success: true, output: `Screenshot saved to ${outputPath}` };
  } catch (error) {
    return { success: false, output: `Screenshot failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}

export async function browserClick(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const selector = args['selector'] as string;
  if (!url || !selector) return { success: false, output: 'url and selector are required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(${JSON.stringify(url)}, { timeout: ${context.timeout} });
      await page.click(${JSON.stringify(selector)}, { timeout: 5000 });
      await page.waitForLoadState('networkidle');
      const text = await page.evaluate(() => document.body.innerText.slice(0, 10000));
      await browser.close();
      console.log(JSON.stringify({ text, url: page.url() }));
    })();
  `;

  try {
    const result = execSync(`node -e ${JSON.stringify(script)}`, {
      timeout: context.timeout,
      encoding: 'utf-8',
      cwd: context.scopePath,
    });
    const parsed = JSON.parse(result.trim());
    return { success: true, output: `Clicked ${selector}. Page: ${parsed.url}\n\n${parsed.text}` };
  } catch (error) {
    return { success: false, output: `Click failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}

export async function browserEval(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const url = args['url'] as string;
  const expression = args['expression'] as string;
  if (!url || !expression) return { success: false, output: 'url and expression are required', error: 'INVALID_ARGS' };
  if (!checkPlaywright()) {
    return { success: false, output: 'Playwright not installed. Run: npx playwright install', error: 'DEPENDENCY_MISSING' };
  }

  const script = `
    const { chromium } = require('playwright');
    (async () => {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(${JSON.stringify(url)}, { timeout: ${context.timeout} });
      const result = await page.evaluate(${JSON.stringify(expression)});
      await browser.close();
      console.log(JSON.stringify({ result }));
    })();
  `;

  try {
    const result = execSync(`node -e ${JSON.stringify(script)}`, {
      timeout: context.timeout,
      encoding: 'utf-8',
      cwd: context.scopePath,
    });
    const parsed = JSON.parse(result.trim());
    return { success: true, output: typeof parsed.result === 'string' ? parsed.result : JSON.stringify(parsed.result, null, 2) };
  } catch (error) {
    return { success: false, output: `Eval failed: ${(error as Error).message}`, error: 'BROWSER_ERROR' };
  }
}
