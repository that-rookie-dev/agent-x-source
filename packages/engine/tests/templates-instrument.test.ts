import { describe, it, expect } from 'vitest';
import PizZip from 'pizzip';
import { instrumentTemplateBuffer } from '../src/templates/template-instrument.js';

function minimalDocx(bodyXml: string): Buffer {
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
    ${bodyXml}
  </w:body>
</w:document>`,
  );
  return Buffer.from(zip.generate({ type: 'nodebuffer' }));
}

describe('template instrument', () => {
  it('rewrites underscore blanks to {{key}} inside docx', async () => {
    const buffer = minimalDocx('<w:p><w:r><w:t>Client Name: __________</w:t></w:r></w:p>');
    const out = await instrumentTemplateBuffer(buffer, 'docx', [{
      key: 'client_name',
      label: 'Client Name',
      source: 'llm',
      context: 'Client Name',
      blankToken: '__________',
    }]);
    const xml = new PizZip(out).file('word/document.xml')?.asText() ?? '';
    expect(xml).toContain('{{client_name}}');
    expect(xml).not.toContain('__________');
  });

  it('rewrites sample/example text from the design to {{key}}', async () => {
    const buffer = minimalDocx('<w:p><w:r><w:t>Client Name: Acme Corp</w:t></w:r></w:p>');
    const out = await instrumentTemplateBuffer(buffer, 'docx', [{
      key: 'client_name',
      label: 'Client Name',
      source: 'llm',
      context: 'Client Name',
      sampleValue: 'Acme Corp',
    }]);
    const xml = new PizZip(out).file('word/document.xml')?.asText() ?? '';
    expect(xml).toContain('{{client_name}}');
    expect(xml).toContain('Client Name:');
    expect(xml).not.toContain('Acme Corp');
  });
});
