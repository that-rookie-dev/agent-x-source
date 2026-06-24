#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expansionCategoryDefinitions } from './crew-hub-expansion-domains.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUB_DIR = join(__dirname, '../src/data/crew-hub');
const CATEGORIES_DIR = join(HUB_DIR, 'categories');
const INDEX_PATH = join(HUB_DIR, 'prebuilt-crews-index.ts');
const SEARCH_INDEX_PATH = join(HUB_DIR, 'search-index.ts');
const MANIFEST_PATH = join(__dirname, '../../engine/data/crew-catalog.manifest.json');
const LEGACY_PATH = join(HUB_DIR, 'prebuilt-crews.ts');

const TONES = ['professional', 'friendly', 'witty', 'kind'];

const FIRST_NAMES = [
  'Aarav', 'Aaliyah', 'Abena', 'Adaeze', 'Aditya', 'Aiko', 'Aisha', 'Akira', 'Alina', 'Amara',
  'Amir', 'Anika', 'Anya', 'Arjun', 'Aya', 'Beatriz', 'Callum', 'Camila', 'Chidi', 'Clara',
  'Dalia', 'Daniel', 'Dante', 'Deepa', 'Diego', 'Efe', 'Elena', 'Elias', 'Emre', 'Esra',
  'Fatima', 'Felix', 'Freya', 'Gabriel', 'Giulia', 'Hana', 'Haruto', 'Helena', 'Hugo', 'Idris',
  'Imani', 'Ines', 'Iris', 'Ishan', 'Jaden', 'Jia', 'Jonas', 'Kaito', 'Karim', 'Kavya',
  'Keiko', 'Khalid', 'Kwame', 'Layla', 'Leila', 'Liam', 'Linh', 'Luca', 'Luna', 'Maya',
  'Meera', 'Mei', 'Miguel', 'Mina', 'Nadia', 'Naomi', 'Nia', 'Noah', 'Noura', 'Omar',
  'Paloma', 'Priya', 'Rafael', 'Rami', 'Rina', 'Sana', 'Santiago', 'Sofia', 'Sophia', 'Tariq',
  'Tomas', 'Valentina', 'Wei', 'Yara', 'Yuki', 'Zainab', 'Zara', 'Zola',
];

const LAST_NAMES = [
  'Abdi', 'Adeyemi', 'Ahmed', 'Alvarez', 'Anderson', 'Bianchi', 'Boateng', 'Brooks', 'Campbell', 'Chang',
  'Chen', 'Costa', 'Cruz', 'Dahl', 'Desai', 'Diallo', 'Dubois', 'Farouk', 'Fernandez', 'Fischer',
  'Garcia', 'Gupta', 'Haddad', 'Hassan', 'Ibrahim', 'Iyer', 'Jensen', 'Joshi', 'Kaur', 'Khan',
  'Kim', 'Kowalski', 'Laurent', 'Lee', 'Lindberg', 'Lopez', 'Malik', 'Mansour', 'Martinez', 'Mehta',
  'Mensah', 'Mori', 'Muller', 'Nakamura', 'Nasser', 'Nguyen', 'Novak', 'Nwosu', 'Okafor', 'Oliveira',
  'Park', 'Patel', 'Petrov', 'Popov', 'Rahman', 'Rao', 'Rossi', 'Santos', 'Sharma', 'Silva',
  'Singh', 'Svensson', 'Tanaka', 'Torres', 'Usman', 'Vega', 'Volkov', 'Watanabe', 'Williams', 'Zhang',
];

const usedNames = new Set();
let nameCounter = 0;

function takeGeneratedName() {
  while (nameCounter < FIRST_NAMES.length * LAST_NAMES.length * 2) {
    const first = FIRST_NAMES[(nameCounter * 7 + 3) % FIRST_NAMES.length];
    const last = LAST_NAMES[(nameCounter * 11 + 5) % LAST_NAMES.length];
    nameCounter += 1;
    const candidate = `${first} ${last}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  throw new Error('Name pool exhausted');
}

function reserveName(name) {
  if (usedNames.has(name)) {
    throw new Error(`Duplicate fixed name detected: ${name}`);
  }
  usedNames.add(name);
  return name;
}

const usedCallsigns = new Set();

function nameSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Short callsign: name slug + 6-char alphanumeric suffix (stable per crew, globally unique). */
function toCallsign(name, title, categoryId) {
  const base = nameSlug(name);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let attempt = 0; attempt < 200; attempt++) {
    let h = hashText(`${categoryId}:${name}:${title}:${attempt}`);
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars[h % chars.length];
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    }
    const callsign = `${base}_${suffix}`;
    if (!usedCallsigns.has(callsign)) {
      usedCallsigns.add(callsign);
      return callsign;
    }
  }
  throw new Error(`Failed to allocate unique callsign for ${name} (${title})`);
}

function hashText(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

function pickUnique(pool, count, seedText) {
  const result = [];
  const used = new Set();
  let idx = hashText(seedText) % pool.length;
  while (result.length < count) {
    const value = pool[idx % pool.length];
    if (!used.has(value)) {
      used.add(value);
      result.push(value);
    }
    idx += 5;
  }
  return result;
}

const COMPLIANCE_AUDIT_TOOLS = [
  'file_read', 'folder_list', 'glob', 'grep', 'code_search', 'code_grep', 'code_definitions',
  'security_audit', 'security_secrets', 'pkg_audit', 'git_status', 'git_diff', 'git_log',
  'env_read', 'container_list', 'container_logs', 'shell_exec', 'json_parse', 'pdf_read',
  'doc_markdown', 'test_run', 'http_get',
];

function complianceRole(title, framework, specialty, controlDomains, name, tone) {
  return { title, framework, specialty, controlDomains, name, tone, compliance: true };
}

function buildComplianceAuditorCrew(categoryId, role, roleIndex) {
  const name = role.name ? reserveName(role.name) : takeGeneratedName();
  const title = role.title;
  const callsign = toCallsign(name, title, categoryId);
  const tone = role.tone ?? 'professional';
  const expertise = [
    role.framework,
    'Compliance Auditing',
    'Technical Controls Assessment',
    'Codebase Review',
    'Cloud Infrastructure Review',
    'Evidence Collection',
  ];
  const traits = ['meticulous', 'risk-aware', 'evidence-driven', 'impartial'];
  const description = `${title} — ${role.framework} specialist who performs technical compliance audits across application code, configuration, and cloud infrastructure. Maps findings to control requirements with severity, evidence, and remediation guidance.`;
  const systemPrompt = [
    `You are ${name}, a ${title} specializing in ${role.specialty}.`,
    '',
    `Primary framework: ${role.framework}`,
    '',
    'Control domains you assess:',
    ...role.controlDomains.map((d) => `- ${d}`),
    '',
    'Technical audit workflow (execute — do not only advise):',
    '1. Scope: confirm systems in scope (app repo, IaC, containers, env configs, auth flows).',
    '2. Codebase: use code_search, code_grep, grep, file_read to inspect handling of sensitive data, crypto, logging, access control, retention, and secrets.',
    '3. Dependencies: run pkg_audit and security_audit; flag vulnerable or non-compliant packages.',
    '4. Secrets: run security_secrets; hunt for keys, tokens, PAN, PHI, or credentials in source and config.',
    '5. Infrastructure: review Terraform/K8s/Docker configs via file_read and grep; use container_list/container_logs when available.',
    '6. Environment: use env_read for exposed configuration patterns (never exfiltrate real secrets in chat).',
    '7. Evidence: cite file paths, line references, and config keys for every finding.',
    '8. Report: control ID → finding → severity (critical/high/medium/low) → evidence → remediation → owner suggestion.',
    '',
    'Output format:',
    '- Executive summary (pass/partial/fail per domain)',
    '- Control-by-control findings table',
    '- Prioritized remediation roadmap',
    '- Gaps requiring policy/process evidence outside the repo',
    '',
    'Important:',
    '- You provide technical compliance assessment and engineering remediation guidance.',
    '- You are not a licensed QSA, CPA, or attorney; recommend formal certification audits where required.',
    '- Default to least privilege and data minimization in every recommendation.',
    '',
    `Response style: ${tone}, precise, audit-ready.`,
  ].join('\n');
  return {
    name,
    title,
    callsign,
    description,
    systemPrompt,
    tone,
    expertise,
    traits,
    tools: COMPLIANCE_AUDIT_TOOLS,
  };
}

function buildCrew(categoryId, skillBank, traitBank, role, roleIndex, businessCategory = false, clinicalCategory = false, medicalCategory = false) {
  if (role.compliance) {
    return buildComplianceAuditorCrew(categoryId, role, roleIndex);
  }
  const name = role.name ? reserveName(role.name) : takeGeneratedName();
  const title = role.title;
  const callsign = toCallsign(name, title, categoryId);
  const tone = role.tone ?? TONES[roleIndex % TONES.length];
  const expertise = role.expertise ?? pickUnique(skillBank, 6, `${categoryId}:${title}:expertise`);
  const traits = role.traits ?? pickUnique(traitBank, 4, `${categoryId}:${title}:traits`);
  const specialty = role.specialty;
  const description = medicalCategory
    ? `${title} focused on ${specialty}. Informational health education only — not diagnosis, treatment, or emergency care.`
    : clinicalCategory
      ? `${title} focused on ${specialty}. Provides operational and educational health guidance — not diagnosis or treatment.`
      : businessCategory
        ? `${title} focused on ${specialty}. Delivers actionable plans, measurable outcomes, and execution-ready guidance for business teams.`
        : `${title} focused on ${specialty}. Delivers concrete plans, practical trade-offs, and execution-ready guidance for real-world teams.`;
  const medicalDisclaimers = medicalCategory
    ? [
        '',
        'CRITICAL MEDICAL DISCLAIMER:',
        '- You provide general health information and education ONLY — never medical advice, diagnosis, treatment, or emergency triage.',
        '- AI and language models can be wrong, omit context, or hallucinate. Users must verify with licensed clinicians.',
        '- Tell users to call emergency services for urgent symptoms and to consult qualified healthcare professionals for care decisions.',
        '- Do not recommend specific drugs, doses, or discontinuation of prescribed therapy.',
      ]
    : [];
  const clinicalDisclaimers = clinicalCategory && !medicalCategory
    ? [
        '',
        'Important:',
        '- You provide health operations guidance and patient-facing process support — not medical diagnosis or treatment.',
        '- Do not prescribe medications, interpret labs for clinical decisions, or replace licensed clinicians.',
        '- Recommend consulting qualified healthcare professionals for clinical care decisions.',
      ]
    : [];
  const systemPrompt = (businessCategory || clinicalCategory || medicalCategory)
    ? [
        `You are ${name}, a ${title} specializing in ${specialty}.`,
        '',
        'Operating principles:',
        '- Clarify goals, constraints, audience, and success metrics.',
        '- Provide step-by-step plans with owners, timelines, and measurable outcomes.',
        medicalCategory
          ? '- Ground responses in evidence-informed health literacy, care navigation, and risk communication — never substitute for clinical judgment.'
          : clinicalCategory
            ? '- Ground recommendations in clinical workflows, safety protocols, and regulatory awareness.'
            : '- Ground recommendations in market context, stakeholder needs, and practical trade-offs.',
        '',
        'Domain strengths:',
        ...expertise.map((item) => `- ${item}`),
        '',
        'Response style:',
        `- Tone: ${tone}`,
        '- Be specific, actionable, and clear.',
        '- Prefer frameworks, templates, and decision checklists over generic advice.',
        '- When licensed professional advice is required, recommend consulting qualified professionals.',
        ...clinicalDisclaimers,
        ...medicalDisclaimers,
      ].join('\n')
    : [
        `You are ${name}, a ${title} specializing in ${specialty}.`,
        '',
        'Operating principles:',
        '- Start by clarifying outcomes, constraints, and stakeholders.',
        '- Provide a step-by-step plan with trade-offs and risk mitigations.',
        '- Prioritize maintainability, observability, and measurable impact.',
        '',
        'Domain strengths:',
        ...expertise.map((item) => `- ${item}`),
        '',
        'Response style:',
        `- Tone: ${tone}`,
        '- Be specific, pragmatic, and technically accurate.',
        '- Prefer examples, checklists, and decision frameworks over generic advice.',
      ].join('\n');
  return { name, title, callsign, description, systemPrompt, tone, expertise, traits };
}

function role(title, specialty, name, tone) {
  return { title, specialty, name, tone };
}

const sharedTechTraits = ['analytical', 'pragmatic', 'systems-minded', 'reliable', 'detail-oriented', 'collaborative', 'curious', 'methodical'];
const sharedOpsTraits = ['calm', 'automation-focused', 'incident-ready', 'risk-aware', 'thorough', 'resilient', 'proactive', 'disciplined'];
const sharedCreativeTraits = ['empathetic', 'creative', 'insightful', 'user-focused', 'organized', 'iterative', 'curious', 'communicative'];
const sharedBusinessTraits = ['strategic', 'persuasive', 'data-driven', 'customer-focused', 'organized', 'decisive', 'collaborative', 'results-oriented'];

const categoryDefinitions = [
  {
    id: 'backend-engineering',
    label: 'Backend Engineering',
    iconId: 'code',
    skillBank: ['Distributed Systems', 'API Design', 'Microservices', 'Event-Driven Architecture', 'Service Reliability', 'Data Modeling', 'Asynchronous Processing', 'Caching Strategies', 'AuthN/AuthZ', 'Observability', 'Performance Tuning', 'Queue Systems'],
    traitBank: sharedTechTraits,
    roles: [
      role('Backend Architect', 'distributed backend architecture and resilient service boundaries', 'Raj Patel', 'professional'),
      role('API Platform Engineer', 'versioned APIs and developer platform standards'),
      role('Java Backend Engineer', 'high-scale Spring services and JVM performance'),
      role('Go Systems Engineer', 'concurrent low-latency backend services'),
      role('Rust Backend Engineer', 'memory-safe backend services and performance-critical modules'),
      role('Python Service Engineer', 'FastAPI and async business services'),
      role('Node.js Backend Engineer', 'TypeScript APIs and event-driven workflows'),
      role('Auth and Identity Engineer', 'secure authentication and authorization flows'),
      role('Payments Backend Engineer', 'payment orchestration and billing reliability'),
      role('Streaming Backend Engineer', 'event pipelines and stream processing'),
      role('Search Backend Engineer', 'search indexing and relevance tuning'),
      role('Realtime Backend Engineer', 'websocket systems and presence infrastructure'),
      role('Integration Engineer', 'third-party platform integrations and webhook safety'),
      role('Serverless Backend Engineer', 'function-first architectures and event triggers'),
      role('Legacy Modernization Engineer', 'incremental migration from monoliths'),
      role('SaaS Multi-Tenant Engineer', 'tenant isolation and scalable account models'),
      role('GraphQL Backend Engineer', 'schema design and resolver performance'),
      role('Backend Performance Engineer', 'profiling bottlenecks and throughput tuning'),
      role('Domain Driven Design Engineer', 'bounded contexts and domain modeling'),
      role('Observability Backend Engineer', 'tracing, metrics, and log-driven diagnostics'),
    ],
  },
  {
    id: 'frontend-engineering',
    label: 'Frontend Engineering',
    iconId: 'web',
    skillBank: ['React', 'TypeScript', 'Modern CSS', 'Accessibility', 'Web Performance', 'State Management', 'Component Architecture', 'UI Testing', 'Design Systems', 'SSR/SSG', 'Security Hardening', 'Internationalization'],
    traitBank: sharedTechTraits,
    roles: [
      role('Frontend Specialist', 'React interfaces and UX execution', 'Maria Santos', 'friendly'),
      role('React Engineer', 'component architecture and hooks patterns'),
      role('Vue Engineer', 'Vue 3 and composition-based frontend development'),
      role('Angular Engineer', 'enterprise Angular architecture and reactive workflows'),
      role('TypeScript Frontend Lead', 'type-safe UI code and API contracts'),
      role('CSS Systems Engineer', 'scalable styling and visual consistency'),
      role('Accessibility Frontend Engineer', 'inclusive UI and WCAG compliance'),
      role('Web Performance Engineer', 'Core Web Vitals and rendering optimization'),
      role('Next.js Engineer', 'SSR/SSG delivery and route architecture'),
      role('Svelte Engineer', 'lean interactive apps with SvelteKit'),
      role('Microfrontend Architect', 'federated frontend platforms'),
      role('Frontend Security Engineer', 'browser security and trusted rendering'),
      role('Frontend Test Automation Engineer', 'component and E2E testing strategies'),
      role('Design Systems Engineer', 'shared UI primitives and documentation'),
      role('Animation Engineer', 'motion systems and micro-interactions'),
      role('Progressive Web App Engineer', 'offline-first web experiences'),
      role('Internationalization Engineer', 'multi-language and RTL-ready interfaces'),
      role('Frontend Platform Engineer', 'build tooling and developer ergonomics'),
      role('Web Components Engineer', 'framework-agnostic component libraries'),
      role('Desktop Web Engineer', 'Electron and cross-platform desktop experiences'),
    ],
  },
  {
    id: 'platform-fullstack',
    label: 'Platform & Fullstack',
    iconId: 'layers',
    skillBank: ['Fullstack Architecture', 'Monorepos', 'API Gateway Patterns', 'Developer Experience', 'CI Tooling', 'Feature Flags', 'Internal Tooling', 'GraphQL', 'BFF Patterns', 'Release Engineering', 'Observability', 'Platform Governance'],
    traitBank: sharedTechTraits,
    roles: [
      role('Fullstack Architect', 'cross-stack architecture and delivery standards'),
      role('Platform Engineer', 'shared runtime platforms and service foundations'),
      role('Developer Experience Engineer', 'tooling ergonomics and fast feedback loops'),
      role('Internal Tools Engineer', 'admin and productivity platform tools'),
      role('Product Fullstack Engineer', 'feature delivery from API to interface'),
      role('Integration Fullstack Engineer', 'front-to-back integrations and workflow automation'),
      role('Monorepo Engineer', 'workspace architecture and build acceleration'),
      role('GraphQL Fullstack Engineer', 'schema-driven product development'),
      role('Release Platform Engineer', 'safe releases and rollback strategies'),
      role('BFF Engineer', 'backend-for-frontend orchestration'),
      role('Platform Reliability Engineer', 'cross-system resilience and incident prevention'),
      role('Tenant Platform Engineer', 'account provisioning and multitenant controls'),
      role('Workflow Automation Engineer', 'orchestration pipelines and task automation'),
      role('Edge Platform Engineer', 'edge runtime routing and latency reduction'),
      role('CLI Tools Engineer', 'developer command-line tooling'),
      role('Identity Platform Engineer', 'SSO and cross-product identity infrastructure'),
      role('API Governance Engineer', 'standards, linting, and consistency across APIs'),
      role('Feature Flag Engineer', 'experimentation controls and safe rollouts'),
      role('Platform Analytics Engineer', 'usage telemetry and product observability'),
      role('Fullstack Principal Engineer', 'complex initiative leadership across stacks'),
    ],
  },
  {
    id: 'devops-cloud-sre',
    label: 'DevOps, Cloud & SRE',
    iconId: 'cloud',
    skillBank: ['Kubernetes', 'Terraform', 'CI/CD Pipelines', 'Incident Response', 'SLO/SLI', 'Cloud Networking', 'Linux Operations', 'Observability', 'Infrastructure as Code', 'Disaster Recovery', 'Cost Optimization', 'Release Automation'],
    traitBank: sharedOpsTraits,
    roles: [
      role('DevOps Engineer', 'automation-first infrastructure operations'),
      role('Site Reliability Engineer', 'service reliability and incident excellence'),
      role('Cloud Architect', 'multi-cloud topology and governance'),
      role('Kubernetes Engineer', 'cluster operations and workload resilience'),
      role('Infrastructure as Code Engineer', 'repeatable infrastructure provisioning'),
      role('Platform SRE', 'platform-level reliability and supportability'),
      role('Observability Engineer', 'metrics, traces, and alerting ecosystems'),
      role('Release Engineer', 'deployment pipelines and progressive delivery'),
      role('Incident Commander', 'coordinated response and post-incident learning'),
      role('FinOps Engineer', 'cloud cost controls and usage optimization'),
      role('Cloud Security Operations Engineer', 'secure cloud operations and remediation'),
      role('Network Reliability Engineer', 'network health and traffic resilience'),
      role('Backup and Recovery Engineer', 'business continuity and recovery planning'),
      role('Chaos Engineering Specialist', 'fault injection and resilience validation'),
      role('Infrastructure Automation Engineer', 'self-healing systems and runbooks'),
      role('Container Runtime Engineer', 'container lifecycle and runtime security'),
      role('Service Mesh Engineer', 'traffic policy and inter-service communication'),
      role('Cloud Migration Engineer', 'lift-and-modernize programs'),
      role('Reliability Program Manager', 'cross-team reliability prioritization'),
      role('Production Readiness Engineer', 'launch criteria and go-live safeguards'),
    ],
  },
  {
    id: 'security-compliance',
    label: 'Security & Compliance',
    iconId: 'verified',
    skillBank: ['Threat Modeling', 'Application Security', 'Cloud Security', 'Identity Security', 'Vulnerability Management', 'Incident Response', 'Penetration Testing', 'Compliance Auditing', 'Security Architecture', 'Cryptography Basics', 'OWASP', 'Risk Management'],
    traitBank: ['vigilant', 'precise', 'risk-aware', 'thorough', 'principled', 'calm', 'skeptical', 'methodical'],
    roles: [
      role('Security Architect', 'defense-in-depth security architecture'),
      role('Application Security Engineer', 'secure SDLC and code-level defenses'),
      role('Cloud Security Engineer', 'cloud posture and security controls'),
      role('DevSecOps Engineer', 'security automation in delivery pipelines'),
      role('Penetration Tester', 'offensive validation and exploit simulation'),
      role('Security Compliance Analyst', 'regulatory controls and evidence readiness'),
      role('Identity Security Engineer', 'IAM, SSO, and privileged access control'),
      role('Security Operations Analyst', 'alert triage and incident escalation'),
      role('GRC Specialist', 'governance, risk, and compliance programs'),
      role('Product Security Engineer', 'secure product design and abuse resistance'),
      role('Data Privacy Engineer', 'privacy-by-design and data minimization'),
      role('Security Auditor', 'audit readiness and control verification'),
      role('Threat Intelligence Analyst', 'adversary trends and proactive defense'),
      role('Security Awareness Lead', 'training and human risk reduction'),
      role('API Security Engineer', 'API threat mitigation and auth hardening'),
      role('Cryptography Engineer', 'key management and secure data protection'),
      role('Incident Response Engineer', 'containment and post-breach recovery'),
      role('Supply Chain Security Engineer', 'dependency and artifact trust'),
      role('Compliance Program Manager', 'SOC2, ISO, and policy operations'),
      role('Zero Trust Engineer', 'continuous verification and access segmentation'),
    ],
  },
  {
    id: 'mobile-embedded-iot',
    label: 'Mobile, Embedded & IoT',
    iconId: 'devices',
    skillBank: ['iOS Development', 'Android Development', 'React Native', 'Flutter', 'Firmware', 'RTOS', 'Bluetooth', 'Sensor Integration', 'Edge Computing', 'Power Optimization', 'Mobile Security', 'Device Lifecycle'],
    traitBank: sharedTechTraits,
    roles: [
      role('iOS Engineer', 'native iOS apps and platform conventions'),
      role('Android Engineer', 'native Android architecture and performance'),
      role('React Native Engineer', 'cross-platform mobile apps with shared code'),
      role('Flutter Engineer', 'high-fidelity cross-platform mobile interfaces'),
      role('Mobile QA Engineer', 'mobile release quality and device coverage'),
      role('Embedded Systems Engineer', 'firmware and hardware-near software'),
      role('Firmware Engineer', 'microcontroller programming and reliability'),
      role('RTOS Engineer', 'real-time scheduling and deterministic behavior'),
      role('IoT Platform Engineer', 'device-cloud integration pipelines'),
      role('BLE Engineer', 'Bluetooth Low Energy communication design'),
      role('Edge Device Engineer', 'on-device compute and inference workflows'),
      role('Mobile Security Engineer', 'secure mobile auth and data storage'),
      role('Device Provisioning Engineer', 'fleet onboarding and identity enrollment'),
      role('Sensor Integration Engineer', 'multi-sensor telemetry and calibration'),
      role('Automotive Embedded Engineer', 'automotive-grade embedded controls'),
      role('Wearables Engineer', 'health and activity wearable applications'),
      role('OTA Update Engineer', 'safe firmware rollout and rollback'),
      role('Low Power Optimization Engineer', 'battery-aware system tuning'),
      role('IoT Reliability Engineer', 'field diagnostics and uptime improvement'),
      role('Connectivity Engineer', 'cellular, wifi, and mesh communication strategies'),
    ],
  },
  {
    id: 'data-engineering-analytics',
    label: 'Data Engineering & Analytics',
    iconId: 'analytics',
    skillBank: ['ETL/ELT', 'Data Warehousing', 'Spark', 'Streaming Data', 'Data Modeling', 'Analytics Engineering', 'Data Quality', 'Airflow', 'dbt', 'BI Tooling', 'SQL Optimization', 'Data Governance'],
    traitBank: sharedTechTraits,
    roles: [
      role('Data Engineer', 'reliable pipelines and warehouse modeling'),
      role('Analytics Engineer', 'metrics modeling and semantic data layers'),
      role('Data Platform Engineer', 'shared data services and tooling'),
      role('Batch Pipeline Engineer', 'scheduled transformations at scale'),
      role('Streaming Data Engineer', 'real-time event ingestion and processing'),
      role('Airflow Orchestration Engineer', 'workflow orchestration and observability'),
      role('dbt Analytics Engineer', 'tested transformations and data contracts'),
      role('BI Engineer', 'dashboard ecosystems and stakeholder analytics'),
      role('Data Quality Engineer', 'validation frameworks and anomaly detection'),
      role('Data Governance Specialist', 'catalogs, lineage, and policy enforcement'),
      role('Warehouse Performance Engineer', 'query optimization and cost efficiency'),
      role('Reverse ETL Engineer', 'warehouse-to-application data activation'),
      role('Data Integrations Engineer', 'third-party data source normalization'),
      role('Customer Analytics Engineer', 'product analytics and funnel instrumentation'),
      role('Marketing Analytics Engineer', 'campaign attribution and channel insights'),
      role('Finance Analytics Engineer', 'financial metric integrity and reporting'),
      role('Data Reliability Engineer', 'pipeline failure prevention and recovery'),
      role('Master Data Engineer', 'entity resolution and golden record systems'),
      role('Geospatial Data Engineer', 'location analytics and mapping pipelines'),
      role('Experimentation Data Engineer', 'A/B testing data accuracy and analysis readiness'),
    ],
  },
  {
    id: 'machine-learning-ai',
    label: 'Machine Learning & AI',
    iconId: 'autoawesome',
    skillBank: ['Machine Learning', 'Model Training', 'MLOps', 'Prompt Engineering', 'RAG Systems', 'NLP', 'Computer Vision', 'Model Evaluation', 'Responsible AI', 'Feature Engineering', 'Inference Optimization', 'Experiment Tracking'],
    traitBank: ['analytical', 'experimental', 'evidence-driven', 'curious', 'practical', 'rigorous', 'iterative', 'responsible'],
    roles: [
      role('Machine Learning Engineer', 'production ML lifecycle and model serving'),
      role('Data Scientist', 'insight discovery and statistical experimentation'),
      role('NLP Engineer', 'language models and retrieval pipelines'),
      role('Computer Vision Engineer', 'vision inference and detection workflows'),
      role('MLOps Engineer', 'model deployment and operational reliability'),
      role('LLM Application Engineer', 'agentic and prompt-driven product features'),
      role('AI Product Engineer', 'user-facing AI capabilities with guardrails'),
      role('Recommender Systems Engineer', 'ranking models and personalization'),
      role('Generative AI Engineer', 'content generation and model orchestration'),
      role('AI Evaluation Engineer', 'quality benchmarks and regression frameworks'),
      role('Feature Engineering Specialist', 'robust feature pipelines and validation'),
      role('Model Optimization Engineer', 'latency reduction and inference efficiency'),
      role('Responsible AI Specialist', 'fairness, transparency, and safe deployment'),
      role('Speech AI Engineer', 'speech recognition and voice interaction systems'),
      role('Time Series ML Engineer', 'forecasting and anomaly detection models'),
      role('Reinforcement Learning Engineer', 'policy optimization and simulation loops'),
      role('Knowledge Graph AI Engineer', 'graph-enhanced AI reasoning systems'),
      role('AI Platform Engineer', 'shared model APIs and platform abstraction'),
      role('Prompt Quality Engineer', 'prompt libraries and response consistency'),
      role('Applied Research Engineer', 'prototype-to-production research translation'),
    ],
  },
  {
    id: 'quality-testing',
    label: 'Quality & Testing',
    iconId: 'bug_report',
    skillBank: ['Test Strategy', 'Unit Testing', 'Integration Testing', 'E2E Testing', 'Performance Testing', 'Security Testing', 'Accessibility Testing', 'Mutation Testing', 'Test Automation', 'Release Validation', 'Reliability Testing', 'Bug Triage'],
    traitBank: ['meticulous', 'systematic', 'persistent', 'objective', 'user-advocate', 'methodical', 'curious', 'clear'],
    roles: [
      role('QA Engineer', 'holistic product quality and regression prevention'),
      role('Test Automation Engineer', 'automation architecture and stable CI tests'),
      role('E2E Test Engineer', 'workflow validation from user perspective'),
      role('Performance Test Engineer', 'load, stress, and endurance testing'),
      role('Accessibility QA Engineer', 'inclusive usability and assistive tech validation'),
      role('Security Test Engineer', 'security regression and adversarial testing'),
      role('Mobile QA Engineer', 'multi-device validation and app quality'),
      role('API Test Engineer', 'contract and integration test coverage'),
      role('Data Quality Test Engineer', 'data correctness and pipeline testing'),
      role('Release Validation Engineer', 'go-live readiness and rollback confidence'),
      role('Chaos Test Engineer', 'failure-mode testing and resilience drills'),
      role('SDET', 'developer-grade testing frameworks and quality tooling'),
      role('Usability Test Researcher', 'task-based user validation and findings synthesis'),
      role('Compatibility Test Engineer', 'cross-browser and platform compatibility'),
      role('Test Infrastructure Engineer', 'test environments and deterministic setup'),
      role('Compliance Test Engineer', 'regulated workflow validation and controls'),
      role('Localization QA Engineer', 'globalization quality and language verification'),
      role('Game QA Engineer', 'interactive system edge-case and scenario testing'),
      role('Reliability Test Engineer', 'stability under sustained production-like conditions'),
      role('Quality Engineering Lead', 'quality strategy and team-wide practices'),
    ],
  },
  {
    id: 'database-infrastructure',
    label: 'Database Infrastructure',
    iconId: 'database',
    skillBank: ['PostgreSQL', 'MySQL', 'NoSQL', 'Replication', 'Sharding', 'Backup and Recovery', 'Query Optimization', 'Schema Design', 'Data Security', 'High Availability', 'Capacity Planning', 'Migration Strategy'],
    traitBank: sharedTechTraits,
    roles: [
      role('Database Architect', 'durable data architecture and relational modeling'),
      role('PostgreSQL DBA', 'Postgres operations and performance tuning'),
      role('MySQL DBA', 'MySQL replication and operational reliability'),
      role('NoSQL Engineer', 'document and key-value database strategy'),
      role('Data Migration Engineer', 'safe schema and data migration programs'),
      role('Database Reliability Engineer', 'high-availability and disaster readiness'),
      role('Query Optimization Engineer', 'execution plans and workload tuning'),
      role('Database Security Engineer', 'data access controls and encryption posture'),
      role('Replication Engineer', 'read scaling and replication integrity'),
      role('Sharding Specialist', 'horizontal partitioning and scale-out design'),
      role('Storage Engine Engineer', 'low-level storage performance behavior'),
      role('Data Backup Engineer', 'backup verification and restore safety'),
      role('Data Warehouse DBA', 'analytic database operations and governance'),
      role('Database Observability Engineer', 'database telemetry and anomaly detection'),
      role('Graph Database Engineer', 'graph modeling and traversal optimization'),
      role('Time Series Database Engineer', 'metric retention and write-heavy optimization'),
      role('Caching Database Engineer', 'in-memory datastore strategy and consistency'),
      role('Database Platform Engineer', 'self-service database provisioning'),
      role('Capacity Planning Engineer', 'growth forecasting and headroom planning'),
      role('Data Consistency Engineer', 'transaction guarantees and conflict resolution'),
    ],
  },
  {
    id: 'game-graphics-realtime',
    label: 'Game, Graphics & Realtime',
    iconId: 'videogame',
    skillBank: ['Unity', 'Unreal Engine', 'Rendering Pipelines', 'Shaders', 'Physics Systems', 'Gameplay Systems', 'Realtime Networking', 'Optimization', 'Asset Pipelines', 'Procedural Generation', 'Audio Systems', 'Engine Tooling'],
    traitBank: ['creative', 'performance-minded', 'iterative', 'detail-oriented', 'visual-thinker', 'player-focused', 'experimental', 'systematic'],
    roles: [
      role('Game Developer', 'core gameplay mechanics and player systems'),
      role('Gameplay Engineer', 'moment-to-moment interaction loops'),
      role('Graphics Engineer', 'real-time rendering performance and fidelity'),
      role('Shader Engineer', 'material shaders and visual effects pipelines'),
      role('Engine Programmer', 'engine subsystems and runtime architecture'),
      role('Realtime Networking Engineer', 'multiplayer sync and low-latency netcode'),
      role('Technical Artist', 'bridge between art workflows and runtime constraints'),
      role('Physics Engineer', 'simulation behavior and deterministic tuning'),
      role('AI Gameplay Engineer', 'NPC behavior and encounter intelligence'),
      role('Level Systems Engineer', 'world streaming and level tooling'),
      role('VR Engineer', 'immersive interaction and performance budgets'),
      role('AR Engineer', 'spatial interaction and mixed reality behavior'),
      role('Audio Programmer', 'adaptive audio systems and effects'),
      role('Rendering Optimization Engineer', 'frame-time budgets and platform scaling'),
      role('Tools Engineer', 'content pipeline productivity and editor tooling'),
      role('Procedural Systems Engineer', 'algorithmic generation and replayability'),
      role('UI Game Engineer', 'in-game UI systems and feedback loops'),
      role('Live Ops Engineer', 'events, telemetry, and post-launch operations'),
      role('Simulation Engineer', 'real-time simulation and state progression'),
      role('Game QA Automation Engineer', 'automated gameplay regression coverage'),
    ],
  },
  {
    id: 'networking-systems',
    label: 'Networking & Systems',
    iconId: 'lan',
    skillBank: ['TCP/IP', 'DNS', 'Load Balancing', 'Network Security', 'Routing', 'Linux Systems', 'Distributed Systems', 'Protocol Design', 'Observability', 'Edge Networking', 'Capacity Planning', 'Troubleshooting'],
    traitBank: sharedOpsTraits,
    roles: [
      role('Network Engineer', 'network architecture and traffic reliability'),
      role('Systems Engineer', 'host-level reliability and systems operations'),
      role('Network Security Engineer', 'segmentation, firewall policy, and hardening'),
      role('DNS Engineer', 'authoritative and recursive DNS reliability'),
      role('Load Balancing Engineer', 'traffic distribution and failover policy'),
      role('Edge Network Engineer', 'global edge routing and latency optimization'),
      role('Linux Performance Engineer', 'kernel and host tuning at scale'),
      role('Protocol Engineer', 'protocol design and interoperability'),
      role('Network Automation Engineer', 'programmable network infrastructure'),
      role('WAN Engineer', 'wide area networking and site connectivity'),
      role('Datacenter Network Engineer', 'rack-to-core data center topology'),
      role('Systems Reliability Engineer', 'host lifecycle and service uptime'),
      role('Network Observability Engineer', 'flow telemetry and incident diagnostics'),
      role('Infrastructure Troubleshooting Specialist', 'cross-layer root cause analysis'),
      role('Capacity Engineer', 'network growth forecasting and planning'),
      role('Site Connectivity Engineer', 'remote site resilience and optimization'),
      role('Telecom Integration Engineer', 'carrier integration and service assurance'),
      role('Distributed Systems Reliability Engineer', 'cross-region consistency and uptime'),
      role('Network Program Manager', 'cross-team network delivery programs'),
      role('Systems Hardening Engineer', 'baseline hardening and operational safeguards'),
    ],
  },
  {
    id: 'creative-product-design',
    label: 'Creative Product Design',
    iconId: 'palette',
    skillBank: ['UX Research', 'Interaction Design', 'Information Architecture', 'Design Systems', 'Product Discovery', 'Prototyping', 'Accessibility', 'Visual Design', 'Service Design', 'Journey Mapping', 'Usability Testing', 'Cross-Functional Collaboration'],
    traitBank: sharedCreativeTraits,
    roles: [
      role('UX Designer', 'user-centered product interaction design'),
      role('Product Designer', 'end-to-end product discovery and delivery'),
      role('UX Researcher', 'qualitative and quantitative user insights'),
      role('Interaction Designer', 'micro-interactions and flow choreography'),
      role('Design Systems Lead', 'systematic component and pattern governance'),
      role('Service Designer', 'multi-touchpoint service experience design'),
      role('Information Architect', 'content structure and navigation clarity'),
      role('Accessibility Designer', 'inclusive design and equitable usability'),
      role('Visual Designer', 'brand-aligned visual communication'),
      role('Prototype Specialist', 'high-fidelity prototyping for decision speed'),
      role('User Journey Strategist', 'journey mapping and friction removal'),
      role('Conversion Design Specialist', 'behavioral design for conversion outcomes'),
      role('Design Ops Manager', 'design workflow and quality operations'),
      role('Product Discovery Facilitator', 'problem framing and idea validation'),
      role('UX Content Designer', 'interface language and content clarity'),
      role('Customer Experience Designer', 'cross-channel customer experience systems'),
      role('Design Critique Coach', 'design feedback culture and quality uplift'),
      role('Inclusive Research Specialist', 'diverse user sampling and bias reduction'),
      role('Experimentation Designer', 'hypothesis-driven UX testing'),
      role('Product Manager', 'roadmaps, prioritization, and stakeholder alignment'),
    ],
  },
  {
    id: 'regulatory-compliance-audit',
    label: 'Regulatory Compliance & Audit',
    iconId: 'verified',
    skillBank: ['PCI-DSS', 'HIPAA', 'GDPR', 'SOC 2', 'ISO 27001', 'FedRAMP', 'SOX', 'NIST', 'CCPA', 'CIS Controls', 'Cloud Compliance', 'IaC Scanning'],
    traitBank: ['meticulous', 'risk-aware', 'evidence-driven', 'impartial', 'thorough', 'principled', 'technical', 'audit-ready'],
    roles: [
      complianceRole('PCI-DSS Compliance Auditor', 'PCI-DSS v4.0', 'cardholder data environment and payment security controls', ['Network segmentation', 'Encryption of CHD', 'Access control', 'Logging and monitoring', 'Secure SDLC', 'Vulnerability management']),
      complianceRole('HIPAA Security Officer', 'HIPAA Security Rule', 'PHI safeguards in applications and infrastructure', ['Administrative safeguards', 'Physical safeguards', 'Technical safeguards', 'Access controls', 'Audit controls', 'Transmission security']),
      complianceRole('HIPAA Privacy Officer', 'HIPAA Privacy Rule', 'PHI use, disclosure, and patient rights in systems', ['Minimum necessary', 'Patient rights', 'Business associate flows', 'De-identification', 'Notice of privacy practices', 'Breach notification']),
      complianceRole('GDPR Data Protection Auditor', 'GDPR', 'personal data processing and EU privacy rights', ['Lawful basis', 'Data subject rights', 'Privacy by design', 'DPIA', 'Cross-border transfers', 'Breach notification']),
      complianceRole('SOC 2 Type II Auditor', 'SOC 2', 'trust service criteria in SaaS systems', ['Security', 'Availability', 'Confidentiality', 'Processing integrity', 'Privacy']),
      complianceRole('ISO 27001 Lead Auditor', 'ISO 27001', 'information security management system controls', ['ISMS scope', 'Risk treatment', 'Annex A controls', 'Continuous improvement', 'Supplier security']),
      complianceRole('FedRAMP Compliance Specialist', 'FedRAMP', 'US government cloud authorization controls', ['NIST 800-53 mapping', 'Boundary definition', 'Continuous monitoring', 'POA&M', 'SSP evidence']),
      complianceRole('SOX ITGC Auditor', 'SOX ITGC', 'IT general controls for financial reporting systems', ['Change management', 'Access management', 'Computer operations', 'Program development', 'Segregation of duties']),
      complianceRole('CCPA CPRA Privacy Auditor', 'CCPA/CPRA', 'California consumer privacy rights in products', ['Consumer rights requests', 'Sale/share disclosure', 'Data inventory', 'Retention limits', 'Sensitive PI handling']),
      complianceRole('NIST 800-53 Assessor', 'NIST 800-53', 'federal security control baseline assessment', ['Access control family', 'Audit and accountability', 'System and communications protection', 'Incident response', 'Configuration management']),
      complianceRole('CIS Controls Auditor', 'CIS Controls v8', 'prioritized cyber hygiene implementation', ['Inventory and control', 'Data protection', 'Secure configuration', 'Account management', 'Vulnerability management']),
      complianceRole('AWS Cloud Compliance Auditor', 'AWS Compliance', 'AWS workload alignment to regulatory frameworks', ['IAM policies', 'S3/KMS encryption', 'CloudTrail/Config', 'VPC segmentation', 'GuardDuty/Security Hub']),
      complianceRole('Azure Cloud Compliance Auditor', 'Azure Compliance', 'Azure tenant and workload control validation', ['Entra ID', 'Defender for Cloud', 'Key Vault', 'Policy/Blueprint', 'Diagnostic logging']),
      complianceRole('GCP Cloud Compliance Auditor', 'GCP Compliance', 'Google Cloud security and compliance posture', ['IAM', 'VPC SC', 'Cloud KMS', 'Security Command Center', 'Audit logs']),
      complianceRole('IaC Compliance Scanner', 'Infrastructure as Code', 'Terraform/Kubernetes/Helm compliance drift', ['Terraform state and modules', 'K8s RBAC/PSP/PSS', 'Helm chart security', 'Secrets in IaC', 'Network policies']),
      complianceRole('Application Code Compliance Auditor', 'Application Security Compliance', 'source-level control implementation review', ['AuthZ/authN patterns', 'Input validation', 'Crypto usage', 'Logging redaction', 'PII/CHD handling in code']),
      complianceRole('PHI Data Flow Analyst', 'HIPAA PHI', 'end-to-end PHI data flow mapping and gaps', ['Data flow diagrams', 'Storage locations', 'API boundaries', 'Encryption in transit/at rest', 'BAA technical measures']),
      complianceRole('Payment Card Data Flow Auditor', 'PCI-DSS', 'card data discovery and scope reduction', ['PAN discovery', 'Tokenization', 'Scope segmentation', 'Logging of CHD access', 'Key management']),
      complianceRole('Encryption Compliance Auditor', 'Cryptography Standards', 'encryption and key management controls', ['TLS configuration', 'At-rest encryption', 'KMS/HSM usage', 'Key rotation', 'Algorithm strength']),
      complianceRole('Audit Logging Compliance Specialist', 'Logging & Retention', 'audit trails, retention, and tamper evidence', ['Immutable logs', 'Retention policies', 'SIEM integration', 'Clock sync', 'Privileged access logging']),
      complianceRole('Multi-Framework GRC Gap Analyst', 'Cross-Framework GRC', 'unified gap analysis across overlapping frameworks', ['Control mapping', 'Shared evidence', 'Compensating controls', 'Remediation prioritization', 'Audit readiness scoring']),
    ],
  },
  {
    id: 'sales-revenue-growth',
    label: 'Sales & Revenue',
    iconId: 'trending',
    businessCategory: true,
    skillBank: ['Pipeline Management', 'Account Planning', 'Discovery Calls', 'Objection Handling', 'Negotiation', 'Closing Techniques', 'CRM Hygiene', 'Forecasting', 'Territory Planning', 'Renewals', 'Upsell Strategy', 'Sales Enablement'],
    traitBank: sharedBusinessTraits,
    roles: [
      role('Account Executive', 'enterprise deal cycles and quota attainment'),
      role('Enterprise Sales Director', 'complex multi-stakeholder sales strategy'),
      role('SMB Sales Specialist', 'high-velocity small business acquisition'),
      role('Inside Sales Representative', 'remote-first pipeline development and closing'),
      role('Sales Development Representative', 'outbound prospecting and qualified meeting generation'),
      role('Outbound SDR Lead', 'outbound playbooks and SDR team performance'),
      role('Inbound Sales Specialist', 'inbound lead qualification and conversion'),
      role('Channel Sales Manager', 'partner-led revenue channels and enablement'),
      role('Partner Sales Manager', 'strategic alliance selling and co-selling motions'),
      role('Sales Operations Analyst', 'sales process design and CRM analytics'),
      role('CRM Administrator', 'CRM configuration, hygiene, and reporting automation'),
      role('Sales Enablement Manager', 'content, training, and rep productivity systems'),
      role('Sales Training Specialist', 'onboarding curricula and skills coaching'),
      role('Proposal Manager', 'RFP and proposal production with win themes'),
      role('RFP Response Specialist', 'compliance matrices and compelling bid responses'),
      role('Negotiation Specialist', 'pricing, terms, and mutual-close negotiation'),
      role('Territory Planning Manager', 'coverage models and account segmentation'),
      role('Account Expansion Manager', 'land-and-expand growth within existing accounts'),
      role('Renewals Manager', 'retention forecasting and renewal risk mitigation'),
      role('Sales Coach', 'deal coaching and pipeline inspection excellence'),
    ],
  },
  {
    id: 'marketing-brand-growth',
    label: 'Marketing & Brand',
    iconId: 'campaign',
    businessCategory: true,
    skillBank: ['Brand Strategy', 'Positioning', 'Content Marketing', 'SEO', 'SEM', 'Email Marketing', 'Marketing Automation', 'Lifecycle Marketing', 'Demand Generation', 'ABM', 'Product Marketing', 'Marketing Analytics'],
    traitBank: sharedBusinessTraits,
    roles: [
      role('Growth Marketing Manager', 'experiment-driven acquisition and conversion loops'),
      role('Brand Strategist', 'brand positioning, voice, and market differentiation'),
      role('Product Marketing Manager', 'messaging, launches, and sales enablement assets'),
      role('Content Marketing Manager', 'editorial strategy and funnel-aligned content'),
      role('SEO Specialist', 'organic search visibility and technical SEO'),
      role('SEM Specialist', 'paid search strategy and keyword portfolio management'),
      role('Email Marketing Manager', 'lifecycle email programs and deliverability'),
      role('Marketing Automation Specialist', 'nurture workflows and lead scoring'),
      role('Lifecycle Marketing Manager', 'onboarding, activation, and retention campaigns'),
      role('Demand Generation Manager', 'pipeline creation programs and channel mix'),
      role('Community Marketing Manager', 'community-led growth and advocacy programs'),
      role('Event Marketing Manager', 'field events, webinars, and conference ROI'),
      role('Field Marketing Manager', 'regional campaigns and sales alignment'),
      role('ABM Strategist', 'account-based marketing plays for target accounts'),
      role('Marketing Analytics Manager', 'attribution, dashboards, and experiment readouts'),
      role('Positioning Strategist', 'category design and competitive differentiation'),
      role('Go-To-Market Strategist', 'launch planning across product, sales, and marketing'),
      role('Competitive Intelligence Analyst', 'competitor tracking and battlecard development'),
      role('Customer Marketing Manager', 'case studies, references, and expansion marketing'),
      role('Marketing Operations Manager', 'martech stack, data flows, and campaign ops'),
    ],
  },
  {
    id: 'advertising-performance-media',
    label: 'Advertising & Media',
    iconId: 'ads',
    businessCategory: true,
    skillBank: ['Media Planning', 'Media Buying', 'Paid Social', 'Paid Search', 'Programmatic', 'Creative Testing', 'Attribution', 'ROAS Optimization', 'Ad Operations', 'Influencer Marketing', 'Affiliate Marketing', 'Brand Safety'],
    traitBank: sharedBusinessTraits,
    roles: [
      role('Media Planner', 'channel mix, reach/frequency, and budget allocation'),
      role('Media Buyer', 'inventory negotiation and campaign trafficking'),
      role('Performance Marketing Manager', 'ROAS-driven acquisition across paid channels'),
      role('Paid Social Specialist', 'Meta, LinkedIn, TikTok, and social ad optimization'),
      role('Paid Search Specialist', 'Google Ads structure, bidding, and query strategy'),
      role('Programmatic Advertising Specialist', 'DSP strategy, audiences, and bid management'),
      role('Display Advertising Manager', 'display creative rotation and viewability'),
      role('Video Advertising Strategist', 'YouTube and in-stream video campaign design'),
      role('CTV OTT Advertising Specialist', 'connected TV and streaming ad placements'),
      role('Retargeting Campaign Manager', 'remarketing audiences and sequential messaging'),
      role('Creative Testing Analyst', 'ad creative experiments and iteration loops'),
      role('Ad Operations Manager', 'tagging, trafficking, and campaign QA'),
      role('Campaign Optimization Specialist', 'budget pacing and bid/budget tuning'),
      role('Attribution Modeling Analyst', 'multi-touch attribution and incrementality'),
      role('Influencer Marketing Manager', 'creator partnerships and sponsored content'),
      role('Affiliate Marketing Manager', 'affiliate network strategy and commission design'),
      role('Amazon Advertising Specialist', 'sponsored products, brands, and retail media'),
      role('Google Ads Specialist', 'search, shopping, PMax, and account structure'),
      role('Meta Ads Specialist', 'Facebook and Instagram campaign architecture'),
      role('Advertising Compliance Specialist', 'ad policy, disclosures, and regulatory ad review'),
    ],
  },
  {
    id: 'enterprise-delivery-support',
    label: 'Enterprise Delivery & Support',
    iconId: 'groups',
    skillBank: ['Enterprise Architecture', 'Solution Design', 'Program Management', 'Agile Delivery', 'Technical Documentation', 'Production Support', 'Customer Success', 'SLA Management', 'Change Management', 'Escalation Handling', 'Knowledge Management', 'Stakeholder Communication'],
    traitBank: ['organized', 'communicative', 'customer-focused', 'calm-under-pressure', 'strategic', 'detail-oriented', 'collaborative', 'accountable'],
    roles: [
      role('Enterprise Architect', 'enterprise-wide technology standards and target-state architecture'),
      role('Solutions Architect', 'customer-facing solution design and integration blueprints'),
      role('Technical Program Manager', 'multi-team delivery coordination and dependency management'),
      role('Engineering Manager', 'team leadership, hiring, and engineering execution'),
      role('Scrum Master', 'agile ceremonies, impediment removal, and delivery flow'),
      role('Agile Coach', 'agile transformation and team coaching at scale'),
      role('Technical Writer', 'developer docs, runbooks, and user-facing documentation'),
      role('Developer Advocate', 'developer experience, SDK docs, and community enablement'),
      role('Production Support Engineer', 'L2/L3 production triage and root-cause analysis'),
      role('Application Support Lead', 'application health monitoring and escalation ownership'),
      role('Customer Success Engineer', 'onboarding, adoption, and technical account health'),
      role('Technical Account Manager', 'strategic customer relationships and technical alignment'),
      role('Sales Engineer', 'technical discovery and proof-of-concept delivery'),
      role('Pre-Sales Solutions Architect', 'RFP responses and enterprise solution proposals'),
      role('SLA Operations Manager', 'SLA tracking, reporting, and breach prevention'),
      role('Change Management Specialist', 'release change advisory and risk communication'),
      role('Knowledge Base Manager', 'support knowledge systems and self-service content'),
      role('Escalation Manager', 'major incident escalation and executive communication'),
      role('Vendor Integration Manager', 'third-party vendor onboarding and SLA governance'),
      role('Service Delivery Manager', 'end-to-end service ownership and continuous improvement'),
    ],
  },
  {
    id: 'business-legal-finance',
    label: 'Business, Legal & Finance',
    iconId: 'gavel',
    businessCategory: true,
    skillBank: ['Business Strategy', 'Financial Modeling', 'Contract Review', 'Regulatory Analysis', 'Negotiation', 'Risk Assessment', 'Market Analysis', 'Program Management', 'Pricing Strategy', 'Operational Planning', 'Stakeholder Alignment', 'Governance'],
    traitBank: ['strategic', 'clear', 'risk-aware', 'pragmatic', 'thorough', 'decisive', 'collaborative', 'data-driven'],
    roles: [
      role('Business Strategist', 'long-horizon business planning and positioning'),
      role('Financial Analyst', 'financial forecasting and scenario planning'),
      role('Corporate Counsel Advisor', 'commercial legal risk and contract strategy'),
      role('Operations Strategist', 'operating model design and execution planning'),
      role('Pricing Analyst', 'pricing frameworks and revenue optimization'),
      role('Go-To-Market Manager', 'market entry and launch coordination'),
      role('Contract Specialist', 'contract language clarity and risk controls'),
      role('Compliance Counsel Specialist', 'regulatory obligations and controls'),
      role('Program Manager', 'cross-functional execution and accountability'),
      role('Partnerships Manager', 'strategic partnerships and alliance outcomes'),
      role('Investment Analyst', 'portfolio and capital allocation decisions'),
      role('Procurement Specialist', 'vendor strategy and negotiation outcomes'),
      role('Revenue Operations Manager', 'pipeline discipline and forecasting hygiene'),
      role('Policy Advisor', 'policy interpretation and implementation strategy'),
      role('Risk Manager', 'enterprise risk posture and mitigations'),
      role('M and A Analyst', 'transaction analysis and integration planning'),
      role('Legal Operations Manager', 'legal process systems and efficiency'),
      role('Treasury Planning Specialist', 'cash strategy and liquidity planning'),
      role('Board Reporting Analyst', 'executive reporting and decision support'),
      role('Commercial Strategy Lead', 'commercial model design and optimization'),
    ],
  },
  {
    id: 'hr-people-operations',
    label: 'HR & People Ops',
    iconId: 'work',
    businessCategory: true,
    skillBank: ['Talent Acquisition', 'Employee Relations', 'Compensation', 'Benefits', 'Onboarding', 'Performance Management', 'DEI', 'Learning and Development', 'HRIS', 'Workforce Planning', 'Culture', 'People Analytics'],
    traitBank: sharedBusinessTraits,
    roles: [
      role('HR Business Partner', 'business-aligned people strategy and manager coaching'),
      role('Talent Acquisition Specialist', 'full-cycle hiring and candidate experience'),
      role('Corporate Recruiter', 'sourcing, screening, and offer negotiation'),
      role('Technical Recruiter', 'engineering and product hiring pipelines'),
      role('Onboarding Specialist', 'new hire ramp programs and 30-60-90 plans'),
      role('Employee Relations Advisor', 'workplace issues, policies, and conflict resolution'),
      role('Compensation Analyst', 'salary bands, equity, and pay equity reviews'),
      role('Benefits Administrator', 'benefits enrollment, vendors, and open enrollment'),
      role('HR Operations Manager', 'HR process design and service delivery'),
      role('People Analytics Specialist', 'headcount, attrition, and engagement insights'),
      role('DEI Program Manager', 'inclusion programs and equitable hiring practices'),
      role('Learning and Development Manager', 'training roadmaps and skills academies'),
      role('Performance Management Coach', 'goal setting, reviews, and feedback culture'),
      role('Organizational Development Consultant', 'team design and change management'),
      role('Workforce Planning Analyst', 'capacity planning and org modeling'),
      role('HRIS Administrator', 'HR systems configuration and data integrity'),
      role('Culture Program Manager', 'values, rituals, and employee engagement'),
      role('Employee Engagement Specialist', 'surveys, action planning, and retention'),
      role('Offboarding Specialist', 'exit processes and knowledge transfer'),
      role('Remote Work Policy Advisor', 'distributed team policies and compliance'),
    ],
  },
  {
    id: 'finance-accounting-operations',
    label: 'Finance & Accounting',
    iconId: 'balance',
    businessCategory: true,
    skillBank: ['Financial Modeling', 'FP&A', 'Bookkeeping', 'Accounts Payable', 'Accounts Receivable', 'Tax Planning', 'Payroll', 'Budgeting', 'Audit Prep', 'Cash Flow', 'Revenue Recognition', 'Financial Reporting'],
    traitBank: ['analytical', 'precise', 'risk-aware', 'thorough', 'pragmatic', 'decisive', 'collaborative', 'data-driven'],
    roles: [
      role('CFO Advisor', 'financial strategy, runway, and board-ready narratives'),
      role('Controller', 'close process, controls, and financial statement integrity'),
      role('Accounts Payable Specialist', 'vendor payments, approvals, and reconciliation'),
      role('Accounts Receivable Specialist', 'collections, invoicing, and DSO management'),
      role('Bookkeeper', 'day-to-day ledger hygiene and categorization'),
      role('Tax Planning Advisor', 'tax efficiency and compliance planning'),
      role('Payroll Specialist', 'payroll processing and multi-state compliance'),
      role('Financial Reporting Analyst', 'monthly reporting packs and variance analysis'),
      role('Budget Analyst', 'annual budgets and department forecast tracking'),
      role('FP&A Manager', 'driver-based models and scenario planning'),
      role('Cost Accounting Specialist', 'COGS, margins, and unit economics'),
      role('Audit Preparation Specialist', 'audit readiness and PBC coordination'),
      role('Cash Flow Analyst', '13-week cash flow and liquidity planning'),
      role('Cap Table Advisor', 'equity structures and dilution modeling'),
      role('Startup Finance Advisor', 'burn rate, fundraising metrics, and unit economics'),
      role('Nonprofit Finance Manager', 'fund accounting and grant reporting'),
      role('Expense Management Analyst', 'T&E policy and spend optimization'),
      role('Billing Operations Manager', 'subscription billing and revenue ops'),
      role('Revenue Recognition Specialist', 'ASC 606 policies and deferred revenue'),
      role('Financial Systems Analyst', 'ERP/GL configuration and finance automation'),
    ],
  },
  {
    id: 'legal-corporate-advisory',
    label: 'Legal & Corporate',
    iconId: 'gavel',
    businessCategory: true,
    skillBank: ['Contract Law', 'Corporate Governance', 'IP Strategy', 'Employment Law', 'Privacy Law', 'Commercial Negotiation', 'Regulatory Compliance', 'M&A', 'Trademark', 'Terms of Service', 'Vendor Contracts', 'Legal Research'],
    traitBank: ['precise', 'risk-aware', 'thorough', 'principled', 'clear', 'pragmatic', 'decisive', 'collaborative'],
    roles: [
      role('Corporate Lawyer Advisor', 'entity structure and corporate governance guidance'),
      role('Commercial Contracts Attorney Advisor', 'MSA, SOW, and commercial term negotiation'),
      role('IP Strategy Advisor', 'patents, trademarks, and IP portfolio planning'),
      role('Employment Law Advisor', 'hiring, termination, and workplace policy guidance'),
      role('Privacy Law Advisor', 'privacy programs and cross-border data rules'),
      role('Immigration Policy Advisor', 'work authorization and mobility programs'),
      role('Litigation Risk Advisor', 'dispute risk assessment and early resolution strategy'),
      role('Trademark Specialist Advisor', 'brand clearance and trademark maintenance'),
      role('Startup Legal Advisor', 'founder agreements, fundraising docs, and cap table legal'),
      role('SaaS Agreement Specialist', 'subscription terms, SLAs, and limitation clauses'),
      role('Vendor Contract Negotiator', 'vendor risk, indemnities, and SLA terms'),
      role('NDA and Data Sharing Advisor', 'confidentiality and data processing agreements'),
      role('Terms of Service Drafter Advisor', 'consumer and B2B terms, privacy, and disclosures'),
      role('Regulatory Filing Advisor', 'regulatory submissions and compliance calendars'),
      role('Corporate Governance Advisor', 'board processes, minutes, and fiduciary duties'),
      role('Board Governance Advisor', 'committee charters and governance best practices'),
      role('Ethics and Compliance Counsel Advisor', 'code of conduct and investigation playbooks'),
      role('M&A Legal Advisor', 'diligence checklists and transaction document strategy'),
      role('International Trade Compliance Advisor', 'export controls and sanctions screening'),
      role('Legal Research Specialist', 'case law, regulatory research, and memo drafting'),
    ],
  },
  {
    id: 'public-relations-communications',
    label: 'PR & Communications',
    iconId: 'voice',
    businessCategory: true,
    skillBank: ['Media Relations', 'Crisis Communications', 'Press Releases', 'Executive Comms', 'Internal Comms', 'Thought Leadership', 'Reputation Management', 'Analyst Relations', 'Speechwriting', 'Brand Narrative', 'Stakeholder Comms', 'ESG Communications'],
    traitBank: sharedCreativeTraits,
    roles: [
      role('PR Manager', 'media strategy, pitching, and coverage tracking'),
      role('Media Relations Specialist', 'journalist relationships and interview prep'),
      role('Corporate Communications Manager', 'company narrative and announcement planning'),
      role('Crisis Communications Advisor', 'incident messaging and stakeholder updates'),
      role('Internal Communications Manager', 'employee updates and change communications'),
      role('Executive Communications Writer', 'CEO/executive messaging and talking points'),
      role('Press Release Writer', 'newsworthy releases and media kits'),
      role('Spokesperson Coach', 'media training and on-camera delivery'),
      role('Analyst Relations Manager', 'industry analyst briefings and MQ positioning'),
      role('Thought Leadership Strategist', 'bylines, podcasts, and expert visibility'),
      role('Corporate Storytelling Specialist', 'narrative arcs across channels'),
      role('Reputation Management Advisor', 'review response and brand sentiment recovery'),
      role('Community Relations Manager', 'local partnerships and civic engagement'),
      role('Government Relations Advisor', 'policy advocacy and regulatory engagement'),
      role('ESG Communications Specialist', 'sustainability reporting and stakeholder trust'),
      role('Investor Communications Advisor', 'earnings narratives and IR materials'),
      role('Employee Newsletter Editor', 'internal editorial calendar and engagement'),
      role('Speechwriter', 'keynotes, town halls, and ceremonial remarks'),
      role('Brand Communications Manager', 'brand campaigns and message consistency'),
      role('Social Impact Communications Lead', 'CSR storytelling and impact reporting'),
    ],
  },
  {
    id: 'customer-experience-support',
    label: 'Customer Experience',
    iconId: 'support',
    businessCategory: true,
    skillBank: ['Customer Support', 'Technical Support', 'CX Strategy', 'Voice of Customer', 'Help Center', 'Onboarding', 'Retention', 'NPS', 'Journey Mapping', 'SLA Design', 'Community Support', 'Customer Education'],
    traitBank: ['empathetic', 'patient', 'clear', 'customer-focused', 'organized', 'calm', 'proactive', 'solution-oriented'],
    roles: [
      role('Customer Support Specialist', 'ticket resolution and empathetic customer care'),
      role('Technical Support Advisor', 'troubleshooting workflows and escalation paths'),
      role('Customer Experience Manager', 'end-to-end CX programs and service design'),
      role('Voice of Customer Analyst', 'feedback synthesis and insight reporting'),
      role('Support Operations Manager', 'queue management, staffing, and tooling'),
      role('Help Center Content Manager', 'self-service articles and search optimization'),
      role('Chat Support Trainer', 'live chat playbooks and quality coaching'),
      role('Escalation Support Lead', 'complex case ownership and executive updates'),
      role('Customer Onboarding Specialist', 'activation milestones and time-to-value'),
      role('Customer Retention Specialist', 'churn risk identification and save plays'),
      role('NPS Program Manager', 'survey design, follow-up, and closed-loop actions'),
      role('Customer Journey Analyst', 'journey maps, friction points, and metrics'),
      role('Support Quality Analyst', 'QA scorecards and coaching insights'),
      role('Multilingual Support Lead', 'global support coverage and localization'),
      role('Self-Service Strategy Advisor', 'deflection strategy and knowledge architecture'),
      role('Community Support Manager', 'peer support forums and superuser programs'),
      role('Customer Advocacy Manager', 'references, reviews, and case study recruitment'),
      role('Feedback Loop Manager', 'product feedback routing and closure reporting'),
      role('Support SLA Designer', 'tiering, response targets, and escalation matrices'),
      role('Customer Education Specialist', 'academy content and certification paths'),
    ],
  },
  {
    id: 'supply-chain-logistics',
    label: 'Supply Chain & Logistics',
    iconId: 'shipping',
    businessCategory: true,
    skillBank: ['Supply Chain Planning', 'Inventory Management', 'Procurement', 'Warehouse Operations', 'Demand Planning', 'Logistics', 'Import Export', 'Vendor Management', 'ERP', 'Sourcing', 'Fleet Operations', 'Risk Management'],
    traitBank: sharedOpsTraits,
    roles: [
      role('Supply Chain Manager', 'end-to-end supply chain design and resilience'),
      role('Logistics Coordinator', 'shipment scheduling and carrier coordination'),
      role('Inventory Planning Analyst', 'safety stock, replenishment, and SKU rationalization'),
      role('Procurement Operations Manager', 'purchase orders, approvals, and vendor onboarding'),
      role('Warehouse Operations Advisor', 'pick/pack efficiency and WMS workflows'),
      role('Demand Planning Analyst', 'forecasting models and S&OP participation'),
      role('Supplier Relationship Manager', 'vendor scorecards and contract performance'),
      role('Import Export Compliance Advisor', 'customs, duties, and trade documentation'),
      role('Last Mile Delivery Strategist', 'final-mile cost and delivery promise design'),
      role('Fleet Operations Advisor', 'routing, maintenance, and driver compliance'),
      role('Cold Chain Logistics Specialist', 'temperature-controlled shipping and monitoring'),
      role('Reverse Logistics Manager', 'returns, refurb, and circular supply flows'),
      role('ERP Supply Chain Analyst', 'ERP modules, master data, and integrations'),
      role('Sourcing Specialist', 'RFQ/RFP sourcing events and supplier selection'),
      role('Cost Reduction Analyst', 'should-cost models and spend consolidation'),
      role('Vendor Quality Manager', 'incoming inspection and supplier corrective actions'),
      role('Production Planning Advisor', 'MRP, capacity planning, and schedule adherence'),
      role('Materials Management Specialist', 'BOM accuracy and material availability'),
      role('3PL Partnership Manager', 'third-party logistics contracts and SLAs'),
      role('Supply Chain Risk Analyst', 'disruption scenarios and dual-sourcing strategy'),
    ],
  },
  {
    id: 'real-estate-property',
    label: 'Real Estate & Property',
    iconId: 'apartment',
    businessCategory: true,
    skillBank: ['Commercial Real Estate', 'Residential Real Estate', 'Property Management', 'Leasing', 'Facilities', 'Market Analysis', 'Investment Analysis', 'Mortgage Basics', 'Tenant Relations', 'Space Planning', 'Development', 'Portfolio Management'],
    traitBank: sharedBusinessTraits,
    roles: [
      role('Real Estate Investment Advisor', 'deal underwriting and investment memos'),
      role('Commercial Leasing Advisor', 'lease negotiations and tenant improvement planning'),
      role('Residential Property Advisor', 'buy/sell guidance and market comps'),
      role('Property Management Specialist', 'operations, maintenance, and tenant services'),
      role('Real Estate Market Analyst', 'submarket trends and rent/price forecasting'),
      role('Mortgage Advisory Specialist', 'financing options and qualification guidance'),
      role('Tenant Relations Manager', 'retention, renewals, and service requests'),
      role('Facilities Management Advisor', 'building systems, vendors, and capex planning'),
      role('Space Planning Consultant', 'office layouts and utilization optimization'),
      role('Real Estate Transaction Coordinator', 'closing checklists and document coordination'),
      role('Cap Rate Analyst', 'yield analysis and property valuation models'),
      role('Development Project Advisor', 'feasibility, entitlements, and pro forma review'),
      role('HOA Management Advisor', 'governance, budgets, and community operations'),
      role('Short-Term Rental Advisor', 'STR regulations, pricing, and guest operations'),
      role('Real Estate Marketing Specialist', 'listing marketing and broker materials'),
      role('Property Tax Advisor', 'assessment appeals and tax planning'),
      role('Construction Project Liaison', 'owner representation during build-outs'),
      role('Sustainable Buildings Advisor', 'green certifications and energy retrofits'),
      role('Office Relocation Planner', 'move timelines, vendors, and employee comms'),
      role('Real Estate Portfolio Manager', 'portfolio strategy and asset disposition'),
    ],
  },
  {
    id: 'insurance-risk-services',
    label: 'Insurance & Risk',
    iconId: 'policy',
    businessCategory: true,
    skillBank: ['Risk Assessment', 'Insurance Coverage', 'Claims', 'Underwriting Basics', 'Business Insurance', 'Cyber Insurance', 'Liability', 'Workers Comp', 'Policy Review', 'Business Continuity', 'Enterprise Risk', 'Fraud Prevention'],
    traitBank: ['risk-aware', 'thorough', 'clear', 'pragmatic', 'detail-oriented', 'calm', 'principled', 'analytical'],
    roles: [
      role('Insurance Advisor', 'coverage gaps, limits, and renewal strategy'),
      role('Risk Assessment Specialist', 'risk registers and mitigation planning'),
      role('Claims Process Advisor', 'FNOL through settlement and documentation'),
      role('Underwriting Analyst Advisor', 'risk submission packaging and carrier questions'),
      role('Business Insurance Specialist', 'BOP, GL, and property coverage design'),
      role('Cyber Insurance Advisor', 'cyber policy terms, exclusions, and incident prep'),
      role('Health Benefits Insurance Advisor', 'medical plan design and open enrollment'),
      role('Liability Coverage Advisor', 'E&O, D&O, and professional liability limits'),
      role('Workers Comp Advisor', 'classification, experience mods, and safety programs'),
      role('Policy Review Specialist', 'endorsements, exclusions, and renewal comparisons'),
      role('Insurance Broker Liaison', 'RFP processes and carrier negotiations'),
      role('Actuarial Concepts Advisor', 'loss ratios, reserves, and pricing fundamentals'),
      role('Fraud Prevention Advisor', 'fraud controls and investigation playbooks'),
      role('Enterprise Risk Advisor', 'ERM frameworks and risk appetite statements'),
      role('Business Continuity Insurance Planner', 'BI/EE coverage and continuity testing'),
      role('D&O Insurance Advisor', 'directors and officers coverage for startups and public cos'),
      role('E&O Insurance Advisor', 'professional liability for services firms'),
      role('Captive Insurance Advisor', 'captive feasibility and alternative risk transfer'),
      role('Policy Compliance Reviewer', 'certificate of insurance and contractual compliance'),
      role('Insurance Renewal Manager', 'renewal timelines, benchmarking, and negotiations'),
    ],
  },
  {
    id: 'nonprofit-fundraising',
    label: 'Nonprofit & Fundraising',
    iconId: 'volunteer',
    businessCategory: true,
    skillBank: ['Fundraising', 'Grant Writing', 'Donor Relations', 'Major Gifts', 'Annual Campaigns', 'Corporate Partnerships', 'Impact Measurement', 'Volunteer Management', 'Board Development', 'Nonprofit Compliance', 'Stewardship', 'Advocacy'],
    traitBank: ['empathetic', 'persuasive', 'organized', 'mission-driven', 'collaborative', 'strategic', 'resourceful', 'clear'],
    roles: [
      role('Fundraising Strategist', 'multi-channel fundraising plans and revenue goals'),
      role('Grant Writer', 'foundation proposals and grant reporting'),
      role('Donor Relations Manager', 'donor journeys, stewardship, and retention'),
      role('Major Gifts Officer', 'principal gift cultivation and solicitation'),
      role('Annual Fund Manager', 'year-end campaigns and recurring giving'),
      role('Corporate Partnerships Fundraiser', 'sponsorships and cause marketing deals'),
      role('Foundation Relations Specialist', 'foundation research and relationship building'),
      role('Crowdfunding Campaign Manager', 'peer-to-peer and platform campaign ops'),
      role('Nonprofit Program Manager', 'program design, outcomes, and reporting'),
      role('Impact Measurement Specialist', 'theory of change and impact metrics'),
      role('Volunteer Program Manager', 'volunteer recruitment, training, and recognition'),
      role('Board Development Advisor', 'board recruitment, governance, and engagement'),
      role('Nonprofit Compliance Advisor', '990s, state registrations, and charitable rules'),
      role('Capital Campaign Manager', 'quiet phase through public phase campaign execution'),
      role('Stewardship Manager', 'recognition tiers and donor acknowledgment'),
      role('Gala Event Fundraiser', 'benefit events, auctions, and sponsor sales'),
      role('Digital Fundraising Specialist', 'email, social, and conversion-optimized giving pages'),
      role('Planned Giving Advisor', 'bequests, CRTs, and legacy society programs'),
      role('Advocacy Campaign Manager', 'grassroots mobilization and policy campaigns'),
      role('Social Enterprise Advisor', 'earned revenue models and hybrid structures'),
    ],
  },
  {
    id: 'hospitality-food-service',
    label: 'Hospitality & Food',
    iconId: 'restaurant',
    businessCategory: true,
    skillBank: ['Restaurant Operations', 'Hotel Management', 'Guest Experience', 'Menu Engineering', 'Food Cost Control', 'Staff Scheduling', 'Health Inspections', 'Revenue Management', 'Banquet Operations', 'Bar Management', 'Hospitality Marketing', 'Vendor Management'],
    traitBank: ['hospitable', 'organized', 'calm-under-pressure', 'detail-oriented', 'customer-focused', 'pragmatic', 'collaborative', 'resourceful'],
    roles: [
      role('Restaurant Operations Manager', 'front-of-house and back-of-house daily operations'),
      role('Hotel General Manager Advisor', 'property performance, guest satisfaction, and team leadership'),
      role('Guest Experience Manager', 'service standards, complaints, and loyalty programs'),
      role('Menu Engineering Specialist', 'menu design, pricing, and contribution margin optimization'),
      role('Food Cost Controller', 'COGS tracking, waste reduction, and inventory par levels'),
      role('Kitchen Operations Advisor', 'line flow, prep systems, and BOH staffing'),
      role('Bar Program Manager', 'beverage programs, pour cost, and bar labor'),
      role('Banquet and Events Coordinator', 'catering sales, BEOs, and event execution'),
      role('Hospitality Revenue Manager', 'ADR, RevPAR, and dynamic pricing for rooms'),
      role('Front Desk Operations Lead', 'check-in/out workflows and upsell programs'),
      role('Housekeeping Operations Manager', 'room turnover standards and staffing models'),
      role('Restaurant Marketing Specialist', 'local SEO, reviews, and reservation funnel'),
      role('Health and Safety Inspector Advisor', 'food safety, HACCP, and inspection readiness'),
      role('Staff Scheduling Specialist', 'labor forecasting and shift optimization'),
      role('Hospitality Training Manager', 'service training and onboarding playbooks'),
      role('Concierge Services Advisor', 'guest requests, partnerships, and VIP handling'),
      role('Quick Service Operations Lead', 'QSR throughput, drive-thru, and labor efficiency'),
      role('Fine Dining Service Director', 'fine dining standards, wine service, and reservations'),
      role('Food Truck Operations Advisor', 'mobile food unit permits, routes, and commissary ops'),
      role('Hospitality Procurement Specialist', 'vendor contracts, produce ordering, and substitutions'),
    ],
  },
  {
    id: 'manufacturing-industrial',
    label: 'Manufacturing',
    iconId: 'factory',
    businessCategory: true,
    skillBank: ['Lean Manufacturing', 'Six Sigma', 'Production Planning', 'Quality Systems', 'OEE', 'Maintenance', 'Safety Programs', 'BOM Management', 'Shop Floor Ops', 'Continuous Improvement', 'ISO Standards', 'Capacity Planning'],
    traitBank: sharedOpsTraits,
    roles: [
      role('Manufacturing Operations Manager', 'plant performance, throughput, and shift execution'),
      role('Production Planner', 'MPS, MRP, and schedule adherence'),
      role('Lean Manufacturing Specialist', 'value stream mapping and waste elimination'),
      role('Six Sigma Black Belt Advisor', 'DMAIC projects and defect reduction'),
      role('Quality Systems Manager', 'QMS documentation and audit readiness'),
      role('Plant Maintenance Manager', 'preventive maintenance and downtime reduction'),
      role('OEE Improvement Analyst', 'availability, performance, and quality metrics'),
      role('Shop Floor Supervisor Advisor', 'line leadership, Gemba walks, and escalation'),
      role('Industrial Safety Manager', 'OSHA programs, near-miss reporting, and PPE'),
      role('Continuous Improvement Lead', 'kaizen events and CI pipeline management'),
      role('Manufacturing Engineer Advisor', 'process design, cycle time, and workstation layout'),
      role('Materials Requirements Planner', 'BOM accuracy, shortages, and kitting'),
      role('Supplier Quality Engineer', 'incoming quality and SCAR management'),
      role('Tooling and Die Advisor', 'tool life, changeovers, and setup reduction'),
      role('Assembly Line Balancer', 'takt time, line balancing, and bottlenecks'),
      role('Packaging Operations Manager', 'pack-out lines, labeling, and compliance'),
      role('ISO 9001 Implementation Advisor', 'quality manual, procedures, and internal audits'),
      role('Capacity Planning Engineer', 'bottleneck analysis and capital requests'),
      role('Manufacturing Cost Analyst', 'standard costs, variances, and margin improvement'),
      role('New Product Introduction Manager', 'pilot builds, PPAP, and scale-up readiness'),
    ],
  },
  {
    id: 'construction-trades',
    label: 'Construction & Trades',
    iconId: 'construction',
    businessCategory: true,
    skillBank: ['Project Estimating', 'Job Costing', 'Scheduling', 'Subcontractor Management', 'Building Codes', 'Site Safety', 'Blueprint Reading', 'Change Orders', 'RFIs', 'Closeout', 'Permitting', 'Trade Coordination'],
    traitBank: ['practical', 'safety-minded', 'detail-oriented', 'organized', 'decisive', 'collaborative', 'methodical', 'accountable'],
    roles: [
      role('Construction Project Manager', 'schedule, budget, and subcontractor coordination'),
      role('Estimator', 'takeoffs, bid pricing, and scope clarification'),
      role('General Contractor Advisor', 'GC operations, subs, and owner communication'),
      role('Site Superintendent', 'daily field leadership and quality control'),
      role('Construction Scheduler', 'CPM schedules, lookahead, and delay analysis'),
      role('Job Cost Controller', 'cost codes, committed costs, and forecast-to-complete'),
      role('Subcontractor Manager', 'prequalification, contracts, and performance'),
      role('Building Code Advisor', 'code compliance and inspection preparation'),
      role('Construction Safety Officer', 'OSHA jobsite safety and toolbox talks'),
      role('MEP Coordinator', 'mechanical, electrical, and plumbing trade coordination'),
      role('Structural Steel Advisor', 'erection sequencing and connection inspections'),
      role('Concrete Operations Specialist', 'pour schedules, curing, and testing'),
      role('Electrical Contractor Advisor', 'rough-in, panels, and commissioning checklists'),
      role('Plumbing Contractor Advisor', 'rough/finish plumbing and pressure testing'),
      role('HVAC Installation Advisor', 'ductwork, startup, and balancing'),
      role('Renovation Project Manager', 'occupied space renovations and phasing'),
      role('Residential Builder Advisor', 'single-family production and warranty'),
      role('Change Order Manager', 'PCOs, pricing, and documentation'),
      role('Construction Closeout Specialist', 'punch lists, as-builts, and turnover'),
      role('Permitting Expediter', 'permit applications and agency coordination'),
    ],
  },
  {
    id: 'government-public-sector',
    label: 'Government & Public',
    iconId: 'landmark',
    businessCategory: true,
    skillBank: ['Public Administration', 'Grant Management', 'Policy Analysis', 'Procurement Rules', 'Civic Programs', 'Stakeholder Engagement', 'Regulatory Affairs', 'Public Records', 'Budgeting', 'Program Evaluation', 'Community Outreach', 'Compliance'],
    traitBank: ['principled', 'clear', 'organized', 'collaborative', 'risk-aware', 'thorough', 'patient', 'accountable'],
    roles: [
      role('Public Administration Advisor', 'agency operations and service delivery improvement'),
      role('Government Program Manager', 'federal/state program design and reporting'),
      role('Grant Administrator', 'grant compliance, drawdowns, and audit trails'),
      role('Policy Analyst', 'policy research, options memos, and impact analysis'),
      role('Public Procurement Specialist', 'RFP/RFQ under public purchasing rules'),
      role('Civic Engagement Manager', 'community meetings, feedback, and transparency'),
      role('Legislative Affairs Advisor', 'bill tracking and stakeholder coalitions'),
      role('Public Records Officer Advisor', 'FOIA/records retention and redaction workflows'),
      role('Municipal Budget Analyst', 'appropriations, forecasts, and council reporting'),
      role('Economic Development Director Advisor', 'incentives, site selection, and business attraction'),
      role('Public Health Program Coordinator', 'community health program operations'),
      role('Emergency Management Planner', 'hazards, exercises, and continuity planning'),
      role('Transportation Planning Advisor', 'transit, roads, and multimodal planning'),
      role('Housing Policy Advisor', 'affordable housing programs and zoning policy'),
      role('Environmental Permitting Advisor', 'NEPA/CEQA-style review coordination'),
      role('Veterans Services Coordinator', 'benefits navigation and casework programs'),
      role('Election Operations Advisor', 'polling logistics and chain-of-custody procedures'),
      role('Public Library Program Manager', 'library services and community programming'),
      role('Parks and Recreation Manager', 'facility scheduling and program registration'),
      role('Intergovernmental Relations Specialist', 'federal-state-local coordination'),
    ],
  },
  {
    id: 'healthcare-clinical-ops',
    label: 'Healthcare Clinical',
    iconId: 'hospital',
    businessCategory: true,
    clinicalCategory: true,
    skillBank: ['Clinical Workflows', 'Patient Intake', 'Care Coordination', 'HIPAA Operations', 'Medical Billing', 'Prior Authorization', 'Quality Measures', 'Population Health', 'Telehealth Ops', 'Clinical Documentation', 'Patient Safety', 'Healthcare Compliance'],
    traitBank: ['empathetic', 'meticulous', 'calm', 'ethical', 'clear', 'patient-focused', 'organized', 'risk-aware'],
    roles: [
      role('Clinical Operations Manager', 'clinic throughput, rooming, and care pathways'),
      role('Patient Intake Coordinator Advisor', 'registration, eligibility, and intake workflows'),
      role('Care Coordinator', 'referrals, follow-ups, and care transitions'),
      role('Medical Billing Specialist Advisor', 'coding basics, claims scrubbing, and denials'),
      role('Prior Authorization Specialist', 'PA submissions and payer policy navigation'),
      role('Clinical Documentation Advisor', 'note templates, completeness, and audit readiness'),
      role('Patient Safety Officer Advisor', 'incident reporting, RCA, and harm prevention'),
      role('Telehealth Operations Manager', 'virtual visit workflows and tech troubleshooting'),
      role('Population Health Manager', 'panel management and outreach campaigns'),
      role('Healthcare Quality Analyst', 'HEDIS, MIPS, and quality improvement projects'),
      role('Revenue Cycle Advisor', 'AR days, collections, and contract modeling'),
      role('Clinical Trial Coordinator Advisor', 'protocol logistics and participant scheduling'),
      role('Hospital Bed Management Advisor', 'capacity, boarding, and transfer center ops'),
      role('Surgical Services Coordinator', 'OR scheduling and block utilization'),
      role('Pharmacy Operations Advisor', 'formulary ops, inventory, and workflow safety'),
      role('Laboratory Operations Manager', 'specimen flow, turnaround time, and QC'),
      role('Radiology Operations Advisor', 'scheduling, priors, and modality throughput'),
      role('Home Health Operations Advisor', 'visit planning and OASIS documentation ops'),
      role('Behavioral Health Program Manager', 'BH intake, groups, and crisis routing'),
      role('Healthcare Compliance Operations Advisor', 'policies, training, and survey prep'),
    ],
  },
  {
    id: 'ecommerce-operations',
    label: 'E-commerce Ops',
    iconId: 'cart',
    businessCategory: true,
    skillBank: ['Marketplace Management', 'Catalog Ops', 'Fulfillment', 'Returns', 'Conversion Optimization', 'Merchandising', 'Inventory Planning', '3PL', 'Customer Reviews', 'Pricing', 'Marketplace SEO', 'Order Management'],
    traitBank: sharedBusinessTraits,
    roles: [
      role('E-commerce Operations Manager', 'end-to-end DTC ops and KPI ownership'),
      role('Marketplace Manager', 'Amazon, Walmart, and marketplace account health'),
      role('Catalog Manager', 'SKU setup, attributes, and taxonomy governance'),
      role('Merchandising Manager', 'assortment, collections, and promotional calendars'),
      role('Fulfillment Operations Lead', 'pick/pack SLAs, carriers, and exception handling'),
      role('Returns and Refunds Manager', 'RMA policies, refurb, and loss prevention'),
      role('Conversion Rate Optimizer', 'PDP, cart, and checkout experimentation'),
      role('E-commerce Inventory Planner', 'replenishment, aged inventory, and stockouts'),
      role('3PL Relationship Manager', 'SLAs, chargebacks, and integration issues'),
      role('Order Management Specialist', 'OMS rules, splits, and backorder comms'),
      role('Product Listing SEO Specialist', 'titles, bullets, and search rank on marketplaces'),
      role('Pricing and Promotions Manager', 'MAP, discounts, and margin guardrails'),
      role('Customer Reviews Manager', 'review generation, responses, and policy compliance'),
      role('Subscription Commerce Manager', 'subscribe-and-save and churn mitigation'),
      role('Dropshipping Operations Advisor', 'supplier SLAs and quality control'),
      role('B2B E-commerce Manager', 'wholesale portals, tiers, and net terms'),
      role('International E-commerce Advisor', 'duties, localization, and cross-border returns'),
      role('E-commerce Analytics Manager', 'funnel, cohort, and SKU-level profitability'),
      role('Packaging and Unboxing Designer Ops', 'dunnage, inserts, and damage rates'),
      role('Flash Sale Operations Lead', 'drop planning, inventory holds, and site load'),
    ],
  },
  {
    id: 'travel-tourism',
    label: 'Travel & Tourism',
    iconId: 'flight',
    businessCategory: true,
    skillBank: ['Tour Operations', 'Destination Marketing', 'Travel Booking', 'Itinerary Design', 'Hospitality Sales', 'Group Travel', 'Travel Policy', 'Revenue Management', 'Visitor Experience', 'Tourism Partnerships', 'Crisis Travel Ops', 'Sustainable Tourism'],
    traitBank: ['welcoming', 'organized', 'resourceful', 'customer-focused', 'culturally-aware', 'calm', 'persuasive', 'detail-oriented'],
    roles: [
      role('Travel Agency Operations Manager', 'booking workflows, commissions, and client files'),
      role('Tour Operator Manager', 'itineraries, suppliers, and departure operations'),
      role('Destination Marketing Manager', 'DMO campaigns and visitor segmentation'),
      role('Itinerary Designer', 'multi-day trips, pacing, and local experiences'),
      role('Corporate Travel Manager', 'travel policy, TMC relations, and duty of care'),
      role('Cruise Vacation Advisor', 'cruise lines, cabins, and shore excursions'),
      role('Adventure Travel Planner', 'risk briefings, gear lists, and guide coordination'),
      role('Group Travel Coordinator', 'blocks, rooming lists, and motorcoach logistics'),
      role('Revenue Management Travel Advisor', 'yield management for hotels and airlines basics'),
      role('Visitor Center Manager', 'info services, maps, and partner referrals'),
      role('Tourism Partnership Manager', 'hotel/DMO/attraction co-marketing'),
      role('Travel Crisis Response Advisor', 'disruptions, rebooking, and traveler comms'),
      role('Sustainable Tourism Advisor', 'eco-certifications and low-impact itineraries'),
      role('Luxury Travel Concierge', 'VIP bookings, upgrades, and bespoke requests'),
      role('Airline Operations Liaison Advisor', 'IRROPS basics and reaccommodation workflows'),
      role('Hotel Sales Manager Tourism', 'group sales and tour operator contracts'),
      role('Travel Content Strategist', 'guides, SEO, and inspirational trip content'),
      role('Visa and Entry Requirements Advisor', 'document checklists and timing'),
      role('Theme Park Operations Advisor', 'guest flow, queues, and capacity planning'),
      role('Festival Tourism Coordinator', 'event travel packages and on-site logistics'),
    ],
  },
  {
    id: 'energy-utilities',
    label: 'Energy & Utilities',
    iconId: 'energy',
    businessCategory: true,
    skillBank: ['Utility Operations', 'Grid Management', 'Renewable Energy', 'Energy Markets', 'Demand Response', 'Rate Design', 'Outage Management', 'Energy Efficiency', 'Regulatory Compliance', 'Power Purchase Agreements', 'Solar Operations', 'Customer Programs'],
    traitBank: sharedOpsTraits,
    roles: [
      role('Utility Operations Manager', 'distribution operations and reliability metrics'),
      role('Grid Operations Advisor', 'load forecasting and switching procedures'),
      role('Renewable Energy Project Manager', 'solar/wind development and interconnection'),
      role('Energy Efficiency Program Manager', 'rebate programs and measure verification'),
      role('Demand Response Coordinator', 'DR events and customer enrollment'),
      role('Utility Customer Programs Manager', 'assistance programs and billing options'),
      role('Outage Communications Manager', 'ETOR messaging and stakeholder updates'),
      role('Rate Design Analyst', 'tariff structures and cost recovery modeling'),
      role('Power Purchase Agreement Advisor', 'PPA terms, offtake, and risk allocation'),
      role('Solar Operations Manager', 'O&M, monitoring, and performance ratio'),
      role('Wind Farm Operations Advisor', 'turbine availability and spare parts planning'),
      role('Energy Storage Operations Specialist', 'BESS dispatch and warranty claims'),
      role('Microgrid Planning Advisor', 'resilience design and islanding scenarios'),
      role('Oil and Gas Operations Advisor', 'upstream/midstream operational basics'),
      role('Pipeline Safety Compliance Advisor', 'integrity management and PHMSA-style programs'),
      role('Utility Vegetation Management Advisor', 'trim cycles and outage prevention'),
      role('Metering and AMI Program Manager', 'smart meter rollout and data quality'),
      role('Wholesale Energy Markets Analyst', 'LMP basics, hedging, and congestion'),
      role('EV Charging Infrastructure Manager', 'site host agreements and utilization'),
      role('Carbon Accounting Energy Advisor', 'emissions inventories and offset procurement'),
    ],
  },
  {
    id: 'translation-localization',
    label: 'Translation & L10n',
    iconId: 'translate',
    businessCategory: true,
    skillBank: ['Translation', 'Localization', 'Transcreation', 'Glossary Management', 'CAT Tools', 'i18n Engineering', 'LQA', 'Cultural Adaptation', 'Multilingual SEO', 'Interpretation', 'Subtitling', 'Global Brand'],
    traitBank: ['precise', 'culturally-aware', 'detail-oriented', 'organized', 'clear', 'patient', 'collaborative', 'quality-focused'],
    roles: [
      role('Localization Program Manager', 'end-to-end l10n workflows and vendor management'),
      role('Translation Project Manager', 'schedules, budgets, and linguist assignment'),
      role('Technical Translator Advisor', 'manuals, UI strings, and terminology consistency'),
      role('Marketing Transcreation Specialist', 'campaign adaptation for local markets'),
      role('Glossary and Style Guide Manager', 'termbases, tone, and forbidden terms'),
      role('Localization QA Reviewer', 'LQA passes, bug logging, and fix verification'),
      role('i18n Engineering Advisor', 'pseudo-localization, string externalization, and ICU'),
      role('Multilingual SEO Specialist', 'hreflang, localized keywords, and SERP strategy'),
      role('Interpretation Services Coordinator', 'simultaneous/consecutive scheduling and prep'),
      role('Subtitling and Captioning Manager', 'timing, reading speed, and platform specs'),
      role('Game Localization Producer', 'VO scripts, UI limits, and culturalization'),
      role('Software Localization Manager', 'release trains and in-context review'),
      role('Legal Translation Coordinator', 'certified workflows and notarization routing'),
      role('Medical Localization Advisor', 'IFU translation ops and regulatory labeling'),
      role('Desktop Publishing Localization Specialist', 'DTP for RTL and expansion layouts'),
      role('Machine Translation Post-Editor', 'MTPE quality tiers and edit distance metrics'),
      role('Voiceover Localization Producer', 'casting, studios, and lip-sync notes'),
      role('Global Brand Language Manager', 'brand voice across locales'),
      role('Locale Testing Coordinator', 'pseudolocale, currency, and format validation'),
      role('Interpretation for Business Advisor', 'meeting prep and cultural briefing'),
    ],
  },
  {
    id: 'journalism-publishing',
    label: 'Journalism & Publishing',
    iconId: 'news',
    businessCategory: true,
    skillBank: ['Reporting', 'Editing', 'Fact Checking', 'Headline Writing', 'Investigative Journalism', 'Editorial Calendar', 'Subscription Strategy', 'Print Production', 'Digital Publishing', 'Media Ethics', 'AP Style', 'Audience Development'],
    traitBank: sharedCreativeTraits,
    roles: [
      role('News Editor', 'daily news judgment and assignment desk'),
      role('Investigative Reporter Advisor', 'source development and document trails'),
      role('Fact Checker', 'verification workflows and correction policies'),
      role('Copy Chief', 'style consistency and final read standards'),
      role('Headline and SEO Editor', 'headlines, dek, and search-friendly packaging'),
      role('Features Editor', 'longform pitches and narrative structure'),
      role('Photo Editor', 'assignments, captions, and rights clearance'),
      role('Digital Publishing Manager', 'CMS workflows and publish calendars'),
      role('Subscription Growth Editor', 'paywall strategy and newsletter funnels'),
      role('Podcast News Producer', 'daily news audio and rundown sheets'),
      role('Opinion Editor Advisor', 'op-ed vetting and balance standards'),
      role('Local News Bureau Chief', 'community coverage and beat planning'),
      role('Data Journalism Advisor', 'datasets, charts, and reproducible analysis'),
      role('Magazine Managing Editor', 'issue planning and flatplan coordination'),
      role('Book Acquisitions Editor Advisor', 'proposal review and acquisition meetings'),
      role('Literary Agent Advisor', 'pitch packages and submission strategy'),
      role('Publishing Production Manager', 'print schedules, printers, and proofs'),
      role('Rights and Permissions Manager', 'licensing, quotes, and image rights'),
      role('Media Ethics Advisor', 'conflicts, anonymous sources, and corrections'),
      role('Audience Editor', 'engagement, comments moderation policy, and loyalty'),
    ],
  },
  {
    id: 'sports-entertainment-ops',
    label: 'Sports & Entertainment',
    iconId: 'sports',
    businessCategory: true,
    skillBank: ['Venue Operations', 'Ticketing', 'Event Production', 'Talent Booking', 'Sponsorship Sales', 'Fan Engagement', 'Broadcast Coordination', 'Merchandising', 'League Operations', 'Contract Negotiation', 'Safety Security', 'Tour Management'],
    traitBank: sharedBusinessTraits,
    roles: [
      role('Venue Operations Manager', 'arena/stadium run-of-show and staffing'),
      role('Ticketing Operations Manager', 'on-sales, dynamic pricing, and fraud prevention'),
      role('Sports Marketing Manager', 'fan campaigns, sponsors, and activations'),
      role('Athlete Partnership Manager', 'endorsements, appearances, and deliverables'),
      role('Event Producer Live Entertainment', 'concerts, festivals, and production timelines'),
      role('Tour Manager Advisor', 'routing, riders, and day sheets'),
      role('Sponsorship Sales Manager', 'inventory, proposals, and renewals'),
      role('Fan Engagement Director', 'loyalty programs, apps, and community'),
      role('Broadcast Operations Coordinator', 'IFB, feeds, and credentialing'),
      role('Merchandising Manager Sports', 'SKU planning, pop-ups, and tour merch'),
      role('League Operations Advisor', 'scheduling, rules ops, and discipline process'),
      role('Talent Booking Agent Advisor', 'holds, offers, and contract riders'),
      role('Stadium Security Operations Advisor', 'crowd management and incident command'),
      role('Esports Operations Manager', 'tournaments, formats, and anti-cheat ops'),
      role('Sports Analytics Business Advisor', 'ticket, sponsorship, and attendance insights'),
      role('VIP Hospitality Manager', 'suites, catering, and premium experiences'),
      role('Music Festival Operations Director', 'stages, vendors, and permits'),
      role('Agency Talent Manager Advisor', 'roster strategy and deal flow'),
      role('Sports Media Relations Manager', 'press conferences and crisis statements'),
      role('Entertainment Licensing Manager', 'music rights, cues, and clearances'),
    ],
  },
  {
    id: 'agriculture-agtech',
    label: 'Agriculture & AgTech',
    iconId: 'eco',
    businessCategory: true,
    skillBank: ['Crop Planning', 'Soil Health', 'Irrigation', 'Livestock Management', 'Farm Economics', 'AgTech Platforms', 'Precision Agriculture', 'Supply Contracts', 'Organic Certification', 'Pest Management', 'Harvest Logistics', 'Sustainability'],
    traitBank: ['practical', 'patient', 'observant', 'resourceful', 'risk-aware', 'organized', 'steady', 'environmentally-minded'],
    roles: [
      role('Farm Operations Manager', 'seasonal planning, labor, and equipment'),
      role('Crop Advisor', 'variety selection, rotations, and yield goals'),
      role('Soil Health Specialist', 'testing, amendments, and cover crops'),
      role('Irrigation Manager', 'scheduling, pivots, and water compliance'),
      role('Livestock Operations Manager', 'herd health protocols and feeding programs'),
      role('Precision Agriculture Specialist', 'GPS guidance, variable rate, and imagery'),
      role('AgTech Platform Advisor', 'farm management software and integrations'),
      role('Organic Certification Advisor', 'NOP compliance and audit preparation'),
      role('Integrated Pest Management Advisor', 'scouting, thresholds, and treatment plans'),
      role('Harvest Logistics Coordinator', 'crews, bins, and elevator contracts'),
      role('Farm Financial Planner', 'crop budgets, insurance, and cash flow'),
      role('Commodity Marketing Advisor', 'forward contracts, basis, and hedging basics'),
      role('Greenhouse Operations Manager', 'climate control, IPM, and bench planning'),
      role('Vineyard Operations Advisor', 'canopy, harvest timing, and cellar coordination'),
      role('Dairy Operations Manager', 'milking parlor ops and milk quality'),
      role('Poultry Operations Advisor', 'biosecurity, housing, and processing contracts'),
      role('Aquaculture Operations Manager', 'water quality, feeding, and harvest'),
      role('Ag Supply Chain Manager', 'inputs, freight, and storage'),
      role('Regenerative Agriculture Coach', 'practices, metrics, and transition planning'),
      role('Rural Cooperative Advisor', 'co-op governance and member services'),
    ],
  },
  {
    id: 'franchise-operations',
    label: 'Franchise Operations',
    iconId: 'storefront',
    businessCategory: true,
    skillBank: ['Franchise Development', 'Unit Economics', 'Operations Manuals', 'Field Support', 'Brand Standards', 'Franchisee Recruitment', 'Royalty Reporting', 'Multi-Unit Management', 'Training Programs', 'Marketing Cooperatives', 'Site Selection', 'Compliance Audits'],
    traitBank: sharedBusinessTraits,
    roles: [
      role('Franchise Operations Director', 'system standards and field visit programs'),
      role('Franchise Development Manager', 'selling franchises and disclosure compliance'),
      role('Franchisee Onboarding Manager', 'opening timelines and training checkpoints'),
      role('Field Consultant', 'coaching visits, action plans, and remediation'),
      role('Operations Manual Author', 'SOPs, updates, and version control'),
      role('Multi-Unit Franchisee Advisor', 'portfolio P&L and manager development'),
      role('Franchise Marketing Co-op Manager', 'ad fund governance and local campaigns'),
      role('Site Selection Analyst Franchise', 'demographics, drive-times, and cannibalization'),
      role('Franchise Compliance Auditor', 'brand standards and health/safety audits'),
      role('Royalty and Reporting Analyst', 'sales reporting, audits, and fee calculations'),
      role('Franchise Training Manager', 'university programs and certification'),
      role('Supplier Program Manager Franchise', 'approved vendors and rebate programs'),
      role('Franchise Legal Operations Advisor', 'FDD items, renewals, and transfers'),
      role('Franchise Technology Manager', 'POS, integrations, and rollout support'),
      role('International Master Franchise Advisor', 'country partners and adaptation'),
      role('Franchise Customer Experience Lead', 'mystery shops and NPS benchmarks'),
      role('Franchise Real Estate Manager', 'lease negotiations and renewal strategy'),
      role('Franchise Finance Advisor', 'unit economics, lending, and remodel ROI'),
      role('Franchise Crisis Response Manager', 'food safety incidents and brand protection'),
      role('Emerging Brand Franchise Strategist', 'franchiseability assessment and pilot'),
    ],
  },
  {
    id: 'maritime-aviation',
    label: 'Maritime & Aviation',
    iconId: 'maritime',
    businessCategory: true,
    skillBank: ['Port Operations', 'Vessel Scheduling', 'Maritime Safety', 'Freight Forwarding', 'Airline Ops', 'Airport Operations', 'Crew Scheduling', 'Maintenance Planning', 'Regulatory Compliance', 'Cargo Handling', 'Route Planning', 'Ground Handling'],
    traitBank: sharedOpsTraits,
    roles: [
      role('Port Operations Manager', 'berth planning, cranes, and terminal throughput'),
      role('Vessel Operations Coordinator', 'schedules, agents, and port calls'),
      role('Maritime Safety Officer Advisor', 'ISM, drills, and incident reporting'),
      role('Freight Forwarder Operations Lead', 'bookings, docs, and customs handoffs'),
      role('Airline Operations Controller Advisor', 'day-of recovery and irregular ops'),
      role('Airport Operations Manager', 'airside/landside coordination and slots'),
      role('Aircraft Maintenance Planner', 'checks, parts, and MEL coordination'),
      role('Crew Scheduling Manager', 'pairings, legality, and reserve staffing'),
      role('Cargo Operations Manager Air', 'ULD planning, build-up, and DG compliance'),
      role('Ground Handling Supervisor', 'ramp safety, turns, and SLA performance'),
      role('Maritime Logistics Manager', 'container flows, demurrage, and rail connections'),
      role('Charter Operations Advisor', 'trip support, permits, and handling'),
      role('Aviation Fuel Operations Advisor', 'into-plane, quality, and inventory'),
      role('Customs Broker Operations Advisor', 'entries, classifications, and exams'),
      role('Ship Agency Coordinator', 'port services, provisions, and crew changes'),
      role('Route Planning Analyst Aviation', 'network planning basics and seasonality'),
      role('Maritime Insurance Claims Advisor', 'H&M, P&I, and documentation'),
      role('Helicopter Operations Manager', 'rotor ops scheduling and weight/balance'),
      role('Rail Intermodal Coordinator', 'intermodal ramps and drayage'),
      role('Aviation Regulatory Compliance Advisor', 'SMS, audits, and authority correspondence'),
    ],
  },
  {
    id: 'education-career',
    label: 'Education & Career',
    iconId: 'school',
    skillBank: ['Curriculum Design', 'Instructional Coaching', 'Study Skills', 'Career Planning', 'Interview Preparation', 'Mentorship', 'Learning Science', 'Assessment Design', 'Professional Branding', 'Coaching Frameworks', 'Skill Mapping', 'Lifelong Learning'],
    traitBank: ['encouraging', 'patient', 'clear', 'insightful', 'structured', 'empathetic', 'adaptable', 'practical'],
    roles: [
      role('Academic Tutor', 'foundational learning support across disciplines'),
      role('STEM Mentor', 'math and engineering concept mastery'),
      role('Language Coach', 'language fluency and conversational confidence'),
      role('Career Mentor', 'career transitions and growth plans'),
      role('Interview Coach', 'interview storytelling and confidence building'),
      role('Resume Strategist', 'resume positioning and impact articulation'),
      role('Portfolio Coach', 'project portfolio quality and narrative design'),
      role('Learning Strategist', 'study plans and retention techniques'),
      role('Exam Preparation Coach', 'structured preparation and stress reduction'),
      role('Graduate School Advisor', 'application strategy and fit assessment'),
      role('Technical Writing Mentor', 'clear technical communication'),
      role('Leadership Coach', 'professional leadership development'),
      role('Public Speaking Coach', 'presentation confidence and structure'),
      role('Research Assistant Mentor', 'research methods and citation rigor'),
      role('Early Career Advisor', 'entry-level pathing and capability growth'),
      role('Career Change Navigator', 're-skilling strategy and role mapping'),
      role('Networking Coach', 'relationship-building and outreach tactics'),
      role('Negotiation Mentor', 'offer negotiation and compensation planning'),
      role('Professional Development Planner', 'long-term capability roadmaps'),
      role('Instructional Designer', 'learning experience and curriculum architecture'),
    ],
  },
  {
    id: 'health-wellness',
    label: 'Health & Wellness',
    iconId: 'favorite',
    skillBank: ['Wellness Coaching', 'Stress Management', 'Fitness Programming', 'Nutrition Guidance', 'Sleep Hygiene', 'Habit Design', 'Mindfulness', 'Recovery Planning', 'Behavior Change', 'Lifestyle Planning', 'Preventive Health', 'Goal Setting'],
    traitBank: ['kind', 'supportive', 'calm', 'encouraging', 'evidence-based', 'non-judgmental', 'empathetic', 'practical'],
    roles: [
      role('Mental Wellness Coach', 'stress reduction and emotional resilience'),
      role('Fitness Trainer', 'safe and progressive training plans'),
      role('Nutrition Advisor', 'sustainable nutrition and meal planning'),
      role('Sleep Specialist', 'sleep quality and circadian rhythm support'),
      role('Mindfulness Guide', 'mindfulness routines and mental clarity practices'),
      role('Habit Coach', 'habit formation and accountability systems'),
      role('Recovery Coach', 'recovery protocols and burnout prevention'),
      role('Work-Life Balance Coach', 'boundaries and sustainable workload habits'),
      role('Movement Coach', 'mobility, posture, and pain prevention'),
      role('Breathwork Coach', 'breathing techniques for focus and calm'),
      role('Wellness Program Designer', 'holistic personal wellness planning'),
      role('Stress Resilience Mentor', 'coping frameworks and resilience practices'),
      role('Lifestyle Medicine Guide', 'preventive lifestyle interventions'),
      role('Mind-Body Coach', 'integrated mental and physical wellbeing'),
      role('Beginner Fitness Mentor', 'first-step guidance for new exercisers'),
      role('Nutrition Habit Specialist', 'small-step dietary behavior change'),
      role('Healthy Routine Planner', 'daily and weekly health planning'),
      role('Energy Management Coach', 'productivity and recovery rhythm design'),
      role('Digital Wellness Coach', 'screen-time balance and focus hygiene'),
      role('Personal Wellness Strategist', 'long-term health and wellbeing roadmaps'),
    ],
  },
  {
    id: 'personal-life',
    label: 'Personal & Life',
    iconId: 'home',
    skillBank: ['Personal Finance', 'Home Planning', 'Family Organization', 'Travel Planning', 'Productivity Systems', 'Time Management', 'Decision Frameworks', 'Life Admin', 'Goal Planning', 'Relationship Communication', 'Practical Problem Solving', 'Routine Design'],
    traitBank: ['practical', 'clear', 'supportive', 'organized', 'empathetic', 'resourceful', 'encouraging', 'steady'],
    roles: [
      role('Personal Finance Coach', 'budgeting and practical money planning'),
      role('Life Admin Planner', 'organization of recurring life tasks'),
      role('Travel Planner', 'trip planning with realistic logistics'),
      role('Home Organization Advisor', 'decluttering and home system design'),
      role('Parenting Advisor', 'evidence-based family support strategies'),
      role('Relationship Communication Coach', 'healthy communication and boundaries'),
      role('Time Management Coach', 'calendar systems and focus routines'),
      role('Decision Coach', 'structured choices for major life decisions'),
      role('Personal Productivity Coach', 'execution systems and follow-through habits'),
      role('Routine Builder', 'daily routines and consistency plans'),
      role('Goal Accountability Coach', 'goal tracking and motivation support'),
      role('Household Budget Specialist', 'household cost planning and optimization'),
      role('Life Transition Coach', 'support during major personal transitions'),
      role('Remote Work Lifestyle Coach', 'sustainable remote life practices'),
      role('Event Planning Advisor', 'personal events and schedule orchestration'),
      role('Personal Legal Literacy Guide', 'everyday legal basics and awareness'),
      role('Digital Organization Coach', 'files, notes, and personal knowledge systems'),
      role('Relocation Planning Specialist', 'move planning and settling-in support'),
      role('Family Systems Coordinator', 'shared responsibilities and role clarity'),
      role('Personal Growth Mentor', 'long-term life planning and reflection'),
    ],
  },
  {
    id: 'creative-arts-media',
    label: 'Creative Arts & Media',
    iconId: 'brush',
    skillBank: ['Storytelling', 'Content Creation', 'Visual Arts', 'Video Production', 'Audio Production', 'Creative Direction', 'Script Writing', 'Photography', 'Brand Voice', 'Editing Workflows', 'Audience Development', 'Publishing Strategy'],
    traitBank: sharedCreativeTraits,
    roles: [
      role('Creative Director', 'cross-medium creative direction and execution'),
      role('Screenwriter', 'narrative structure and screenplay craft'),
      role('Music Producer', 'song development and audio production'),
      role('Video Producer', 'video storytelling and production workflows'),
      role('Photographer', 'visual composition and storytelling through imagery'),
      role('Podcast Producer', 'audio programming and listener engagement'),
      role('Copywriter', 'persuasive writing and voice consistency'),
      role('Content Creator', 'multi-platform content strategy and production'),
      role('Art Director', 'visual language and campaign direction'),
      role('Illustrator', 'concept and editorial illustration craft'),
      role('Motion Graphics Designer', 'animated storytelling and visual rhythm'),
      role('Documentary Researcher', 'fact-grounded narrative development'),
      role('Editor', 'story shaping and editorial quality control'),
      role('Social Media Producer', 'short-form social storytelling'),
      role('Creative Strategist', 'audience insights and concept development'),
      role('Brand Storyteller', 'cohesive brand narrative and messaging arcs'),
      role('Voice and Performance Coach', 'delivery, tone, and on-camera presence'),
      role('Culinary Creator', 'food storytelling and recipe media production'),
      role('Live Event Creative Producer', 'experiential creative programming'),
      role('Transmedia Producer', 'cross-channel narrative ecosystem design'),
    ],
  },
];

const allCategoryDefinitions = [...categoryDefinitions, ...expansionCategoryDefinitions()];

for (const category of allCategoryDefinitions) {
  if (category.roles.length < 20) {
    throw new Error(`${category.id} must contain at least 20 role templates`);
  }
}

const categories = allCategoryDefinitions.map((category) => {
  const crews = category.roles.map((entry, index) =>
    buildCrew(
      category.id,
      category.skillBank,
      category.traitBank,
      entry,
      index,
      category.businessCategory,
      category.clinicalCategory,
      category.medicalCategory,
    ),
  );
  return {
    id: category.id,
    label: category.label,
    iconId: category.iconId,
    medicalCategory: !!category.medicalCategory,
    crews,
  };
});

const allCallsigns = new Set();
for (const category of categories) {
  for (const crew of category.crews) {
    if (allCallsigns.has(crew.callsign)) {
      throw new Error(`Duplicate callsign detected: ${crew.callsign}`);
    }
    allCallsigns.add(crew.callsign);
  }
}

const categoryIconIds = Array.from(new Set(categories.map((category) => category.iconId)));

const indexContents = `/**
 * AUTO-GENERATED — run: node scripts/generate-crew-hub.mjs
 * Do not edit this file manually.
 */

export type PrebuiltCrewData = {
  name: string;
  title: string;
  callsign: string;
  description: string;
  systemPrompt: string;
  tone: string;
  expertise: string[];
  traits: string[];
  tools?: string[];
};

export type CategoryIconId = ${categoryIconIds.map((id) => `'${id}'`).join(' | ')};

export type PrebuiltCategoryIndexEntry = {
  id: string;
  label: string;
  iconId: CategoryIconId;
};

export const PREBUILT_CATEGORY_INDEX: PrebuiltCategoryIndexEntry[] = ${JSON.stringify(
  categories.map(({ id, label, iconId }) => ({ id, label, iconId })),
  null,
  2,
)};
`;

mkdirSync(CATEGORIES_DIR, { recursive: true });
writeFileSync(INDEX_PATH, indexContents, 'utf8');

const searchIndex = [];
for (const category of categories) {
  for (const crew of category.crews) {
    searchIndex.push({
      categoryId: category.id,
      categoryLabel: category.label,
      callsign: crew.callsign,
      name: crew.name,
      title: crew.title,
      expertise: crew.expertise.slice(0, 2),
      searchText: [
        crew.name,
        crew.title,
        crew.callsign,
        crew.description,
        crew.tone,
        ...crew.expertise,
        ...crew.traits,
      ].join(' ').toLowerCase(),
    });
  }
}

const searchIndexContents = `/**
 * AUTO-GENERATED — run: node scripts/generate-crew-hub.mjs
 * Do not edit this file manually.
 */

export type CrewSearchIndexEntry = {
  categoryId: string;
  categoryLabel: string;
  callsign: string;
  name: string;
  title: string;
  expertise: string[];
  searchText: string;
};

export const CREW_SEARCH_INDEX: CrewSearchIndexEntry[] = ${JSON.stringify(searchIndex)};
`;
writeFileSync(SEARCH_INDEX_PATH, searchIndexContents, 'utf8');

const manifestCrews = [];
for (const category of categories) {
  for (const crew of category.crews) {
    const searchText = [
      crew.name,
      crew.title,
      crew.callsign,
      crew.description,
      crew.tone,
      ...crew.expertise,
      ...crew.traits,
    ].join(' ').toLowerCase();
    manifestCrews.push({
      id: `hub-${crew.callsign}`,
      categoryId: category.id,
      categoryLabel: category.label,
      name: crew.name,
      title: crew.title,
      callsign: crew.callsign,
      description: crew.description,
      systemPrompt: crew.systemPrompt,
      tone: crew.tone,
      expertise: crew.expertise,
      traits: crew.traits,
      tools: crew.tools,
      searchText,
      requiresMedicalDisclaimer: !!category.medicalCategory,
    });
  }
}

let catalogRevision = 2;
if (existsSync(MANIFEST_PATH)) {
  try {
    const prev = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    catalogRevision = Math.max(2, Number(prev.revision ?? 1) + 1);
  } catch {
    catalogRevision = 2;
  }
}

const manifest = {
  revision: catalogRevision,
  categories: categories.map(({ id, label, iconId, medicalCategory }) => ({
    id,
    label,
    iconId,
    requiresMedicalDisclaimer: !!medicalCategory,
  })),
  crews: manifestCrews,
};
mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest), 'utf8');

const medicalCategoryIds = categories.filter((c) => c.medicalCategory).map((c) => c.id);
const medicalCatalogIds = manifestCrews.filter((c) => c.requiresMedicalDisclaimer).map((c) => c.id);
const sharedMedicalPath = join(__dirname, '../../shared/src/constants/medical-hub.generated.ts');
writeFileSync(sharedMedicalPath, `/** AUTO-GENERATED — run: node scripts/generate-crew-hub.mjs */
export const MEDICAL_HUB_CATEGORY_IDS_GENERATED: readonly string[] = ${JSON.stringify(medicalCategoryIds, null, 2)};
export const MEDICAL_HUB_CATALOG_IDS_GENERATED: readonly string[] = ${JSON.stringify(medicalCatalogIds, null, 2)};
`, 'utf8');

const catalogIndexPath = join(__dirname, '../../engine/data/crew-hub-catalog-index.md');
const indexLines = [
  `# Crew Hub Catalog Index`,
  ``,
  `Revision: **${catalogRevision}**`,
  `Categories: **${categories.length}**`,
  `Crew members: **${manifestCrews.length}**`,
  ``,
  `> Existing installs pick up new crews automatically when manifest revision advances (background catalog seed).`,
  ``,
];
for (const category of categories) {
  indexLines.push(`## ${category.label} (\`${category.id}\`) — ${category.crews.length} roles`);
  if (category.medicalCategory) indexLines.push(`*Medical informational disclaimer required*`);
  for (const crew of category.crews) {
    indexLines.push(`- ${crew.title} — ${crew.name}`);
  }
  indexLines.push('');
}
writeFileSync(catalogIndexPath, indexLines.join('\n'), 'utf8');

for (const category of categories) {
  const categoryPath = join(CATEGORIES_DIR, `${category.id}.ts`);
  const categoryContents = `/**
 * AUTO-GENERATED — run: node scripts/generate-crew-hub.mjs
 * Do not edit this file manually.
 */
import type { PrebuiltCrewData } from '../prebuilt-crews-index';

export const PREBUILT_CREWS: PrebuiltCrewData[] = ${JSON.stringify(category.crews, null, 2)};
`;
  writeFileSync(categoryPath, categoryContents, 'utf8');
}

if (existsSync(LEGACY_PATH)) {
  unlinkSync(LEGACY_PATH);
}

const perCategoryCounts = categories.map((category) => `${category.id}: ${category.crews.length}`);
const total = categories.reduce((acc, category) => acc + category.crews.length, 0);

console.log(`Generated ${INDEX_PATH}, ${SEARCH_INDEX_PATH}, ${MANIFEST_PATH}, and ${categories.length} category files`);
console.log(perCategoryCounts.join('\n'));
console.log(`grand-total: ${total}`);
