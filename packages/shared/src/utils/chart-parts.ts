import type { MessagePart } from './message-parts.js';

/** Lift render_chart tool metadata into dedicated chart message parts. */
export function attachChartPartsFromTools(
  parts: MessagePart[],
  toolCalls?: Array<{ id: string; name: string; metadata?: Record<string, unknown>; result?: string }>,
): MessagePart[] {
  const next = [...parts];
  const seen = new Set(next.filter((p) => p.type === 'chart').map((p) => p.id));

  const consider = (id: string, name: string, metadata?: Record<string, unknown>, result?: string) => {
    if (name !== 'render_chart' || seen.has(id)) return;
    const spec = metadata?.chartSpec;
    let chartJson: string | undefined;
    if (spec && typeof spec === 'object') {
      chartJson = JSON.stringify(spec);
    } else if (result) {
      const fence = result.match(/```chart\s*([\s\S]*?)```/i);
      if (fence?.[1]) chartJson = fence[1].trim();
    }
    if (!chartJson) return;
    seen.add(id);
    next.push({ type: 'chart', id, chartJson });
  };

  for (const p of parts) {
    if (p.type === 'tool' && p.tool?.name === 'render_chart') {
      consider(p.tool.id, p.tool.name, p.tool.metadata, p.tool.result);
    }
  }
  for (const t of toolCalls ?? []) {
    consider(t.id, t.name, t.metadata, t.result);
  }
  return next;
}
