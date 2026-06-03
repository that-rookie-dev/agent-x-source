import * as vscode from 'vscode';
import type { SkillGenerator, GeneratedSkill, ReflectionLoop } from '@agentx/engine';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

interface SkillTreeItem {
  kind: 'skill-header' | 'generated-skill' | 'bundled-skill' | 'reflection-header' | 'learning' | 'empty';
  label: string;
  description?: string;
  tooltip?: string;
  skill?: GeneratedSkill;
  learningText?: string;
}

export class SkillsAdapter implements vscode.TreeDataProvider<SkillTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private generator: SkillGenerator | null = null;
  private reflectionLoop: ReflectionLoop | null = null;

  attach(generator: SkillGenerator, reflectionLoop?: ReflectionLoop): void {
    this.generator = generator;
    this.reflectionLoop = reflectionLoop ?? null;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }

    if (element.kind === 'skill-header' || element.kind === 'reflection-header') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon(
        element.kind === 'skill-header' ? 'symbol-event' : 'lightbulb',
      );
      return item;
    }

    if (element.kind === 'learning') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.tooltip = element.learningText;
      item.iconPath = new vscode.ThemeIcon('check');
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = new vscode.ThemeIcon(
      element.kind === 'generated-skill' ? 'zap' : 'bookmark',
    );
    item.contextValue = element.kind === 'generated-skill' ? 'generated-skill' : 'bundled-skill';
    item.command = {
      command: 'agentx.skill.viewDetail',
      title: 'View Skill',
      arguments: [element.skill],
    };
    return item;
  }

  getChildren(element?: SkillTreeItem): SkillTreeItem[] {
    if (!element) {
      return this.getRootGroups();
    }

    if (element.kind === 'skill-header') {
      return this.getSkillsList();
    }

    if (element.kind === 'reflection-header') {
      return this.getLearnings();
    }

    return [];
  }

  private getRootGroups(): SkillTreeItem[] {
    if (!this.generator) {
      return [{ kind: 'empty', label: 'No agent active' }];
    }

    const groups: SkillTreeItem[] = [
      { kind: 'skill-header', label: 'Skills' },
    ];

    if (this.reflectionLoop && this.reflectionLoop.getHistory().length > 0) {
      groups.push({ kind: 'reflection-header', label: 'Reflective Learnings' });
    }

    return groups;
  }

  private getSkillsList(): SkillTreeItem[] {
    if (!this.generator) return [];

    const all = this.generator.getAll();
    if (all.length === 0) {
      return [{ kind: 'empty', label: 'No skills available' }];
    }

    return all.map(skill => ({
      kind: (skill.id.startsWith('skill-') && !skill.id.startsWith('skill-init') && !skill.id.startsWith('skill-setup') && !skill.id.startsWith('skill-dockerize'))
        ? 'generated-skill' as const
        : 'bundled-skill' as const,
      label: skill.name,
      description: `${skill.tools.length} tools \u2022 used ${skill.usageCount}x`,
      tooltip: [
        `Name: ${skill.name}`,
        `Description: ${skill.description}`,
        `Triggers: ${skill.triggerPatterns.join(', ')}`,
        `Tools: ${skill.tools.join(', ')}`,
        `Usage Count: ${skill.usageCount}`,
        `Created: ${skill.createdAt}`,
        skill.id.startsWith('skill-') ? 'Generated' : 'Bundled',
      ].join('\n'),
      skill,
    }));
  }

  private getLearnings(): SkillTreeItem[] {
    if (!this.reflectionLoop) return [];

    const history = this.reflectionLoop.getHistory();
    if (history.length === 0) return [];

    const learnings = this.reflectionLoop.getCumulativeLearnings();
    if (!learnings) return [{ kind: 'learning', label: 'No learnings yet' }];

    const lines = learnings.split('\n').filter(l => l.trim().length > 0 && /^\d+\./.test(l.trim()));
    return lines.map(line => ({
      kind: 'learning' as const,
      label: line.replace(/^\d+\.\s*/, '').slice(0, 60),
      description: line.length > 60 ? '...' : '',
      learningText: line.replace(/^\d+\.\s*/, ''),
    }));
  }

  async viewDetail(skill: GeneratedSkill): Promise<void> {
    const content = [
      `Skill: ${skill.name}`,
      '\u2550'.repeat(40),
      '',
      `ID: ${skill.id}`,
      `Description: ${skill.description}`,
      `Category: ${skill.id.startsWith('skill-') && !skill.id.includes('-init') ? 'Generated' : 'Bundled'}`,
      `Usage Count: ${skill.usageCount}`,
      `Created: ${skill.createdAt}`,
      '',
      'Trigger Patterns:',
      ...skill.triggerPatterns.map(p => `  \u2022 ${p}`),
      '',
      'Tools Used:',
      ...skill.tools.map(t => `  \u2022 ${t}`),
      '',
      'Prompt Template:',
      skill.prompt,
    ].join('\n');

    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'plaintext',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  async deleteSkill(item: SkillTreeItem): Promise<void> {
    if (!item.skill || item.kind !== 'generated-skill') {
      vscode.window.showWarningMessage('Only generated skills can be deleted.');
      return;
    }

    const confirmed = await vscode.window.showWarningMessage(
      `Delete skill "${item.skill.name}"?`,
      { modal: true },
      'Delete',
    );

    if (confirmed === 'Delete') {
      const filePath = join(homedir(), '.config', 'agentx', 'skills', `${item.skill.id}.json`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      this.refresh();
      vscode.window.showInformationMessage(`Skill "${item.skill.name}" deleted.`);
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
