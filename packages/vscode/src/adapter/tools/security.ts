import type { ToolkitRefs, AdapterContext, AdapterCategoryResult } from './types';

export function adaptSecurityCrypto(
  _refs: ToolkitRefs,
  _ctx: AdapterContext,
): AdapterCategoryResult {
  return {
    overridden: [],
    keptAsIs: ['encrypt_file', 'decrypt_file', 'jwt_decode', 'secret_generate'],
    disabled: [],
  };
}
