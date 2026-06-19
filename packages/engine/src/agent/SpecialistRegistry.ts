import type { AgentBus } from './AgentBus.js';
import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface Specialist {
  agentId: string;
  name: string;
  specialty: SpecialistType;
  description: string;
  preferredTools: string[];
  systemPrompt: string;
}

export type SpecialistType = 'coder' | 'reviewer' | 'tester' | 'researcher' | 'devops' | 'docs_writer' | 'architect' | 'debugger';

/**
 * Registry of specialist agent types that can be spawned for parallel work.
 */
export class SpecialistRegistry {
  private specialists: Map<string, Specialist> = new Map();
  private bus: AgentBus | null = null;

  constructor(bus?: AgentBus) {
    this.bus = bus ?? null;
  }

  setBus(bus: AgentBus): void {
    this.bus = bus;
  }

  /**
   * Register a pre-built specialist template.
   */
  register(specialist: Specialist): void {
    this.specialists.set(specialist.specialty, specialist);
    if (this.bus) {
      this.bus.registerAgent(specialist.agentId, [specialist.specialty]);
    }
    logger.info('SPECIALIST', `Registered ${specialist.name} (${specialist.specialty})`);
  }

  /**
   * Get a specialist by type. Returns the template; the caller spawns
   * a new SmartSubAgent using this template.
   */
  getByType(type: SpecialistType): Specialist | undefined {
    return this.specialists.get(type);
  }

  /**
   * Get all available specialist types.
   */
  getAvailableTypes(): SpecialistType[] {
    return [...this.specialists.values()].map((s) => s.specialty);
  }

  listAll(): Specialist[] {
    return [...this.specialists.values()];
  }

  /**
   * Register the default set of specialists.
   */
  registerDefaults(): void {
    this.register({
      agentId: 'spec-coder',
      name: 'Code Specialist',
      specialty: 'coder',
      description: 'Writes, refactors, and fixes code',
      preferredTools: ['file_read', 'file_write', 'code_replace', 'code_search', 'code_definitions', 'shell_exec', 'git_add', 'git_commit'],
      systemPrompt: 'Write clean, production-ready code. Follow existing patterns. Write complete implementations with no placeholders.',
    });

    this.register({
      agentId: 'spec-reviewer',
      name: 'Code Reviewer',
      specialty: 'reviewer',
      description: 'Reviews code for bugs, security, and style',
      preferredTools: ['file_read', 'code_search', 'code_definitions', 'code_lint', 'security_audit'],
      systemPrompt: 'Review code for bugs, security issues, style violations, and suggest improvements. Be thorough but concise.',
    });

    this.register({
      agentId: 'spec-tester',
      name: 'Test Writer',
      specialty: 'tester',
      description: 'Writes and runs tests',
      preferredTools: ['file_read', 'file_write', 'code_search', 'test_run', 'test_create', 'test_coverage'],
      systemPrompt: 'Write comprehensive tests covering edge cases. Verify test execution. Report coverage.',
    });

    this.register({
      agentId: 'spec-researcher',
      name: 'Researcher',
      specialty: 'researcher',
      description: 'Searches web, code, and docs for information',
      preferredTools: ['web_search', 'web_scrape', 'code_search', 'file_read', 'folder_list'],
      systemPrompt: 'Find information across web, code, and documents. Synthesize findings into clear summaries.',
    });

    this.register({
      agentId: 'spec-devops',
      name: 'DevOps Specialist',
      specialty: 'devops',
      description: 'Manages containers, infrastructure, and deployments',
      preferredTools: ['shell_exec', 'container_list', 'container_run', 'docker_build', 'file_write', 'system_info'],
      systemPrompt: 'Manage containers, deployments, and infrastructure. Automate where possible.',
    });

    this.register({
      agentId: 'spec-docs',
      name: 'Documentation Writer',
      specialty: 'docs_writer',
      description: 'Writes and maintains documentation',
      preferredTools: ['file_read', 'file_write', 'code_definitions', 'doc_markdown', 'doc_html'],
      systemPrompt: 'Write clear, concise docs. Include examples and API references where relevant.',
    });

    this.register({
      agentId: 'spec-architect',
      name: 'Software Architect',
      specialty: 'architect',
      description: 'Designs system architecture and technical decisions',
      preferredTools: ['file_write', 'code_search', 'doc_diagram', 'file_read', 'shell_exec'],
      systemPrompt: 'Design clean architectures, evaluate tradeoffs, and document decisions. Think at the system level.',
    });

    this.register({
      agentId: 'spec-debugger',
      name: 'Debugger',
      specialty: 'debugger',
      description: 'Finds and fixes bugs systematically',
      preferredTools: ['file_read', 'code_search', 'code_definitions', 'shell_exec', 'test_run', 'git_blame', 'git_log'],
      systemPrompt: 'Systematically isolate bugs, find root causes, and apply fixes. Verify fixes with tests.',
    });
  }
}
