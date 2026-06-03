import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';
import { createDisabledHandler } from './types';

export function adaptMediaImage(
  refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  const result: AdapterCategoryResult = { overridden: [], keptAsIs: [], disabled: [] };

  const disabledTools = ['image_resize', 'image_convert', 'image_ocr'];
  const reason = 'Image processing tools require system-level binaries (sips/ImageMagick/Tesseract) that may not be available';

  for (const toolId of disabledTools) {
    refs.executor.registerHandler(toolId, createDisabledHandler(toolId, reason));
    result.disabled.push(toolId);
  }

  result.keptAsIs.push('chart_generate', 'qr_generate', 'image_view');

  return result;
}
