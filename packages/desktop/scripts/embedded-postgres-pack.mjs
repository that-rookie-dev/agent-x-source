/**
 * Helpers for bundling @embedded-postgres/* platform binaries into desktop/server packages.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { arch as hostArch } from 'node:os';

export const EMBEDDED_POSTGRES_VERSION = '17.5.0-beta.15';

export const EMBEDDED_ALL_PACKAGES = [
  '@embedded-postgres/darwin-arm64',
  '@embedded-postgres/darwin-x64',
  '@embedded-postgres/linux-arm64',
  '@embedded-postgres/linux-x64',
  '@embedded-postgres/windows-x64',
];

export const EMBEDDED_MAC_PACKAGES = [
  '@embedded-postgres/darwin-arm64',
  '@embedded-postgres/darwin-x64',
];

export const EMBEDDED_LINUX_PACKAGES = [
  '@embedded-postgres/linux-arm64',
  '@embedded-postgres/linux-x64',
];

const SUFFIX_TO_PACKAGE = {
  'darwin-arm64': '@embedded-postgres/darwin-arm64',
  'darwin-x64': '@embedded-postgres/darwin-x64',
  'linux-arm64': '@embedded-postgres/linux-arm64',
  'linux-x64': '@embedded-postgres/linux-x64',
  'win-x64': '@embedded-postgres/windows-x64',
};

export function normalizeArch(arch) {
  return String(arch).toLowerCase().includes('arm') ? 'arm64' : 'x64';
}

export function resolveTargetArch() {
  return process.env.TARGET_ARCH
    || process.env.ARCH
    || process.env.npm_config_arch
    || process.arch;
}

export function resolveTargetPlatform() {
  return process.env.TARGET_PLATFORM
    || process.env.npm_config_platform
    || process.platform;
}

export function suffixFor(platform, arch) {
  const cpu = normalizeArch(arch);
  if (platform === 'darwin') return cpu === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (platform === 'linux') return cpu === 'arm64' ? 'linux-arm64' : 'linux-x64';
  if (platform === 'win32') return 'win-x64';
  throw new Error(`Unsupported pack platform: ${platform}/${arch}`);
}

/** Resolve release tarball / artifact suffix (honours AGENTX_PACK_SUFFIX for cross-arch CI). */
export function resolvePackSuffix(hostPlatform = process.platform, hostArch = process.arch) {
  if (process.env.AGENTX_PACK_SUFFIX) return process.env.AGENTX_PACK_SUFFIX;
  const platform = resolveTargetPlatform();
  const arch = resolveTargetArch();
  if (platform !== hostPlatform || normalizeArch(arch) !== normalizeArch(hostArch)) {
    return suffixFor(platform, arch);
  }
  return suffixFor(hostPlatform, hostArch);
}

export function packageForSuffix(suffix) {
  return SUFFIX_TO_PACKAGE[suffix] ?? '';
}

export function embeddedPackageFor(platform, arch) {
  return packageForSuffix(suffixFor(platform, arch));
}

export function storeEntryPrefix(pkgName) {
  return pkgName.startsWith('@') ? `${pkgName.replace('/', '+')}@` : `${pkgName}@`;
}

export function findInPnpmStore(pnpmStoreDir, pkgName) {
  if (!existsSync(pnpmStoreDir)) return null;
  const prefix = storeEntryPrefix(pkgName);
  for (const entry of readdirSync(pnpmStoreDir)) {
    if (!entry.startsWith(prefix)) continue;
    const src = pkgName.startsWith('@')
      ? join(pnpmStoreDir, entry, 'node_modules', ...pkgName.split('/'))
      : join(pnpmStoreDir, entry, 'node_modules', pkgName);
    if (existsSync(src)) return src;
  }
  return null;
}

export function postgresBinaryName(platform) {
  return platform === 'win32' ? 'postgres.exe' : 'postgres';
}

export function nativePostgresBin(nodeModulesRoot, pkgName, platform) {
  return join(nodeModulesRoot, ...pkgName.split('/'), 'native', 'bin', postgresBinaryName(platform));
}

export function assertNativePostgres(nodeModulesRoot, pkgName, platform) {
  const bin = nativePostgresBin(nodeModulesRoot, pkgName, platform);
  if (!existsSync(bin)) {
    throw new Error(
      `Missing embedded PostgreSQL binary for ${pkgName} (expected ${bin}). `
      + 'Run pnpm install from the repo root before packaging.',
    );
  }
}

/** initdb/postgres need shared libraries from native/lib at runtime (not just bin/). */
export function assertPostgresSharedLibs(nodeModulesRoot, pkgName, packPlatform) {
  const libDir = join(nodeModulesRoot, ...pkgName.split('/'), 'native', 'lib');
  const required = packPlatform === 'linux'
    ? ['libpq.so.5']
    : packPlatform === 'darwin'
      ? ['libicudata.68.dylib', 'libpq.5.dylib']
      : [];

  for (const name of required) {
    const libPath = join(libDir, name);
    if (!existsSync(libPath)) {
      throw new Error(
        `Missing PostgreSQL shared library for ${pkgName} (expected ${libPath}). `
        + 'The server pack must copy the full @embedded-postgres platform tree from the local build, not npm registry stubs.',
      );
    }
  }
}

function samePath(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

/** Copy extension + shared-library artifacts between two native trees. */
export function syncEmbeddedExtensions(fromNative, toNative, packPlatform = 'unix') {
  if (!existsSync(fromNative) || !existsSync(toNative)) return;
  // Materialize already copied a tree that includes extensions — nothing to sync.
  if (samePath(fromNative, toNative)) return;

  const pairs = packPlatform === 'win32'
    ? [
      ['share/extension', () => true],
      ['lib', (name) => /^vector/i.test(name) && name.endsWith('.dll')],
    ]
    : [
      ['share/postgresql/extension', () => true],
      ['lib/postgresql', (name) => name.endsWith('.dylib') || name.endsWith('.so')],
    ];

  for (const [sub, include] of pairs) {
    const fromDir = join(fromNative, sub);
    const toDir = join(toNative, sub);
    if (!existsSync(fromDir)) continue;
    mkdirSync(toDir, { recursive: true });
    for (const name of readdirSync(fromDir)) {
      if (!include(name)) continue;
      const src = join(fromDir, name);
      const dest = join(toDir, name);
      if (samePath(src, dest)) continue;
      cpSync(src, dest, { force: true });
    }
  }
}

/** Copy pgvector/AGE artifacts built on arm64 into the Intel macOS tree. */
export function syncDarwinEmbeddedExtensions(desktopNodeModules) {
  syncEmbeddedExtensions(
    join(desktopNodeModules, '@embedded-postgres', 'darwin-arm64', 'native'),
    join(desktopNodeModules, '@embedded-postgres', 'darwin-x64', 'native'),
  );
}

export function pgVectorControlPath(nativeDir, packPlatform = 'unix') {
  if (packPlatform === 'win32') {
    return join(nativeDir, 'share', 'extension', 'vector.control');
  }
  return join(nativeDir, 'share', 'postgresql', 'extension', 'vector.control');
}

export function assertPgVectorExtension(nativeDir, packPlatform = 'unix') {
  const control = pgVectorControlPath(nativeDir, packPlatform);
  if (!existsSync(control)) {
    throw new Error(
      `Missing pgvector extension in server pack (expected ${control}). `
      + 'Run pnpm --filter @agentx/runtime run setup:extensions before packing.',
    );
  }
}

export function resolveDarwinArm64DonorNative(workspaceRoot, storeDir) {
  const candidates = [
    join(workspaceRoot, 'node_modules', '@embedded-postgres', 'darwin-arm64', 'native'),
    join(workspaceRoot, 'packages', 'runtime', 'node_modules', '@embedded-postgres', 'darwin-arm64', 'native'),
    join(workspaceRoot, 'packages', 'desktop', 'node_modules', '@embedded-postgres', 'darwin-arm64', 'native'),
  ];

  const fromStore = findInPnpmStore(storeDir, '@embedded-postgres/darwin-arm64');
  if (fromStore) {
    candidates.push(join(fromStore, 'native'));
  }

  for (const nativeDir of candidates) {
    if (existsSync(pgVectorControlPath(nativeDir))) {
      return nativeDir;
    }
  }
  return null;
}

export function embeddedPkgCandidates(workspaceRoot, embeddedPkg) {
  return [
    join(workspaceRoot, 'node_modules', ...embeddedPkg.split('/')),
    join(workspaceRoot, 'packages', 'runtime', 'node_modules', ...embeddedPkg.split('/')),
    join(workspaceRoot, 'packages', 'desktop', 'node_modules', ...embeddedPkg.split('/')),
  ];
}

/** Prefer workspace trees that already have pgvector built by setup:extensions. */
export function resolveBuiltEmbeddedPkgRoot(workspaceRoot, storeDir, embeddedPkg, packPlatform = 'unix') {
  for (const candidate of embeddedPkgCandidates(workspaceRoot, embeddedPkg)) {
    if (existsSync(pgVectorControlPath(join(candidate, 'native'), packPlatform))) {
      return candidate;
    }
  }

  const fromStore = findInPnpmStore(storeDir, embeddedPkg);
  if (fromStore) return fromStore;

  for (const candidate of embeddedPkgCandidates(workspaceRoot, embeddedPkg)) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

export function resolveExtensionDonorNative(workspaceRoot, storeDir, suffix, packPlatform = 'unix') {
  // Cross-arch only: packing Intel macOS on an Apple Silicon host borrows arm64-built extensions.
  // On native Intel (macos-15-intel), use the local darwin-x64 tree instead.
  if (suffix === 'darwin-x64' && hostArch() === 'arm64') {
    return resolveDarwinArm64DonorNative(workspaceRoot, storeDir);
  }

  const embeddedPkg = packageForSuffix(suffix);
  if (!embeddedPkg) return null;

  const builtRoot = resolveBuiltEmbeddedPkgRoot(workspaceRoot, storeDir, embeddedPkg, packPlatform);
  return builtRoot ? join(builtRoot, 'native') : null;
}

export function requiredEmbeddedPackages(platform, arch) {
  if (platform === 'darwin') return [...EMBEDDED_MAC_PACKAGES];
  if (platform === 'linux') {
    const pkg = embeddedPackageFor('linux', arch);
    return pkg ? [pkg] : [];
  }
  if (platform === 'win32') return ['@embedded-postgres/windows-x64'];
  const pkg = embeddedPackageFor(platform, arch);
  return pkg ? [pkg] : [];
}
