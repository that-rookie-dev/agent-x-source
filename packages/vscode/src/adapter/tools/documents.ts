import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptDocuments(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: [
      'csv_create', 'pdf_create', 'docx_create', 'pptx_create', 'xlsx_create',
      'pdf_read', 'docx_read', 'xlsx_read', 'pptx_read',
      'doc_markdown', 'doc_html', 'doc_json', 'doc_yaml', 'doc_diagram', 'doc_latex',
    ],
    disabled: [],
  };
}
