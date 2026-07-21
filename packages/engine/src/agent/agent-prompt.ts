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
  createCompactRulesSection,
  createLocalPersonaGuardSection,
  createCrewPrivateConductSection,
  createQuestionnaireGuideSection,
  createCrewRosterGuideSection,
  createChatMarkdownSection,
  createMarkdownSection,
  createCurrentTimeSection,
  createSchedulingSection,
  createThirdPartyServicesSection,
  createLearningsSection,
  createSkillsSection,
  createFormalSkillsSection,
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
  type SectionContext,
} from '../prompt/assembly/index.js';

/** Slice of Agent required by the prompt registration helpers. */
export interface PromptRegistrationContext {
  promptAssembly: PromptAssembly;
  options: {
    promptProfile?: string;
    channelSession?: boolean;
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
      .register(createCompactRulesSection())
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
      .register(createRulesSection({ technicalExecutor: true }))
      .register(createMissionPlanSection(secCtx.scopePath))
      .register(createQuestionnaireGuideSection())
      .register(createChatMarkdownSection())
      .register(createMarkdownSection())
      .register(createCurrentTimeSection(secCtx))
      .register(createMemoryContextSection(secCtx));
    if (systemOverride) {
      ctx.promptAssembly.register(createSystemOverrideSection(systemOverride));
    }
    return;
  }

  if (ctx.options.promptProfile === 'crew_private') {
    const secCtx = ctx.createSectionContext();
    if (ctx.usesCompactContext()) {
      ctx.promptAssembly
        .register(createCrewPrivateConductSection())
        .register(createLocalPersonaGuardSection(ctx.personaName))
        .register(createWorkingDirectorySection(secCtx))
        .register(createUserSection(secCtx))
        .register(createSessionNarrativeSection(secCtx))
        .register(createMemoryContextSection(secCtx));
    } else {
      ctx.promptAssembly
        .register(createCrewPrivateConductSection())
        .register(createQuestionnaireGuideSection())
        .register(createChatMarkdownSection())
        .register(createMarkdownSection())
        .register(createCurrentTimeSection(secCtx))
        .register(createWorkingDirectorySection(secCtx))
        .register(createLearningsSection(secCtx))
        .register(createSkillsSection(secCtx))
        .register(createFormalSkillsSection(secCtx))
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
      .register(createCompactRulesSection())
      .register(createMissionPlanSection(secCtx.scopePath))
      .register(createChannelSuperSessionSection(ctx.personaName))
      .register(createChannelLinkedContextSection(secCtx))
      .register(createChannelMessagingSection(ctx.personaName))
      .register(createThirdPartyServicesSection())
      .register(createChatMarkdownSection())
      .register(createMarkdownSection())
      .register(createCurrentTimeSection(secCtx))
      .register(createSchedulingSection())
      .register(createLearningsSection(secCtx))
      .register(createSkillsSection(secCtx))
      .register(createFormalSkillsSection(secCtx))
      .register(createMultiCrewSection(secCtx))
      .register(createCrewRosterGuideSection())
      .register(createUserSection(secCtx))
      .register(createTaskPanelSection())
      .register(createActiveTodosSection(secCtx))
      .register(createMemoryContextSection(secCtx))
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
      .register(createCompactRulesSection())
      .register(createMissionPlanSection(secCtx.scopePath))
      .register(createUserSection(secCtx))
      .register(createSessionNarrativeSection(secCtx))
      .register(createTaskPanelSection())
      .register(createActiveTodosSection(secCtx))
      .register(createMemoryContextSection(secCtx))
      .register(createInstructionsSection(secCtx.scopePath));
  } else {
    ctx.promptAssembly
      .register(createProviderPromptSection(secCtx))
      .register(createIdentitySection(secCtx))
      .register(createPersonaToneSection(secCtx))
      .register(createWorkingDirectorySection(secCtx))
      .register(createRulesSection())
      .register(createMissionPlanSection(secCtx.scopePath))
      .register(createThirdPartyServicesSection())
      .register(createQuestionnaireGuideSection())
      .register(createChatMarkdownSection())
      .register(createMarkdownSection())
      .register(createCurrentTimeSection(secCtx))
      .register(createSchedulingSection())
      .register(createLearningsSection(secCtx))
      .register(createSkillsSection(secCtx))
      .register(createFormalSkillsSection(secCtx))
      .register(createChannelFocusSection(secCtx))
      .register(createMultiCrewSection(secCtx))
      .register(createCrewRosterGuideSection())
      .register(createUserSection(secCtx))
      .register(createSessionNarrativeSection(secCtx))
      .register(createTurnFeedbackSection(secCtx))
      .register(createTaskPanelSection())
      .register(createActiveTodosSection(secCtx))
      .register(createMemoryContextSection(secCtx))
      .register(createInstructionsSection(secCtx.scopePath));
  }

  if (systemOverride) {
    ctx.promptAssembly.register(createSystemOverrideSection(systemOverride));
  }
}
