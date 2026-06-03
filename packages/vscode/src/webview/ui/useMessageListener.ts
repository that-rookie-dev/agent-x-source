import { useEffect } from 'react';
import { messageBus } from './messageBus';

export function useMessageListener<T = unknown>(
  type: string,
  handler: (data: T) => void,
): void {
  useEffect(() => {
    const unsub = messageBus.on<T>(type, handler);
    return unsub;
  }, [type, handler]);
}
