/**
 * Prompt section registration and identity block helpers extracted from Agent.ts (REFACTOR-2).
 */
import {
  PromptAssembly,
  createProviderPromptSection,
  createIdentitySection,
  createPersonaToneSection,
  createWorkingDirectorySection,
  createRulesSection,
  createOutputFormatSection,
  createCodingRulesSection,
  createCodebaseContextSection,
  createTaskStateSection,
  createCategoryOverlaySection,
  createCompactRulesSection,
  createLocalPersonaGuardSection,
  createCrewPrivateConductSection,
  createQuestionnaireGuideSection,
  createCrewRosterGuideSection,
  createChatMarkdownSection,
  createVisualStageSection,
  createArticlesSection,
  createCurrentTimeSection,
  createSchedulingSection,
  createThirdPartyServicesSection,
  createLearningsSection,
  createChannelFocusSection,
  createChannelSuperSessionSection,
  createChannelLinkedContextSection,
  createChannelMessagingSection,
  createMultiCrewSection,
  createUserSection,
  createTaskPanelSection,
  createActiveTodosSection,
  createMissionPlanSection,
  createSessionNarrativeSection,
  createTurnFeedbackSection,
  createInstructionsSection,
  createMemoryContextSection,
  createSystemOverrideSection,
  createTurnModeSection,
  createHarnessSection,
  createGoalSection,
  createExecutableSkillsSection,
  createCapabilitiesSection,
  type SectionContext,
} from '../prompt/assembly/index.js';
import { createDocumentStudioSection } from './document-studio-prompts.js';

/** Slice of Agent required by the prompt registration helpers. */
export interface PromptRegistrationContext {
  promptAssembly: PromptAssembly;
  options: {
    promptProfile?: string;
    channelSession?: boolean;
    crewPrivateHost?: { name?: string; callsign?: string } | null;
  };
  personaName?: string;
  usesCompactContext(): boolean;
  createSectionContext(): SectionContext;
}

/**
 * Register prompt sections based on the agent's profile (crew_worker, crew_private, channel, default).
 */
export function registerPromptSections(ctx: PromptRegistrationContext, systemOverride?: string): void {
  if (ctx.options.promptProfile === 'voice') {
    const secCtx = ctx.createSectionContext();
    ctx.promptAssembly
      .register(createProviderPromptSection(secCtx))
      .register(createIdentitySection(secCtx))
      .register(createCompactRulesSection({ bypassPermissions: secCtx.bypassPermissions }))
      .register(createVisualStageSection())
      .register(createCurrentTimeSection(secCtx))
      .register(createUserSection(secCtx))
      .register(createMemoryContextSection(secCtx));
    if (systemOverride) {
      ctx.promptAssembly.register(createSystemOverrideSection(systemOverride));
    }
    return;
  }

  if (ctx.options.promptProfile === 'crew_worker') {
    const secCtx = ctx.createSectionContext();
    ctx.promptAssembly
      .register(createRulesSection({ technicalExecutor: true, bypassPermissions: secCtx.bypassPermissions }))
      .register(createTurnModeSection(secCtx))
      .register(createMissionPlanSection(secCtx.scopePath))
      .register(createQuestionnaireGuideSection())
      .register(createChatMarkdownSection())
      .register(createArticlesSection())
      .register(createCurrentTimeSection(secCtx))
      .register(createMemoryContextSection(secCtx));
    if (systemOverride) {
      ctx.promptAssembly.register(createSystemOverrideSection(systemOverride));
    }
    return;
  }

  if (ctx.options.promptProfile === 'crew_private') {
    const secCtx = ctx.createSectionContext();
    const crewName = ctx.options.crewPrivateHost?.name?.trim() || ctx.personaName || 'Specialist';
    if (ctx.usesCompactContext()) {
      ctx.promptAssembly
        .register(createCrewPrivateConductSection())
        .register(createLocalPersonaGuardSection(crewName))
        .register(createVisualStageSection())
        .register(createWorkingDirectorySection(secCtx))
        .register(createUserSection(secCtx))
        .register(createSessionNarrativeSection(secCtx))
        .register(createMemoryContextSection(secCtx));
    } else {
      ctx.promptAssembly
        .register(createCrewPrivateConductSection())
        .register(createTurnModeSection(secCtx))
        .register(createVisualStageSection())
        .register(createQuestionnaireGuideSection())
        .register(createChatMarkdownSection())
        .register(createArticlesSection())
        .register(createCurrentTimeSection(secCtx))
        .register(createWorkingDirectorySection(secCtx))
        .register(createLearningsSection(secCtx))
        .register(createSessionNarrativeSection(secCtx))
        .register(createTurnFeedbackSection(secCtx))
        .register(createUserSection(secCtx))
        .register(createMemoryContextSection(secCtx))
        .register(createInstructionsSection(secCtx.scopePath));
    }
    if (systemOverride) {
      ctx.promptAssembly.register(createSystemOverrideSection(systemOverride));
    }
    return;
  }

  if (ctx.options.channelSession) {
    const secCtx = ctx.createSectionContext();
    ctx.promptAssembly
      .register(createProviderPromptSection(secCtx))
      .register(createIdentitySection(secCtx))
      .register(createPersonaToneSection(secCtx))
      .register(createWorkingDirectorySection(secCtx))
      .register(createCompactRulesSection({ bypassPermissions: secCtx.bypassPermissions }))
      .register(createTurnModeSection(secCtx))
      .register(createMissionPlanSection(secCtx.scopePath))
      .register(createChannelSuperSessionSection(ctx.personaName))
      .register(createChannelLinkedContextSection(secCtx))
      .register(createChannelMessagingSection(ctx.personaName))
      .register(createThirdPartyServicesSection())
      .register(createVisualStageSection())
      .register(createChatMarkdownSection())
      .register(createArticlesSection())
      .register(createCurrentTimeSection(secCtx))
      .register(createSchedulingSection())
      .register(createLearningsSection(secCtx))
      .register(createMultiCrewSection(secCtx))
      .register(createCrewRosterGuideSection())
      .register(createUserSection(secCtx))
      .register(createTaskPanelSection())
      .register(createActiveTodosSection(secCtx))
      .register(createMemoryContextSection(secCtx))
      .register(createHarnessSection(secCtx))
      .register(createGoalSection(secCtx))
      .register(createExecutableSkillsSection(secCtx))
      .register(createCapabilitiesSection(secCtx))
      .register(createInstructionsSection(secCtx.scopePath));
    if (systemOverride) {
      ctx.promptAssembly.register(createSystemOverrideSection(systemOverride));
    }
    return;
  }

  const secCtx = ctx.createSectionContext();
  if (ctx.usesCompactContext()) {
    ctx.promptAssembly
      .register(createProviderPromptSection(secCtx))
      .register(createIdentitySection(secCtx))
      .register(createPersonaToneSection(secCtx))
      .register(createLocalPersonaGuardSection(ctx.personaName))
      .register(createWorkingDirectorySection(secCtx))
      .register(createCompactRulesSection({ bypassPermissions: secCtx.bypassPermissions }))
      .register(createTurnModeSection(secCtx))
      .register(createMissionPlanSection(secCtx.scopePath))
      .register(createCrewRosterGuideSection(true))
      .register(createVisualStageSection())
      .register(createUserSection(secCtx))
      .register(createSessionNarrativeSection(secCtx))
      .register(createTaskPanelSection())
      .register(createActiveTodosSection(secCtx))
      .register(createMemoryContextSection(secCtx))
      .register(createHarnessSection(secCtx))
      .register(createGoalSection(secCtx))
      .register(createExecutableSkillsSection(secCtx))
      .register(createInstructionsSection(secCtx.scopePath));
  } else {
    ctx.promptAssembly
      .register(createProviderPromptSection(secCtx))
      .register(createIdentitySection(secCtx))
      .register(createPersonaToneSection(secCtx))
      .register(createWorkingDirectorySection(secCtx))
      .register(createRulesSection({ bypassPermissions: secCtx.bypassPermissions }))
      .register(createTurnModeSection(secCtx))
      .register(createOutputFormatSection())
      .register(createCodingRulesSection())
      .register(createCodebaseContextSection(secCtx))
      .register(createTaskStateSection(secCtx))
      .register(createCategoryOverlaySection(secCtx))
      .register(createDocumentStudioSection())
      .register(createMissionPlanSection(secCtx.scopePath))
      .register(createThirdPartyServicesSection())
      .register(createVisualStageSection())
      .register(createQuestionnaireGuideSection())
      .register(createChatMarkdownSection())
      .register(createArticlesSection())
      .register(createCurrentTimeSection(secCtx))
      .register(createSchedulingSection())
      .register(createLearningsSection(secCtx))
      .register(createChannelFocusSection(secCtx))
      .register(createMultiCrewSection(secCtx))
      .register(createCrewRosterGuideSection())
      .register(createUserSection(secCtx))
      .register(createSessionNarrativeSection(secCtx))
      .register(createTurnFeedbackSection(secCtx))
      .register(createTaskPanelSection())
      .register(createActiveTodosSection(secCtx))
      .register(createMemoryContextSection(secCtx))
      .register(createHarnessSection(secCtx))
      .register(createGoalSection(secCtx))
      .register(createExecutableSkillsSection(secCtx))
      .register(createCapabilitiesSection(secCtx))
      .register(createInstructionsSection(secCtx.scopePath));
  }

  if (systemOverride) {
    ctx.promptAssembly.register(createSystemOverrideSection(systemOverride));
  }
}
