import { useCallback } from 'react';
import { collectClientSituation } from '../client-situation.js';

export function useClientSituation() {
  const collect = useCallback(() => collectClientSituation(), []);
  return { collect };
}
