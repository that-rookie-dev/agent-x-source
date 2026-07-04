import type {
  IntegrationAuthMode,
  IntegrationCatalogStatus,
  IntegrationCategory,
  IntegrationProvider,
  IntegrationTrust,
} from '@agentx/shared';

export const field = (
  key: string,
  label: string,
  placeholder?: string,
  secret = true,
): NonNullable<IntegrationProvider['auth']['fields']>[number] => ({
  key,
  label,
  placeholder,
  secret,
  required: true,
});

export function stdioNpx(pkg: string, extraArgs: string[] = []): IntegrationProvider['server'] {
  return {
    type: 'stdio',
    command: 'npx',
    args: ['-y', pkg, ...extraArgs],
    package: pkg,
  };
}

export function remoteMcp(url: string, packageLabel?: string): IntegrationProvider['server'] {
  return { type: 'remote', url, package: packageLabel ?? url };
}

interface ProviderBase {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  icon: string;
  website?: string;
  trust?: IntegrationTrust;
  catalogStatus?: IntegrationCatalogStatus;
  npmPackage?: string;
  evaluationNotes?: string;
  server: IntegrationProvider['server'];
  auth: IntegrationProvider['auth'];
  capabilities: IntegrationProvider['capabilities'];
  tools?: IntegrationProvider['tools'];
  connectGuide?: IntegrationProvider['auth']['connectGuide'];
}

export function defineProvider(base: ProviderBase): IntegrationProvider {
  return {
    ...base,
    trust: base.trust ?? 'verified',
    catalogStatus: base.catalogStatus ?? 'active',
  };
}

export function candidateStdio(opts: {
  id: string;
  name: string;
  category: IntegrationCategory;
  pkg: string;
  description: string;
  icon?: string;
  website?: string;
  trust?: IntegrationTrust;
  envKey?: string;
  envLabel?: string;
  fields?: IntegrationProvider['auth']['fields'];
  authPrimary?: IntegrationAuthMode;
  extraArgs?: string[];
  transact?: boolean;
  evaluationNotes?: string;
  connectGuide?: IntegrationProvider['auth']['connectGuide'];
  packageSignIn?: IntegrationProvider['auth']['packageSignIn'];
  tools?: IntegrationProvider['tools'];
}): IntegrationProvider {
  const authFields = opts.fields ?? (opts.envKey ? [field(opts.envKey, opts.envLabel ?? opts.envKey)] : undefined);
  const authPrimary = opts.authPrimary ?? (authFields?.length ? 'api_key_form' : 'none');
  return defineProvider({
    id: opts.id,
    name: opts.name,
    category: opts.category,
    description: opts.description,
    icon: opts.icon ?? 'hub',
    website: opts.website,
    trust: opts.trust ?? 'community',
    catalogStatus: 'candidate',
    npmPackage: opts.pkg,
    evaluationNotes: opts.evaluationNotes ?? 'Candidate — connect manually to evaluate; promote by setting catalogStatus to active.',
    server: stdioNpx(opts.pkg, opts.extraArgs ?? []),
    auth: authFields?.length
      ? {
          primary: authPrimary,
          developer: ['stdio', 'env'],
          fields: authFields,
          connectGuide: opts.connectGuide,
          packageSignIn: opts.packageSignIn,
        }
      : {
          primary: authPrimary,
          developer: ['stdio'],
          connectGuide: opts.connectGuide,
          packageSignIn: opts.packageSignIn,
        },
    capabilities: {
      search: true,
      read: true,
      write: true,
      transact: opts.transact ?? false,
    },
    tools: opts.tools,
  });
}

export function candidateRemote(opts: {
  id: string;
  name: string;
  category: IntegrationCategory;
  url: string;
  description: string;
  icon?: string;
  website?: string;
  trust?: IntegrationTrust;
  authPrimary?: IntegrationAuthMode;
  oauth?: IntegrationProvider['auth']['oauth'];
  fields?: IntegrationProvider['auth']['fields'];
  transact?: boolean;
  evaluationNotes?: string;
}): IntegrationProvider {
  return defineProvider({
    id: opts.id,
    name: opts.name,
    category: opts.category,
    description: opts.description,
    icon: opts.icon ?? 'hub',
    website: opts.website,
    trust: opts.trust ?? 'verified',
    catalogStatus: 'candidate',
    npmPackage: opts.url,
    evaluationNotes: opts.evaluationNotes ?? 'Candidate remote MCP — verify OAuth and tool surface before promoting.',
    server: remoteMcp(opts.url, opts.url),
    auth: {
      primary: opts.authPrimary ?? 'oauth',
      developer: ['remote_url', 'oauth'],
      oauth: opts.oauth ?? ((opts.authPrimary ?? 'oauth') === 'oauth'
        ? { resource: opts.url, scopes: ['mcp'] }
        : undefined),
      fields: opts.fields,
    },
    capabilities: {
      search: true,
      read: true,
      write: true,
      transact: opts.transact ?? false,
    },
  });
}
