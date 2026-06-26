import { CATEGORY_SEARCH_SYNONYMS, TOPIC_CATEGORY_BRIDGE } from './crew-hub-search-synonyms.mjs';

const SEARCH_STOP = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'our', 'are', 'was', 'were',
  'has', 'have', 'had', 'this', 'that', 'from', 'into', 'about', 'coach',
  'advisor', 'specialist', 'educator', 'tutor', 'manager', 'engineer',
  'focused', 'delivers', 'concrete', 'plans', 'practical', 'guidance',
  'real', 'world', 'teams', 'operational', 'planning', 'education',
]);

/**
 * Tokenize human-readable labels into search terms.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeSearchLabel(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s+.#/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 2 && !SEARCH_STOP.has(w));
}

/**
 * Build rich FTS searchText for a catalog crew entry.
 *
 * Layers (all merged, deduped):
 * - crew identity: name, title, callsign, description, tone, expertise, traits
 * - category: label, id slug, skillBank, traitBank
 * - curated category synonyms (crew-hub-search-synonyms.mjs)
 * - topic bridges when category is in a bridge group
 *
 * @param {object} input
 * @param {object} input.crew
 * @param {object} input.category
 * @returns {string}
 */
export function buildCrewSearchText({ crew, category }) {
  const parts = [
    crew.name,
    crew.title,
    crew.callsign,
    crew.description,
    crew.tone,
    category.label,
    category.id.replace(/-/g, ' '),
    ...(crew.expertise ?? []),
    ...(crew.traits ?? []),
    ...(category.skillBank ?? []),
    ...(category.traitBank ?? []),
    ...(CATEGORY_SEARCH_SYNONYMS[category.id] ?? []),
  ];

  for (const bridge of TOPIC_CATEGORY_BRIDGE) {
    if (bridge.categories.includes(category.id)) {
      parts.push(...bridge.tags);
    }
  }

  // Title-derived tokens (e.g. "Astrophysics Theory Coach" → astrophysics, theory)
  parts.push(...tokenizeSearchLabel(crew.title));
  parts.push(...tokenizeSearchLabel(category.label));

  const seen = new Set();
  const tokens = [];
  for (const part of parts) {
    const chunk = String(part).toLowerCase().trim();
    if (!chunk) continue;
    // Keep multi-word phrases intact AND individual tokens
    if (chunk.includes(' ')) tokens.push(chunk);
    for (const word of chunk.split(/\s+/)) {
      if (word.length > 2 && !SEARCH_STOP.has(word) && !seen.has(word)) {
        seen.add(word);
        tokens.push(word);
      }
    }
  }

  return tokens.join(' ');
}

/**
 * List category ids that have curated synonym packs (for audit scripts).
 * @returns {string[]}
 */
export function listCuratedSynonymCategories() {
  return Object.keys(CATEGORY_SEARCH_SYNONYMS);
}
