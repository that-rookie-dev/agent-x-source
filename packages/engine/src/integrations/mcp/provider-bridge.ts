import type { IntegrationProvider } from '@agentx/shared';
import { createGoogleDriveBridgeTools, type GoogleDriveBridgeTool } from './google-drive-bridge.js';

export type IntegrationBridgeTool = GoogleDriveBridgeTool;

export function getProviderBridgeTools(provider: IntegrationProvider): IntegrationBridgeTool[] {
  if (provider.id === 'google-drive') {
    return createGoogleDriveBridgeTools(provider);
  }
  return [];
}
