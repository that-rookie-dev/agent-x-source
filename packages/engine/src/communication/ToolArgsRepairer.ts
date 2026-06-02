export interface RepairRecord {
  original: string;
  repaired: string;
  reason: string;
}

export interface RepairResult {
  text: string;
  repairs: RepairRecord[];
}

export class ToolArgsRepairer {
  repairText(text: string): RepairResult {
    const repairs: RepairRecord[] = [];
    let result = text;

    result = this.fixPythonKeywords(result, repairs);
    result = this.fixTrailingCommas(result, repairs);
    result = this.fixUnclosedBraces(result, repairs);
    result = this.stripInvalidControlChars(result, repairs);

    return { text: result, repairs };
  }

  repairJSON(raw: string, schema?: Record<string, unknown>): { json: unknown; repairs: RepairRecord[] } {
    const repairs: RepairRecord[] = [];

    let jsonStr = raw.trim();

    const strictResult = this.tryStrictParse(jsonStr);
    if (strictResult.success) {
      return { json: strictResult.value, repairs };
    }

    jsonStr = this.fixPythonKeywords(jsonStr, repairs);
    jsonStr = this.fixTrailingCommas(jsonStr, repairs);
    jsonStr = this.fixUnclosedBraces(jsonStr, repairs);
    jsonStr = this.stripInvalidControlChars(jsonStr, repairs);

    if (schema) {
      jsonStr = this.coerceTypes(jsonStr, schema, repairs);
    }

    const parseResult = this.tryStrictParse(jsonStr);
    if (parseResult.success) {
      return { json: parseResult.value, repairs };
    }

    return { json: null, repairs };
  }

  private tryStrictParse(text: string): { success: true; value: unknown } | { success: false } {
    try {
      const value = JSON.parse(text);
      return { success: true, value };
    } catch {
      return { success: false };
    }
  }

  private fixPythonKeywords(text: string, repairs: RepairRecord[]): string {
    const replacements: [RegExp, string, string][] = [
      [/\bNone\b/g, 'null', 'Python None → null'],
      [/\bTrue\b/g, 'true', 'Python True → true'],
      [/\bFalse\b/g, 'false', 'Python False → false'],
    ];

    let result = text;
    for (const [pattern, replacement, reason] of replacements) {
      if (pattern.test(result)) {
        result = result.replace(pattern, replacement);
        repairs.push({
          original: pattern.source,
          repaired: replacement,
          reason,
        });
      }
    }

    return result;
  }

  private fixTrailingCommas(text: string, repairs: RepairRecord[]): string {
    let result = text;

    const trailingCommaInObject = /,(\s*})/g;
    if (trailingCommaInObject.test(result)) {
      result = result.replace(trailingCommaInObject, '$1');
      repairs.push({
        original: ',}',
        repaired: '}',
        reason: 'Removed trailing comma before closing brace',
      });
    }

    const trailingCommaInArray = /,(\s*])/g;
    if (trailingCommaInArray.test(result)) {
      result = result.replace(trailingCommaInArray, '$1');
      repairs.push({
        original: ',]',
        repaired: ']',
        reason: 'Removed trailing comma before closing bracket',
      });
    }

    return result;
  }

  private fixUnclosedBraces(text: string, repairs: RepairRecord[]): string {
    let result = text;
    const openBraces = (result.match(/{/g) || []).length;
    const closeBraces = (result.match(/}/g) || []).length;
    const braceDiff = openBraces - closeBraces;

    if (braceDiff > 0 && braceDiff <= 3) {
      result += '}'.repeat(braceDiff);
      repairs.push({
        original: `${braceDiff} unclosed brace(s)`,
        repaired: `Added ${braceDiff} closing brace(s)`,
        reason: 'Closed unclosed JSON object braces',
      });
    }

    const openBrackets = (result.match(/\[/g) || []).length;
    const closeBrackets = (result.match(/\]/g) || []).length;
    const bracketDiff = openBrackets - closeBrackets;

    if (bracketDiff > 0 && bracketDiff <= 3) {
      result += ']'.repeat(bracketDiff);
      repairs.push({
        original: `${bracketDiff} unclosed bracket(s)`,
        repaired: `Added ${bracketDiff} closing bracket(s)`,
        reason: 'Closed unclosed JSON array brackets',
      });
    }

    return result;
  }

  private stripInvalidControlChars(text: string, repairs: { original: string; repaired: string; reason: string }[]): string {
    const pattern = /"([^"\\]|\\.)*"/g;
    let hasRepair = false;

    const result = text.replace(pattern, (match) => {
      const cleaned = match.replace(
        // eslint-disable-next-line no-control-regex
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g,
        '',
      );
      if (cleaned !== match) {
        hasRepair = true;
      }
      return cleaned;
    });

    if (hasRepair) {
      repairs.push({
        original: 'Invalid control chars in strings',
        repaired: 'Control chars stripped',
        reason: 'Removed invalid control characters inside JSON strings',
      });
    }

    return result;
  }

  private coerceTypes(
    jsonStr: string,
    schema: Record<string, unknown>,
    repairs: RepairRecord[],
  ): string {
    const properties = (schema as Record<string, unknown>).properties as
      | Record<string, { type?: string; items?: { type?: string } }>
      | undefined;
    if (!properties) return jsonStr;

    const parsed = this.tryStrictParse(jsonStr);
    if (!parsed.success || typeof parsed.value !== 'object' || parsed.value === null) {
      return jsonStr;
    }

    const obj = parsed.value as Record<string, unknown>;
    let changed = false;

    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in obj)) continue;

      const expectedType = propSchema.type;
      const value = obj[key];

      if (expectedType === 'number' && typeof value === 'string') {
        const num = Number(value);
        if (!isNaN(num) && String(num) === value) {
          obj[key] = num;
          changed = true;
          repairs.push({
            original: `"${key}": "${value}"`,
            repaired: `"${key}": ${num}`,
            reason: `String-to-number coercion for field "${key}"`,
          });
        }
      }

      if (expectedType === 'boolean' && typeof value === 'string') {
        if (value === 'true') {
          obj[key] = true;
          changed = true;
        } else if (value === 'false') {
          obj[key] = false;
          changed = true;
        }
      }

      if (expectedType === 'integer' && typeof value === 'number' && !Number.isInteger(value)) {
        obj[key] = Math.floor(value);
        changed = true;
      }

      if (expectedType === 'array' && propSchema.items?.type === 'number' && Array.isArray(value)) {
        const coerced = (value as unknown[]).map((v) => {
          if (typeof v === 'string') {
            const num = Number(v);
            return isNaN(num) ? v : num;
          }
          return v;
        });
        if (JSON.stringify(coerced) !== JSON.stringify(value)) {
          obj[key] = coerced;
          changed = true;
        }
      }
    }

    if (changed) {
      return JSON.stringify(obj);
    }

    return jsonStr;
  }
}
