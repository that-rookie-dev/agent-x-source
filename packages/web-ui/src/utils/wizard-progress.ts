/** Browser persistence for first-run setup wizard step state (not server config). */
import { AGENTX_CLIENT_STORAGE_PREFIX } from './client-storage';

export const WIZARD_PROGRESS_STORAGE_KEY = `${AGENTX_CLIENT_STORAGE_PREFIX}wizard_progress`;

export interface WizardProgress {
  step: number;
  selectedProvider: string;
  selectedModel: string;
  callsign: string;
  selectedBackend: string;
  selectedLocalModel?: string | null;
  skipLocalModel?: boolean;
  voiceCalibrated?: boolean;
  telegramLinked?: boolean;
  personaName?: string;
  personaDescription?: string;
  personaCommStyle?: string;
  personaDecisionStyle?: string;
  personaDomain?: string;
  personaTraits?: string[];
}

export function saveWizardProgress(data: WizardProgress): void {
  try {
    localStorage.setItem(WIZARD_PROGRESS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

export function loadWizardProgress(): WizardProgress | null {
  try {
    const raw = localStorage.getItem(WIZARD_PROGRESS_STORAGE_KEY);
    return raw ? JSON.parse(raw) as WizardProgress : null;
  } catch {
    return null;
  }
}

/** Drop stale wizard UI state (e.g. fresh install / new root user). */
export function clearWizardProgress(): void {
  try {
    localStorage.removeItem(WIZARD_PROGRESS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
