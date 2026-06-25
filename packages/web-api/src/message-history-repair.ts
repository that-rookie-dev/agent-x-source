/**
 * Repair chat history after a replay/resend bug that deleted the user turn from DB
 * but left the regenerated assistant reply.
 */

function contentPrefix(content: unknown, len = 80): string {
  return String(content ?? '').replace(/\s+/g, ' ').trim().slice(0, len);
}

function assistantsMatch(
  current: Record<string, unknown>,
  candidate: Record<string, unknown>,
): boolean {
  const currentId = String(current['id'] ?? '');
  const candidateId = String(candidate['id'] ?? '');
  if (currentId && candidateId && currentId === candidateId) return true;

  const a = contentPrefix(current['content']);
  const b = contentPrefix(candidate['content']);
  return a.length >= 24 && b.length >= 24 && (a === b || a.startsWith(b) || b.startsWith(a));
}

/**
 * Re-insert user messages missing before orphaned assistant replies using checkpoint snapshots.
 */
export function healOrphanedUserMessages(
  messages: Array<Record<string, unknown>>,
  checkpointSnapshots: Array<Array<Record<string, unknown>>>,
): Array<Record<string, unknown>> {
  if (!messages.length || !checkpointSnapshots.length) return messages;

  const out = [...messages];
  let changed = false;

  for (let i = 0; i < out.length; i++) {
    const msg = out[i];
    if (!msg || msg['role'] !== 'assistant') continue;

    const prev = i > 0 ? out[i - 1] : null;
    if (prev && prev['role'] === 'user' && String(prev['content'] ?? '').trim()) continue;

    let inserted: Record<string, unknown> | null = null;

    for (const snap of checkpointSnapshots) {
      for (let j = 0; j < snap.length; j++) {
        const snapAssistant = snap[j];
        if (!snapAssistant || snapAssistant['role'] !== 'assistant') continue;
        if (!assistantsMatch(msg, snapAssistant)) continue;

        const snapUser = j > 0 ? snap[j - 1] : null;
        if (snapUser?.['role'] !== 'user') continue;
        const userContent = String(snapUser['content'] ?? '').trim();
        if (!userContent) continue;

        inserted = {
          ...snapUser,
          id: snapUser['id'] ?? `healed-user-${String(msg['id'] ?? i)}`,
        };
        break;
      }
      if (inserted) break;
    }

    if (inserted) {
      out.splice(i, 0, inserted);
      changed = true;
      i++;
    }
  }

  return changed ? out : messages;
}
