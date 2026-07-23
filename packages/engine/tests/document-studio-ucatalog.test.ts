/**
 * Document Studio — U-catalog acceptance fixtures / smoke tests (U01–U70).
 *
 * One representative fixture per family A–K.  Each fixture asserts that the
 * natural-language compiler produces a JobSpec matching the expected recipe
 * pattern and that `validateJobSpec` is happy.  A separate block smoke-tests
 * `compileRecipeToSpec` for the recipes that already bind all required
 * parameters.
 */

import { describe, it, expect } from 'vitest';
import { NlCompiler } from '../src/document-studio/compiler/NlCompiler.js';
import { compileRecipeToSpec, RECIPE_CATALOG } from '../src/document-studio/recipes/catalog.js';
import { validateJobSpec } from '../src/document-studio/jobspec.js';
import { type JobInputRef, type ComposeStyle } from '../src/document-studio/types.js';

const compiler = new NlCompiler();

interface UFixture {
  family: string;
  id: string;
  description: string;
  intent: string;
  mentions: JobInputRef[];
  expectedRecipeId: string;
  expectedPhases: string[];
  expectedStepOps: string[];
  expectedComposeStyle?: ComposeStyle;
  expectedDeliverKind?: 'single' | 'tree';
}

const U_CATALOG_FIXTURES: UFixture[] = [
  {
    family: 'A. HR / People ops',
    id: 'U01',
    description: 'Offer letter from candidate CSV into /{Dept}/offers/',
    intent: 'Mail merge offer letters from the candidate CSV into department folders',
    mentions: [
      { type: 'master', masterId: 'offer-letter-master', role: 'layout' },
      { type: 'master', masterId: 'candidates-csv', role: 'data' },
      { type: 'mapping', mappingId: 'candidate-mapping' },
    ],
    expectedRecipeId: 'r2',
    expectedPhases: ['Phase 4'],
    expectedStepOps: ['analyze', 'map_schema', 'plan_instances', 'compose', 'deliver'],
    expectedComposeStyle: 'fill_clone',
    expectedDeliverKind: 'tree',
  },
  {
    family: 'B. Finance / Tax / Payroll',
    id: 'U08',
    description: 'Year-end tax form: ask me what is missing',
    intent: 'Fill the year-end tax form template and ask me what is missing',
    mentions: [{ type: 'master', masterId: 'tax-form-master', role: 'layout' }],
    expectedRecipeId: 'r1',
    expectedPhases: ['Phase 3'],
    expectedStepOps: ['analyze', 'interview', 'compose', 'deliver'],
    expectedComposeStyle: 'fill_clone',
    expectedDeliverKind: 'single',
  },
  {
    family: 'C. Legal / Compliance / Risk',
    id: 'U17',
    description: 'MSA from playbook standard + deal terms interview',
    intent: 'Author an MSA from the playbook standard and deal terms',
    mentions: [{ type: 'master', masterId: 'playbook-standard', role: 'standard' }],
    expectedRecipeId: 'r3',
    expectedPhases: ['Phase 5'],
    expectedStepOps: ['extract_facts', 'select_evidence', 'compose', 'validate', 'deliver'],
    expectedComposeStyle: 'author',
    expectedDeliverKind: 'single',
  },
  {
    family: 'D. Medical / Clinical / Scientific writing',
    id: 'U27',
    description: 'Completeness score: draft vs ICH section list',
    intent: 'Check completeness of the CSR against the ICH section list',
    mentions: [{ type: 'master', masterId: 'ich-standard', role: 'standard' }],
    expectedRecipeId: 'r7',
    expectedPhases: ['Phase 5'],
    expectedStepOps: ['validate'],
  },
  {
    family: 'E. Sales / Marketing / Customer',
    id: 'U30',
    description: 'Proposal from RFP + KB case studies + brand skin',
    intent: 'Author a proposal from the standard playbook and case studies',
    mentions: [
      { type: 'master', masterId: 'rfp-standard', role: 'standard' },
      { type: 'kb', selector: { mode: 'ids', sourceIds: ['case-studies'] } },
    ],
    expectedRecipeId: 'r3',
    expectedPhases: ['Phase 5'],
    expectedStepOps: ['extract_facts', 'select_evidence', 'compose', 'validate', 'deliver'],
    expectedComposeStyle: 'author',
    expectedDeliverKind: 'single',
  },
  {
    family: 'F. Consulting / PMO / Delivery',
    id: 'U37',
    description: 'Steering pack: agenda + slides notes + decisions log merge',
    intent: 'Merge the steering pack: agenda, slide notes and decisions log into one PDF',
    mentions: [
      { type: 'master', masterId: 'agenda-master', role: 'layout' },
      { type: 'master', masterId: 'slides-master', role: 'layout' },
      { type: 'master', masterId: 'decisions-master', role: 'layout' },
    ],
    expectedRecipeId: 'r6',
    expectedPhases: ['Phase 5'],
    expectedStepOps: ['compose', 'deliver'],
    expectedComposeStyle: 'merge_pack',
    expectedDeliverKind: 'single',
  },
  {
    family: 'G. Education / Training / Exams',
    id: 'U42',
    description: 'Transcripts / report cards from grade CSV',
    intent: 'Mail merge transcripts and report cards from the grade CSV',
    mentions: [
      { type: 'master', masterId: 'transcript-template', role: 'layout' },
      { type: 'master', masterId: 'grade-csv', role: 'data' },
      { type: 'mapping', mappingId: 'grade-mapping' },
    ],
    expectedRecipeId: 'r2',
    expectedPhases: ['Phase 4'],
    expectedStepOps: ['analyze', 'map_schema', 'plan_instances', 'compose', 'deliver'],
    expectedComposeStyle: 'fill_clone',
    expectedDeliverKind: 'tree',
  },
  {
    family: 'H. Government / Admin / Ops',
    id: 'U45',
    description: 'Permit/application form interview (voice OK)',
    intent: 'Fill the permit application form template',
    mentions: [{ type: 'master', masterId: 'permit-form', role: 'layout' }],
    expectedRecipeId: 'r1',
    expectedPhases: ['Phase 3'],
    expectedStepOps: ['analyze', 'interview', 'compose', 'deliver'],
    expectedComposeStyle: 'fill_clone',
    expectedDeliverKind: 'single',
  },
  {
    family: 'I. Manufacturing / Quality / Supply',
    id: 'U50',
    description: 'CoA / CoC certificates from lot CSV',
    intent: 'Mail merge CoA and CoC certificates from the lot CSV',
    mentions: [
      { type: 'master', masterId: 'coc-template', role: 'layout' },
      { type: 'master', masterId: 'lot-csv', role: 'data' },
      { type: 'mapping', mappingId: 'lot-mapping' },
    ],
    expectedRecipeId: 'r2',
    expectedPhases: ['Phase 4'],
    expectedStepOps: ['analyze', 'map_schema', 'plan_instances', 'compose', 'deliver'],
    expectedComposeStyle: 'fill_clone',
    expectedDeliverKind: 'tree',
  },
  {
    family: 'J. Knowledge / Research / Internal comms',
    id: 'U58',
    description: 'Normalize messy uploads into house style DOCX',
    intent: 'Render messy uploads as a Markdown report in house style',
    mentions: [{ type: 'master', masterId: 'house-style-guide', role: 'layout' }],
    expectedRecipeId: 'r8',
    expectedPhases: ['Phase 6'],
    expectedStepOps: ['compose', 'deliver'],
    expectedComposeStyle: 'markdown',
    expectedDeliverKind: 'single',
  },
  {
    family: 'K. Hybrid / multi-step “sophisticated”',
    id: 'U70',
    description: 'Submission: fill → human approve → hold → release',
    intent: 'Check submission completeness before release',
    mentions: [{ type: 'master', masterId: 'submission-artifact', role: 'prior_artifact' }],
    expectedRecipeId: 'r7',
    expectedPhases: ['Phase 5'],
    expectedStepOps: ['validate'],
  },
];

describe('U-catalog fixtures (A–K)', () => {
  for (const fixture of U_CATALOG_FIXTURES) {
    it(`${fixture.id} — ${fixture.family}`, () => {
      const { spec, missing, ambiguous } = compiler.compile(fixture.intent, fixture.mentions);
      const recipe = RECIPE_CATALOG.find((r) => r.id === fixture.expectedRecipeId);

      expect(recipe).toBeDefined();
      expect(recipe!.id).toBe(fixture.expectedRecipeId);
      expect(recipe!.phases).toEqual(fixture.expectedPhases);

      expect(spec.steps.map((s) => s.op)).toEqual(fixture.expectedStepOps);

      if (fixture.expectedComposeStyle) {
        const compose = spec.steps.find((s) => s.op === 'compose') as { style: ComposeStyle } | undefined;
        expect(compose).toBeDefined();
        expect(compose).toMatchObject({ style: fixture.expectedComposeStyle });
      }

      if (fixture.expectedDeliverKind) {
        const deliver = spec.steps.find((s) => s.op === 'deliver') as { target: { kind: string } } | undefined;
        expect(deliver).toBeDefined();
        expect(deliver).toMatchObject({ target: { kind: fixture.expectedDeliverKind } });
      }

      const validation = validateJobSpec(spec);
      expect(validation.ok).toBe(true);
      expect(validation.issues).toEqual([]);

      expect(missing).toEqual([]);
      expect(ambiguous).toEqual([]);
    });
  }
});

interface RecipeSmokeCase {
  id: string;
  params: { intent?: string; masterIds?: Record<string, string> };
  note?: string;
}

const RECIPE_COMPILE_CASES: RecipeSmokeCase[] = [
  { id: 'r1', params: { intent: 'Fill template', masterIds: { layout_master: 'm1' } } },
  { id: 'r4', params: { intent: 'Skin author', masterIds: { skin_master: 'skin-1', content_master: 'content-1' } } },
  { id: 'r5', params: { intent: 'Delta revise', masterIds: { prior_artifact: 'prior-1', new_master: 'new-1' } } },
  { id: 'r6', params: { intent: 'Rollup', masterIds: { masters: 'm1, m2' } } },
  { id: 'r7', params: { intent: 'Validate only' } },
  { id: 'r8', params: { intent: 'Markdown report' } },
  { id: 'r9', params: { intent: 'HTML preview' } },
  { id: 'r10', params: { intent: 'JSON export' } },
  { id: 'r11', params: { intent: 'YAML export' } },
  { id: 'r12', params: { intent: 'Diagram generation' } },
  { id: 'r13', params: { intent: 'LaTeX document' } },
];

describe('compileRecipeToSpec smoke', () => {
  for (const { id, params } of RECIPE_COMPILE_CASES) {
    it(`compiles ${id} to a valid JobSpec`, () => {
      const spec = compileRecipeToSpec(id, params);
      expect(spec).not.toBeNull();
      const result = validateJobSpec(spec!);
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
    });
  }
});
