import * as esbuild from 'esbuild';
import { validateCanvasSource } from './CanvasValidator.js';

export interface CanvasCompileResult {
  ok: boolean;
  code?: string;
  errors: string[];
}

/** Compile interactive canvas TSX into an IIFE that reads React + SDK from globalThis.__AGENTX_CANVAS_HOST__. */
export async function compileCanvasTsx(source: string): Promise<CanvasCompileResult> {
  const validation = validateCanvasSource(source);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  try {
    const result = await esbuild.build({
      stdin: {
        contents: source,
        loader: 'tsx',
        resolveDir: process.cwd(),
      },
      bundle: true,
      format: 'iife',
      globalName: '__agentx_canvas_bundle__',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      jsxImportSource: 'react',
      write: false,
      minify: false,
      plugins: [canvasExternalsPlugin()],
      footer: {
        js: 'if (typeof globalThis !== "undefined") { globalThis.__agentx_canvas_bundle__ = __agentx_canvas_bundle__; }',
      },
    });

    const code = result.outputFiles[0]?.text;
    if (!code) {
      return { ok: false, errors: ['Compiler produced no output'] };
    }
    return { ok: true, code, errors: [] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [msg] };
  }
}

function canvasExternalsPlugin(): esbuild.Plugin {
  return {
    name: 'agentx-canvas-externals',
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'agentx-canvas-shim' }));
      build.onResolve({ filter: /^react\/.*/ }, (args) => ({ path: args.path, namespace: 'agentx-canvas-shim' }));
      build.onResolve({ filter: /^@agentx\/canvas$/ }, () => ({ path: '@agentx/canvas', namespace: 'agentx-canvas-shim' }));

      build.onLoad({ filter: /.*/, namespace: 'agentx-canvas-shim' }, (args) => {
        if (args.path === 'react') {
          return {
            contents: `
              const H = globalThis.__AGENTX_CANVAS_HOST__;
              module.exports = H.React;
              module.exports.default = H.React;
            `,
            loader: 'js',
          };
        }
        if (args.path === 'react/jsx-runtime' || args.path === 'react/jsx-dev-runtime') {
          return {
            contents: `
              const H = globalThis.__AGENTX_CANVAS_HOST__;
              const React = H.React;
              function jsx(type, props, key) {
                const { children, ...rest } = props || {};
                return React.createElement(type, { ...rest, key }, children);
              }
              module.exports = { jsx, jsxs: jsx, Fragment: React.Fragment };
            `,
            loader: 'js',
          };
        }
        if (args.path === '@agentx/canvas') {
          return {
            contents: `
              const H = globalThis.__AGENTX_CANVAS_HOST__;
              module.exports = H.AgentXCanvas;
              module.exports.default = H.AgentXCanvas;
            `,
            loader: 'js',
          };
        }
        return null;
      });
    },
  };
}

/** Wrap markdown in a default interactive canvas shell (quick-save from chat). */
export function wrapMarkdownInCanvasTsx(title: string, markdown: string): string {
  const safeTitle = JSON.stringify((title || 'Canvas').slice(0, 120));
  const body = JSON.stringify(markdown);
  return `import { CanvasRoot, Section, Markdown } from '@agentx/canvas';

export default function SavedCanvas() {
  return (
    <CanvasRoot>
      <Section title={${safeTitle}}>
        <Markdown>{${body}}</Markdown>
      </Section>
    </CanvasRoot>
  );
}
`;
}
