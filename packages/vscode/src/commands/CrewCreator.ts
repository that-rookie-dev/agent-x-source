import * as vscode from 'vscode';
import type { CommandDeps } from './registerAllCommands';

export function showCrewCreator(deps: CommandDeps): () => Promise<void> {
  return async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter crew name',
      placeHolder: 'e.g., Full Stack Team',
      ignoreFocusOut: true,
      title: 'Agent-X: Create Crew — Step 1/4: Name',
      validateInput: (value) => {
        if (!value || value.trim().length === 0) return 'Name is required';
        if (value.trim().length > 60) return 'Name must be 60 characters or less';
        return undefined;
      },
    });

    if (!name) return;

    const systemPrompt = await getSystemPrompt(name.trim());

    if (!systemPrompt) return;

    const emotion = await selectEmotion();
    if (emotion === undefined) return;

    const confirmed = await previewAndConfirm(name.trim(), systemPrompt, emotion);
    if (!confirmed) return;

    try {
      const config = {
        name: name.trim(),
        description: `${name.trim()} crew`,
        members: [{ name: name.trim(), role: 'primary', personality: 'adaptive' }],
      };

      await deps.engineLifecycle.createCrew(config);
      deps.configBridge.refreshCrews();
      deps.statusBarManager.updateCrewIndicator(name.trim());

      vscode.window.showInformationMessage(`Agent-X: Crew "${name.trim()}" created.`);
    } catch (error) {
      vscode.window.showErrorMessage(`Agent-X: Failed to create crew — ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

async function getSystemPrompt(crewName: string): Promise<string | undefined> {
  const templates = [
    {
      label: '$(code) Code Expert',
      prompt: `You are ${crewName}, an expert software engineer. You write clean, efficient, well-documented code.`,
    },
    {
      label: '$(book) Creative Writer',
      prompt: `You are ${crewName}, a creative writing assistant. You help with storytelling and narrative structure.`,
    },
    {
      label: '$(shield) Security Analyst',
      prompt: `You are ${crewName}, a cybersecurity specialist. You identify vulnerabilities and suggest secure practices.`,
    },
    {
      label: '$(graph) Data Scientist',
      prompt: `You are ${crewName}, a data science expert. You help with analysis, visualization, and ML models.`,
    },
    {
      label: '$(tools) DevOps Engineer',
      prompt: `You are ${crewName}, a DevOps specialist. You help with CI/CD, containers, and cloud deployment.`,
    },
    {
      label: '$(pencil) Custom (blank)',
      prompt: `You are ${crewName}.`,
    },
  ];

  const selected = await vscode.window.showQuickPick(templates, {
    placeHolder: 'Select a template to start from',
    title: `Agent-X: Create Crew — Step 2/4: Template`,
    ignoreFocusOut: true,
  });

  if (!selected) return undefined;

  const edited = await vscode.window.showInputBox({
    prompt: 'Edit the system prompt (or press Enter to accept)',
    value: selected.prompt,
    ignoreFocusOut: true,
    title: `Agent-X: Create Crew — Step 2/4: Edit Prompt`,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) return 'System prompt is required';
      return undefined;
    },
  });

  return edited ?? undefined;
}

async function selectEmotion(): Promise<string | null | undefined> {
  interface EmotionItem extends vscode.QuickPickItem {
    emotion: string | null;
  }

  const EMOTION_ICONS: Record<string, string> = {
    professional: '$(briefcase)',
    friendly: '$(smiley)',
    witty: '$(lightbulb)',
    kind: '$(heart)',
    funny: '$(beaker)',
    arrogant: '$(star-full)',
    flirty: '$(symbol-event)',
    happy: '$(squirrel)',
    sad: '$(cloud)',
    sarcastic: '$(comment-discussion)',
  };

  const EMOTION_DESCRIPTIONS: Record<string, string> = {
    professional: 'Formal and business-oriented',
    friendly: 'Warm and approachable',
    witty: 'Clever and humorous',
    kind: 'Gentle and supportive',
    funny: 'Playful and entertaining',
    arrogant: 'Confident and assertive',
    flirty: 'Charming and playful',
    happy: 'Cheerful and optimistic',
    sad: 'Melancholic and thoughtful',
    sarcastic: 'Dry and ironic',
  };

  const items: EmotionItem[] = [
    {
      label: '$(circle-slash) No Emotion',
      description: 'Neutral, no personality overlay',
      emotion: null,
    },
    ...Object.entries(EMOTION_ICONS).map(([emotion, icon]) => ({
      label: `${icon} ${emotion.charAt(0).toUpperCase() + emotion.slice(1)}`,
      description: EMOTION_DESCRIPTIONS[emotion] || '',
      emotion,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select crew emotion/personality',
    title: 'Agent-X: Create Crew — Step 3/4: Emotion',
    ignoreFocusOut: true,
  });

  if (!selected) return undefined;
  return (selected as EmotionItem).emotion;
}

async function previewAndConfirm(
  name: string,
  _systemPrompt: string,
  _emotion: string | null,
): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    `Create crew "${name}"?`,
    'Create',
    'Cancel',
  );

  return choice === 'Create';
}
