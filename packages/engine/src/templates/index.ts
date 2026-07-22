export { TemplateService } from './TemplateService.js';
export { TemplateStore } from './TemplateStore.js';
export { getTemplateService, setTemplateService } from './global-manager.js';
export {
  PLACEHOLDER_RE,
  detectTemplateFormat,
  extractPlaceholderKeys,
  fieldsFromKeys,
  humanizeFieldKey,
  isFillableFormat,
  scanTemplatePlaceholders,
} from './placeholder-scan.js';
export { fillTemplateBuffer } from './template-fill.js';
export {
  analyzeTemplateDesign,
  analyzeTemplateDesignWithLlm,
  discoverTemplateFields,
  discoverFieldsWithLlm,
  extractTemplatePlainText,
} from './field-discover.js';
export { instrumentTemplateBuffer } from './template-instrument.js';
