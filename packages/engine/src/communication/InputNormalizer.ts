import type {
  InternalUserTurn,
  NormalizedTurn,
  NormalizedAttachment,
  NormalizationWarning,
} from '@agentx/shared';
import { ToolArgsRepairer } from './ToolArgsRepairer.js';
import { AttachmentResolver } from './AttachmentResolver.js';

export class InputNormalizer {
  private readonly toolArgsRepairer = new ToolArgsRepairer();
  private readonly attachmentResolver = new AttachmentResolver();
  private asciiOnly = false;

  setAsciiOnly(value: boolean): void {
    this.asciiOnly = value;
  }

  /** Bind the active workspace root used to sandbox source=workspace attachments. */
  setWorkspaceRoot(root: string | null | undefined): void {
    this.attachmentResolver.setWorkspaceRoot(root);
  }

  async sanitize(turn: InternalUserTurn): Promise<NormalizedTurn> {
    const warnings: NormalizationWarning[] = [];

    let cleanText = turn.text;

    // PASS 1: Unicode Safety
    const pass1Result = this.pass1UnicodeSafety(cleanText);
    cleanText = pass1Result.text;
    warnings.push(...pass1Result.warnings);

    // PASS 2: Control Characters
    const pass2Result = this.pass2ControlChars(cleanText);
    cleanText = pass2Result.text;
    warnings.push(...pass2Result.warnings);

    // PASS 3: Structured Payload Walk
    const pass3Result = this.pass3StructuredWalk(cleanText);
    cleanText = pass3Result.text;
    warnings.push(...pass3Result.warnings);

    // PASS 4: Non-ASCII Fallback (only when forced)
    if (this.asciiOnly) {
      const pass4Result = this.pass4NonAsciiFallback(cleanText);
      cleanText = pass4Result.text;
      warnings.push(...pass4Result.warnings);
    }

    // PASS 5: Attachment Resolution
    const cleanAttachments = await this.pass5Attachments(turn.attachments);

    return {
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      cleanText,
      cleanAttachments,
      warnings,
    };
  }

  private pass1UnicodeSafety(
    text: string,
  ): { text: string; warnings: NormalizationWarning[] } {
    const warnings: NormalizationWarning[] = [];
    let result = '';

    for (let i = 0; i < text.length; i++) {
      const code = text.codePointAt(i);
      if (code === undefined) continue;

      if (code >= 0xd800 && code <= 0xdfff) {
        warnings.push({
          pass: 'unicode_safety',
          field: 'text',
          original: `U+${code.toString(16).toUpperCase()}`,
          repaired: '\\uFFFD',
          reason: 'Invalid surrogate code point replaced',
        });
        result += '\uFFFD';
        continue;
      }

      if (code >= 0xfdd0 && code <= 0xfdef) {
        warnings.push({
          pass: 'unicode_safety',
          field: 'text',
          original: `U+${code.toString(16).toUpperCase()}`,
          repaired: '\\uFFFD',
          reason: 'Noncharacter code point replaced',
        });
        result += '\uFFFD';
        continue;
      }

      if (code >= 0x100000) {
        warnings.push({
          pass: 'unicode_safety',
          field: 'text',
          original: `U+${code.toString(16).toUpperCase()}`,
          repaired: '',
          reason: 'Code point outside valid Unicode range removed',
        });
        continue;
      }

      result += text[i]!;
      if (code > 0xffff) i++;
    }

    return { text: result, warnings };
  }

  private pass2ControlChars(
    text: string,
  ): { text: string; warnings: NormalizationWarning[] } {
    const warnings: NormalizationWarning[] = [];
    // eslint-disable-next-line no-control-regex
    const DISALLOWED = new Set(
      '\x00\x01\x02\x03\x04\x05\x06\x07\x08\x0b\x0c\x0e\x0f' +
        '\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f' +
        '\x7f',
    );

    let result = '';
    for (const ch of text) {
      if (DISALLOWED.has(ch)) {
        warnings.push({
          pass: 'control_chars',
          field: 'text',
          original: `0x${ch.charCodeAt(0).toString(16)}`,
          repaired: '',
          reason: 'Disallowed control character stripped',
        });
        continue;
      }
      result += ch;
    }

    return { text: result, warnings };
  }

  private pass3StructuredWalk(
    text: string,
  ): { text: string; warnings: NormalizationWarning[] } {
    const warnings: NormalizationWarning[] = [];

    const repaired = this.toolArgsRepairer.repairText(text);

    if (repaired.repairs.length > 0) {
      for (const repair of repaired.repairs) {
        warnings.push({
          pass: 'structured_walk',
          field: 'text',
          original: repair.original,
          repaired: repair.repaired,
          reason: repair.reason,
        });
      }
    }

    return { text: repaired.text, warnings };
  }

  private pass4NonAsciiFallback(
    text: string,
  ): { text: string; warnings: NormalizationWarning[] } {
    const warnings: NormalizationWarning[] = [];
    let result = '';
    let hasNonAscii = false;

    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code > 127) {
        hasNonAscii = true;
        const replacement = `\\u${code.toString(16).padStart(4, '0')}`;
        result += replacement;
      } else {
        result += ch;
      }
    }

    if (hasNonAscii) {
      warnings.push({
        pass: 'non_ascii_fallback',
        field: 'text',
        original: 'non-ASCII characters',
        repaired: 'Unicode escapes',
        reason: 'Non-ASCII fallback mode: characters escaped',
      });
    }

    return { text: result, warnings };
  }

  private pass5Attachments(
    attachments: InternalUserTurn['attachments'],
  ): Promise<NormalizedAttachment[]> {
    return this.attachmentResolver.resolve(attachments);
  }
}
