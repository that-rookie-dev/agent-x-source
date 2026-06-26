/**
 * Curated search jargon per category — NOT per crew member.
 *
 * Management model (do not edit generated category .ts files):
 * 1. AUTO (zero maintenance): skillBank, title, label, expertise → buildSearchText()
 * 2. CURATED (this file): domain jargon users say but titles omit — grow from telemetry
 * 3. QUERY (crew-auto-compose DOMAIN_HINTS): map user phrasing → search terms at runtime
 * 4. RUNTIME LLM (crew-keyword-expander): novel topics on empty match
 *
 * When to add entries here:
 * - User query failed with no-keyword-match AND phase-2 LLM was needed repeatedly
 * - Common lay terms for a sector (e.g. "black hole" for astronomy crews)
 *
 * Run `node scripts/generate-crew-hub.mjs` after edits — manifest revision auto-bumps.
 */

/** @type {Record<string, string[]>} */
export const CATEGORY_SEARCH_SYNONYMS = {
  // ─── Space & physical sciences ───────────────────────────────────────
  'space-science-astronomy': [
    'black hole', 'blackhole', 'black holes', 'event horizon', 'singularity',
    'cosmos', 'cosmology', 'galaxy', 'galaxies', 'nebula', 'supernova',
    'telescope', 'observatory', 'orbit', 'orbital', 'satellite', 'spacecraft',
    'nasa', 'esa', 'spacex', 'mars', 'moon', 'lunar', 'exoplanet', 'asteroid',
  ],
  'theoretical-physical-sciences': [
    'astrophysics', 'astronomy', 'black hole', 'blackhole', 'black holes',
    'quantum mechanics', 'quantum physics', 'relativity', 'general relativity',
    'particle physics', 'standard model', 'thermodynamics', 'electromagnetism',
    'wave function', 'dark matter', 'dark energy', 'string theory', 'plasma',
  ],
  'environmental-earth-sciences': [
    'climate change', 'global warming', 'carbon', 'greenhouse', 'ecosystem',
    'geology', 'seismology', 'earthquake', 'volcano', 'oceanography', 'weather',
  ],
  'chemistry-materials-science': [
    'organic chemistry', 'inorganic chemistry', 'polymer', 'catalyst',
    'molecule', 'compound', 'reaction', 'laboratory', 'periodic table',
  ],
  'biological-life-sciences': [
    'genetics', 'genomics', 'crispr', 'gene editing', 'dna', 'rna',
    'cell biology', 'microbiology', 'ecology', 'evolution', 'biodiversity',
    'neuroscience', 'immunology', 'virology', 'stem cell',
  ],

  // ─── Engineering & tech (examples — extend from telemetry) ───────────
  'machine-learning-ai': [
    'artificial intelligence', 'deep learning', 'neural network', 'llm',
    'large language model', 'chatbot', 'computer vision', 'nlp',
    'natural language processing', 'transformer', 'fine tuning',
  ],
  'devops-cloud-sre': [
    'kubernetes', 'k8s', 'docker', 'ci cd', 'cicd', 'terraform', 'helm',
    'aws', 'azure', 'gcp', 'cloud native', 'site reliability',
  ],
  'security-compliance': [
    'cybersecurity', 'infosec', 'penetration test', 'pentest', 'vulnerability',
    'owasp', 'zero trust', 'siem', 'incident response',
  ],

  // ─── Medical (lay terms → category) ────────────────────────────────
  'medical-cardiology-vascular': [
    'heart attack', 'cardiac', 'blood pressure', 'hypertension', 'arrhythmia',
    'cholesterol', 'stroke', 'cardiovascular',
  ],
  'medical-oncology-hematology': [
    'cancer', 'tumor', 'chemotherapy', 'radiation therapy', 'leukemia',
    'lymphoma', 'oncology',
  ],
};

/**
 * Cross-category topic bridges — applied to searchText for every crew in listed categories.
 * Use when a user topic spans a known category set.
 *
 * @type {Array<{ tags: string[]; categories: string[] }>}
 */
export const TOPIC_CATEGORY_BRIDGE = [
  {
    tags: ['space exploration', 'space science', 'astronaut', 'rocket', 'launch vehicle'],
    categories: ['space-science-astronomy', 'applied-engineering-sciences'],
  },
];
