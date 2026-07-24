/** Supported template file formats. */
export type TemplateFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'doc' | 'other';

/** How a content slot was discovered. */
export type TemplateFieldSource = 'placeholder' | 'llm' | 'form' | 'manual';

/** Background analysis of a raw uploaded template. */
export type TemplateAnalysisStatus = 'pending' | 'analyzing' | 'ready' | 'failed';

/**
 * A content slot in the template design.
 * Templates are design masters — analysis maps variable content regions
 * (including sample/example text already in the file), not empty gaps.
 * Missing data at generate time leaves the slot blank; extra data is ignored.
 */
export interface TemplateField {
  key: string;
  label: string;
  /** Slots are never blocking — missing values stay blank. */
  required?: boolean;
  example?: string;
  /** Nearby label/section that anchors this slot in the design. */
  context?: string;
  /** Blank token observed (e.g. underscores), when the slot was empty. */
  blankToken?: string;
  /**
   * Sample/example text currently in the master that should be replaced
   * when generating a new document (e.g. "John Doe", "Acme Corp").
   */
  sampleValue?: string;
  source?: TemplateFieldSource;
  /** PDF overlay target (1-based page), when known. */
  page?: number;
  x?: number;
  y?: number;
  width?: number;
  fontSize?: number;
}

/**
 * Canonical template record — binary file is the source of truth.
 * Generation clones this master and substitutes content slots so the
 * output looks exactly like the template, in the same format.
 */
export interface DocumentTemplate {
  id: string;
  name: string;
  description?: string;
  mimeType: string;
  size: number;
  storageId: string;
  format: TemplateFormat;
  /**
   * True when the system can produce a design-faithful copy
   * (docx/xlsx/pdf with mapped content slots or native placeholders).
   */
  fillable: boolean;
  fields: TemplateField[];
  /**
   * Short brief of the template design: document type, layout, sections,
   * fixed chrome vs variable content. Used by the agent to understand the master.
   */
  designSummary?: string;
  tags: string[];
  analysisStatus: TemplateAnalysisStatus;
  analysisError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentTemplateInput {
  name: string;
  description?: string;
  mimeType: string;
  size: number;
  storageId: string;
  format: TemplateFormat;
  fillable: boolean;
  fields?: TemplateField[];
  designSummary?: string | null;
  tags?: string[];
  analysisStatus?: TemplateAnalysisStatus;
  analysisError?: string | null;
}

export interface UpdateDocumentTemplateInput {
  name?: string;
  description?: string | null;
  fields?: TemplateField[];
  designSummary?: string | null;
  tags?: string[];
  fillable?: boolean;
  analysisStatus?: TemplateAnalysisStatus;
  analysisError?: string | null;
  /** Replace stored binary (e.g. after internal slot instrumentation). */
  storageId?: string;
  size?: number;
}

export interface TemplateFillRequest {
  /** Map of content-slot key → value. Missing keys stay blank; unknown keys ignored. */
  values: Record<string, string>;
  /** Optional output filename (defaults to `<name>-filled.<ext>`). */
  outputName?: string;
  /** Session to attach the filled file under (optional). */
  sessionId?: string;
}

export interface TemplateFillResult {
  templateId: string;
  templateName: string;
  outputName: string;
  mimeType: string;
  /** Attachment store id for the generated copy. */
  storageId: string;
  /** Absolute path when available (for agent file tools). */
  path?: string;
  /** Slot keys left blank because no value was provided. */
  missingFields: string[];
}

export interface DocumentTemplateListResponse {
  templates: DocumentTemplate[];
}
