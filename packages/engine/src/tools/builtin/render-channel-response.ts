/**
 * render_channel_response tool
 *
 * Allows the agent to produce structured content blocks that the channel
 * renderer converts to native platform format (Telegram inline keyboards,
 * Slack Block Kit, Discord embeds/buttons, HTML email).
 *
 * Only available on channel sessions. For simple conversational replies,
 * the agent should use plain text — the markdown parser fallback handles
 * those. This tool is for responses that benefit from native UI elements
 * (choices, status updates, structured data, dividers).
 */
import type { ToolExecutionContext, ToolResult, ChannelContentBlock } from '@agentx/shared';
import { isChannelSessionId, parseChannelBindingFromSessionId } from '@agentx/shared';
import { getRenderer } from '../../channels/renderers/index.js';

export async function renderChannelResponse(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  if (!isChannelSessionId(context.sessionId)) {
    return {
      success: false,
      output: 'render_channel_response is only available on messaging channel sessions.',
      error: 'CHANNEL_ONLY',
    };
  }

  const blocksRaw = args['blocks'];
  if (!Array.isArray(blocksRaw) || blocksRaw.length === 0) {
    return {
      success: false,
      output: 'blocks[] is required and must be a non-empty array of content blocks.',
      error: 'INVALID_BLOCKS',
    };
  }

  // Validate and normalize blocks
  const blocks: ChannelContentBlock[] = [];
  for (const raw of blocksRaw) {
    if (typeof raw !== 'object' || raw === null || typeof (raw as Record<string, unknown>)['type'] !== 'string') {
      continue; // skip invalid blocks
    }
    blocks.push(raw as ChannelContentBlock);
  }

  if (blocks.length === 0) {
    return {
      success: false,
      output: 'No valid content blocks provided.',
      error: 'NO_VALID_BLOCKS',
    };
  }

  const channel = parseChannelBindingFromSessionId(context.sessionId) ?? 'telegram';
  const renderer = getRenderer(channel);
  const results = renderer.renderBlocks(blocks);

  // The rendered results are stored in the context so the bridge can pick them up.
  // The tool returns a text summary for the agent's context; the actual rendering
  // is handled by the bridge via the channel response pipeline.
  const summary = `Rendered ${blocks.length} block(s) as ${results.length} message(s) for ${channel}.`;

  return {
    success: true,
    output: summary,
    metadata: {
      channel,
      renderResults: results,
      blockCount: blocks.length,
      messageCount: results.length,
    },
  };
}
