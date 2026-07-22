import { describe, it, expect } from 'vitest';
import PizZip from 'pizzip';
import {
  extractPlaceholderKeys,
  fieldsFromKeys,
  scanTemplatePlaceholders,
} from '../src/templates/placeholder-scan.js';
import { fillTemplateBuffer } from '../src/templates/template-fill.js';

/** Minimal OOXML Word doc with a contiguous {{client_name}} placeholder. */
function minimalDocxWithPlaceholder(): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Invoice for {{client_name}}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  return Buffer.from(zip.generate({ type: 'nodebuffer' }));
}

describe('template fill', () => {
  it('scans and fills a docx while preserving surrounding text', async () => {
    const buffer = minimalDocxWithPlaceholder();
    const fields = await scanTemplatePlaceholders(buffer, 'docx');
    expect(fieldsFromKeys(extractPlaceholderKeys('Invoice for {{client_name}}')).map((f) => f.key))
      .toEqual(['client_name']);
    expect(fields.map((f) => f.key)).toEqual(['client_name']);

    const filled = await fillTemplateBuffer(buffer, 'docx', { client_name: 'Acme Corp' });
    const outZip = new PizZip(filled);
    const xml = outZip.file('word/document.xml')?.asText() ?? '';
    expect(xml).toContain('Acme Corp');
    expect(xml).not.toContain('{{client_name}}');
    expect(xml).toContain('Invoice for');
  });
});
