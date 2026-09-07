import { describe, expect, it } from 'vitest';
import {
  applyInstructedActionConsent,
  detectsAffirmativeActionConsent,
  detectsExplicitDeliverableRequest,
  detectsSessionProactiveConsentWaiver,
  isProactiveDeliverableTool,
  lastAssistantOfferedAction,
  proactiveDeliverableConsentInstruction,
} from '../src/services/tool/proactive-deliverable-consent.js';

describe('proactive-deliverable-consent', () => {
  it('flags deliverable tools', () => {
    expect(isProactiveDeliverableTool('save_to_article')).toBe(true);
    expect(isProactiveDeliverableTool('web_search')).toBe(false);
  });

  it('detects session waivers', () => {
    expect(detectsSessionProactiveConsentWaiver("don't ask me for permission, just carry on")).toBe(true);
    expect(detectsSessionProactiveConsentWaiver('please analyse this carefully')).toBe(false);
  });

  it('detects explicit save/create requests', () => {
    expect(detectsExplicitDeliverableRequest('Save this analysis as an article')).toBe(true);
    expect(detectsExplicitDeliverableRequest('What is TVK known for?')).toBe(false);
    expect(detectsExplicitDeliverableRequest('Yes. Please save it into the sidebar article now. Do not ask again. Just save it.')).toBe(true);
    expect(detectsExplicitDeliverableRequest('just save it')).toBe(true);
  });

  it('detects spoken yes / please after an offer', () => {
    expect(detectsAffirmativeActionConsent('Yes, please.')).toBe(true);
    expect(detectsAffirmativeActionConsent('Yes, please save it.')).toBe(true);
    expect(detectsAffirmativeActionConsent('Yes, save it.')).toBe(true);
    expect(detectsAffirmativeActionConsent('can you search for the latest news')).toBe(false);
    expect(lastAssistantOfferedAction('Shall I save it to the Articles sidebar now?')).toBe(true);
    expect(lastAssistantOfferedAction('An offline mobile app with a local LLM.')).toBe(false);
  });

  it('grants deliverable consent after the user confirms a save', () => {
    const granted: string[] = [];
    let waived = false;
    const result = applyInstructedActionConsent(
      {
        setSkipLowRiskProactiveConsent: (enabled) => { waived = enabled; },
        grantToolConsent: (id) => { granted.push(id); },
        getRegistry: () => ({ list: () => [{ id: 'save_to_article' }, { id: 'web_search' }] }),
      },
      'Yes, please.',
      'I\'ve prepared the full MVP scope. Would you like me to save it to the Articles sidebar now?',
    );
    expect(result.affirmative).toBe(true);
    expect(granted).toContain('save_to_article');
    expect(granted).not.toContain('web_search');
    expect(waived).toBe(false);
  });

  it('treats do-not-ask-again as a session waiver', () => {
    expect(detectsSessionProactiveConsentWaiver('Yes. Do not ask again. Just save it.')).toBe(true);
    const granted: string[] = [];
    applyInstructedActionConsent(
      {
        setSkipLowRiskProactiveConsent: () => {},
        grantToolConsent: (id) => { granted.push(id); },
      },
      'Do not ask again. Just save it.',
    );
    expect(granted).toContain('save_to_article');
  });

  it('returns a plain-text ask instruction', () => {
    const text = proactiveDeliverableConsentInstruction('save_to_article');
    expect(text).toMatch(/plain-text question/i);
    expect(text).toMatch(/STOP this turn/i);
    expect(text).toMatch(/Do not use ask_clarification/i);
  });
});
