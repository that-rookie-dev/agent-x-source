import { marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdownLang from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import csharp from 'highlight.js/lib/languages/csharp';
import cpp from 'highlight.js/lib/languages/cpp';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import diffLang from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import toml from 'highlight.js/lib/languages/ini';
import DOMPurify from 'dompurify';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdownLang);
hljs.registerLanguage('md', markdownLang);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('php', php);
hljs.registerLanguage('diff', diffLang);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('toml', toml);
hljs.registerLanguage('ini', toml);

const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language }).value;
  const langLabel = language !== 'plaintext' ? language : '';

  return `<div class="code-block-wrapper">
    <div class="code-block-header">
      <span class="code-block-lang">${langLabel}</span>
      <button class="code-block-copy" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').textContent)">Copy</button>
    </div>
    <pre><code class="hljs language-${language}">${highlighted}</code></pre>
  </div>`;
};

renderer.link = function ({ href, text }: { href: string; text: string }): string {
  return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

renderer.image = function ({ href, text }: { href: string; text: string }): string {
  return `<img src="${href}" alt="${text}" loading="lazy" />`;
};

renderer.table = function (token): string {
  const header = token.header.map((cell: { text: string }) => `<th>${cell.text}</th>`).join('');
  const body = token.rows.map((row: { text: string }[]) =>
    `<tr>${row.map((cell: { text: string }) => `<td>${cell.text}</td>`).join('')}</tr>`,
  ).join('');
  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
};

renderer.listitem = function (token): string {
  const text = token.text;
  const task = !!token.task;
  const checked = !!token.checked;
  if (task) {
    return `<li><input type="checkbox" ${checked ? 'checked' : ''} disabled /> ${text}</li>`;
  }
  return `<li>${text}</li>`;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content) as string;
  return DOMPurify.sanitize(raw, {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['checked', 'disabled', 'type', 'target', 'rel', 'loading', 'onclick'],
  });
}
