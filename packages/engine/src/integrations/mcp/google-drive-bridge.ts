import type { IntegrationProvider, ToolResult } from '@agentx/shared';
import { ParallelMode } from '@agentx/shared';
import type { ToolDefinition } from '@agentx/shared';
import { integrationToolId } from '../action-classifier.js';
import { extractPdfTextFromBuffer } from '../../tools/builtin/documents.js';
import type { McpSession } from './client.js';

export interface GoogleDriveBridgeTool {
  mcpName: string;
  definition: ToolDefinition;
  execute: (session: McpSession, args: Record<string, unknown>) => Promise<ToolResult>;
}

const MAX_OUTPUT_CHARS = 100_000;

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[truncated — ${text.length - MAX_OUTPUT_CHARS} more characters]`;
}

function parseReadResource(result: unknown): { text?: string; base64?: string; mimeType?: string } {
  if (!result || typeof result !== 'object') return {};
  const payload = result as {
    contents?: Array<{ mimeType?: string; text?: string; blob?: string }>;
  };
  const content = payload.contents?.[0];
  if (!content) return {};
  return {
    mimeType: content.mimeType,
    text: content.text,
    base64: content.blob,
  };
}

async function findDriveResourceByName(
  session: McpSession,
  fileName: string,
): Promise<{ fileId: string; name: string; mimeType?: string } | null> {
  const needle = fileName.toLowerCase();
  let cursor: string | undefined;

  do {
    const page = await session.listResources(cursor);
    for (const resource of page.resources) {
      const name = resource.name ?? '';
      if (name.toLowerCase().includes(needle) || needle.includes(name.toLowerCase())) {
        const fileId = resource.uri.replace(/^gdrive:\/\/\//, '');
        if (fileId) return { fileId, name, mimeType: resource.mimeType };
      }
    }
    cursor = page.nextCursor;
  } while (cursor);

  return null;
}

async function readDriveResource(
  session: McpSession,
  fileId: string,
  displayName: string,
): Promise<ToolResult> {
  const raw = await session.readResource(`gdrive:///${fileId}`);
  const parsed = parseReadResource(raw);

  if (parsed.text) {
    return {
      success: true,
      output: `# ${displayName}\n\n${truncateOutput(parsed.text)}`,
      metadata: { mimeType: parsed.mimeType, fileId },
    };
  }

  if (parsed.base64 && parsed.mimeType === 'application/pdf') {
    const buffer = Buffer.from(parsed.base64, 'base64');
    const text = extractPdfTextFromBuffer(buffer);
    if (!text.trim()) {
      return {
        success: true,
        output: `(PDF "${displayName}" contains no extractable text — it may be image-based/scanned)`,
        metadata: { mimeType: parsed.mimeType, fileId },
      };
    }
    return {
      success: true,
      output: `# ${displayName}\n\n${truncateOutput(text)}`,
      metadata: { mimeType: parsed.mimeType, fileId },
    };
  }

  if (parsed.base64) {
    return {
      success: false,
      output: `File "${displayName}" is binary (${parsed.mimeType ?? 'unknown'}). Text extraction is not supported for this type.`,
      error: 'BINARY_FILE',
      metadata: { mimeType: parsed.mimeType, fileId },
    };
  }

  return { success: false, output: 'Empty or unreadable Google Drive resource', error: 'READ_FAILED' };
}

function bridgeDefinition(
  provider: IntegrationProvider,
  toolName: string,
  description: string,
  modelDescription: string,
  properties: Record<string, { type: string; description: string }>,
  required: string[] = [],
): ToolDefinition {
  return {
    id: integrationToolId(provider.id, toolName),
    name: toolName,
    description,
    modelDescription,
    category: 'integrations',
    riskLevel: 'low',
    schema: { type: 'object', properties, required },
    composable: true,
    source: 'integration',
    parallelMode: ParallelMode.SAFE,
    isDestructive: false,
  };
}

export function createGoogleDriveBridgeTools(provider: IntegrationProvider): GoogleDriveBridgeTool[] {
  const readFile: GoogleDriveBridgeTool = {
    mcpName: 'read_file',
    definition: bridgeDefinition(
      provider,
      'read_file',
      'Read a file from Google Drive by name or ID',
      `[${provider.name}] Read file contents from Google Drive. Use fileName (partial match) or fileId. PDF text is extracted automatically. Do NOT use local filesystem tools for Drive files.`,
      {
        fileName: { type: 'string', description: 'Drive file name or partial name (e.g. Experience_Letter.pdf)' },
        fileId: { type: 'string', description: 'Google Drive file ID when known' },
      },
    ),
    execute: async (session, args) => {
      const fileId = typeof args.fileId === 'string' ? args.fileId.trim() : '';
      const fileName = typeof args.fileName === 'string' ? args.fileName.trim() : '';
      if (!fileId && !fileName) {
        return { success: false, output: 'fileName or fileId is required', error: 'MISSING_INPUT' };
      }

      if (fileId) {
        return readDriveResource(session, fileId, fileName || fileId);
      }

      const found = await findDriveResourceByName(session, fileName);
      if (!found) {
        return {
          success: false,
          output: `No Google Drive file matching "${fileName}" was found. Try integration__google-drive__list_files or search with a broader query.`,
          error: 'NOT_FOUND',
        };
      }

      return readDriveResource(session, found.fileId, found.name);
    },
  };

  const listFiles: GoogleDriveBridgeTool = {
    mcpName: 'list_files',
    definition: bridgeDefinition(
      provider,
      'list_files',
      'List files in Google Drive with IDs for reading',
      `[${provider.name}] List Drive files with file IDs. Use read_file with fileName or fileId to fetch contents.`,
      {
        cursor: { type: 'string', description: 'Pagination cursor from a previous list_files call' },
      },
    ),
    execute: async (session, args) => {
      const cursor = typeof args.cursor === 'string' && args.cursor.trim() ? args.cursor.trim() : undefined;
      const page = await session.listResources(cursor);
      const lines = page.resources.map((resource) => {
        const fileId = resource.uri.replace(/^gdrive:\/\/\//, '');
        return `- ${resource.name ?? fileId} (${resource.mimeType ?? 'unknown'}) id=${fileId}`;
      });
      const header = `Google Drive files (${lines.length} on this page):`;
      const footer = page.nextCursor ? `\n\nNext cursor: ${page.nextCursor}` : '';
      return {
        success: true,
        output: lines.length > 0 ? `${header}\n${lines.join('\n')}${footer}` : `${header}\n(no files on this page)${footer}`,
        metadata: { nextCursor: page.nextCursor },
      };
    },
  };

  return [readFile, listFiles];
}
