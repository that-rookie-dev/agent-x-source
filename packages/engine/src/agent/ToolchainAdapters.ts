import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generic, extensible toolchain detection shared by `VerificationResultParser` and
 * `CodingTurnGuard`.
 *
 * Root cause this replaces: both consumers used to carry their own hardcoded, Node/npm-biased
 * command allow-lists that had silently drifted out of sync (see docs/engineering-crew/DESIGN.md
 * Section 2.1). Any ecosystem missing from those lists — e.g. Maven/Gradle for JVM projects —
 * was completely invisible to the verification gate, so the agent could declare a task "done"
 * without ever running a check the gate recognized.
 *
 * Adding support for a new ecosystem should mean registering one `ToolchainAdapter` here, not
 * editing multiple unrelated arrays across the codebase.
 */
export interface ToolchainAdapter {
  /** Stable id, e.g. 'maven', 'npm', 'cargo'. */
  id: string;
  /** Human-readable label for messages/logs. */
  label: string;
  /** Regexes that identify a shell command as belonging to this toolchain (any stage). */
  commandPatterns: RegExp[];
  /**
   * Secondary text heuristics — only consulted when an exit code isn't available, or to
   * catch tools that report success (exit 0) despite a real failure. Exit code always wins
   * when present; never used to override a nonzero exit code into "success".
   */
  successHints?: RegExp[];
  failureHints?: RegExp[];
  /** File(s) whose presence in a project root indicates this toolchain applies. */
  markerFiles?: string[];
}

/**
 * Built-in registry. Deliberately not exhaustive — this is an extensible list, not a closed
 * one. Unlisted/custom toolchains still get verified via the "explicit commands from the plan"
 * fallback path described in docs/engineering-crew/DESIGN.md Section 4.4; they are not silently
 * skipped.
 */
export const TOOLCHAIN_ADAPTERS: ToolchainAdapter[] = [
  {
    id: 'npm',
    label: 'npm/Node.js',
    commandPatterns: [/\bnpm\s+(run\s+)?(build|test|lint|typecheck|tsc)\b/, /\bnpx\s+tsc\b/],
    successHints: [/compiled\s+successfully/i, /\b\d+\s+passing\b/i],
    failureHints: [/error\s+TS\d+/i, /\bnpm\s+ERR!/i],
    markerFiles: ['package.json'],
  },
  {
    id: 'pnpm',
    label: 'pnpm',
    commandPatterns: [/\bpnpm\s+(run\s+)?(build|test|lint|typecheck)\b/],
    markerFiles: ['pnpm-lock.yaml'],
  },
  {
    id: 'yarn',
    label: 'Yarn',
    commandPatterns: [/\byarn\s+(run\s+)?(build|test|lint|typecheck)\b/],
    markerFiles: ['yarn.lock'],
  },
  {
    id: 'jest-vitest-mocha',
    label: 'JS/TS test runner',
    commandPatterns: [/\bjest\b/, /\bvitest\b/, /\bmocha\b/],
    successHints: [/\b\d+\s+passing\b/i, /all\s+tests\s+passed/i],
    failureHints: [/\b\d+\s+failing\b/i],
  },
  {
    id: 'eslint',
    label: 'ESLint',
    commandPatterns: [/\beslint\b/],
    successHints: [/no\s+issues?\s+found/i],
  },
  {
    id: 'maven',
    label: 'Maven (JVM)',
    commandPatterns: [/\bmvn\b/, /\bmvnw\b/, /\.\/mvnw\b/],
    successHints: [/\bBUILD SUCCESS\b/, /\bTests run:.*Failures:\s*0.*Errors:\s*0/s],
    failureHints: [/\bBUILD FAILURE\b/, /\bBUILD ERROR\b/],
    markerFiles: ['pom.xml'],
  },
  {
    id: 'gradle',
    label: 'Gradle (JVM)',
    commandPatterns: [/\bgradle\b/, /\bgradlew\b/, /\.\/gradlew\b/],
    successHints: [/\bBUILD SUCCESSFUL\b/],
    failureHints: [/\bBUILD FAILED\b/],
    markerFiles: ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'],
  },
  {
    id: 'cargo',
    label: 'Cargo (Rust)',
    commandPatterns: [/\bcargo\s+(build|test|check|clippy)\b/],
    successHints: [/\bFinished\b.*\bprofile\b/i],
    failureHints: [/\berror\[E\d+\]/i, /\berror:\s+could not compile\b/i],
    markerFiles: ['Cargo.toml'],
  },
  {
    id: 'go',
    label: 'Go',
    commandPatterns: [/\bgo\s+(build|test|vet)\b/],
    failureHints: [/^#\s.*\n.*\.go:\d+/m],
    markerFiles: ['go.mod'],
  },
  {
    id: 'pytest',
    label: 'Python (pytest/unittest)',
    commandPatterns: [/\bpytest\b/, /\bpython[3]?\s+-m\s+(pytest|unittest)\b/, /\btox\b/],
    successHints: [/\bpassed\b.*\bin\s+[\d.]+s/i],
    failureHints: [/\bFAILED\b/, /\berror(s)?\b.*\bin\s+[\d.]+s/i, /\bTraceback\b/],
    markerFiles: ['pyproject.toml', 'requirements.txt', 'setup.py'],
  },
  {
    id: 'mypy-ruff-flake8',
    label: 'Python linters/typecheckers',
    commandPatterns: [/\bmypy\b/, /\bruff\b/, /\bflake8\b/, /\bpylint\b/],
  },
  {
    id: 'dotnet',
    label: '.NET (dotnet/MSBuild)',
    commandPatterns: [/\bdotnet\s+(build|test|run)\b/, /\bmsbuild\b/i],
    successHints: [/\bBuild succeeded\b/],
    failureHints: [/\bBuild FAILED\b/],
    markerFiles: [],
  },
  {
    id: 'bundler-rspec',
    label: 'Ruby (Bundler/RSpec)',
    commandPatterns: [/\bbundle\s+exec\s+rspec\b/, /\brake\s+test\b/, /\brspec\b/],
    failureHints: [/\d+\s+failures?\b/],
    markerFiles: ['Gemfile'],
  },
  {
    id: 'composer-phpunit',
    label: 'PHP (Composer/PHPUnit)',
    commandPatterns: [/\bphpunit\b/, /\bcomposer\s+test\b/],
    failureHints: [/\bFAILURES!\b/],
    markerFiles: ['composer.json'],
  },
  {
    id: 'cmake-make',
    label: 'C/C++ (CMake/Make)',
    commandPatterns: [/\bcmake\s+--build\b/, /\bmake\b/],
    failureHints: [/\bError\s+\d+\b/, /\bundefined reference\b/],
    markerFiles: ['CMakeLists.txt', 'Makefile'],
  },
  {
    id: 'xcodebuild',
    label: 'Swift/iOS (xcodebuild)',
    commandPatterns: [/\bxcodebuild\b/, /\bswift\s+(build|test)\b/],
    successHints: [/\*\*\s+BUILD SUCCEEDED\s+\*\*/],
    failureHints: [/\*\*\s+BUILD FAILED\s+\*\*/],
  },
  {
    id: 'gradle-android',
    label: 'Android (Gradle)',
    commandPatterns: [/\.\/gradlew\s+(assemble|test|check|connectedAndroidTest)\b/],
    successHints: [/\bBUILD SUCCESSFUL\b/],
    failureHints: [/\bBUILD FAILED\b/],
  },
  {
    id: 'terraform',
    label: 'Terraform / infra-as-code',
    commandPatterns: [/\bterraform\s+(plan|apply|validate)\b/],
    failureHints: [/\bError:\s/],
  },
];

/** True if `command` matches any registered adapter's command patterns. */
export function isKnownVerificationCommand(command: string): boolean {
  return TOOLCHAIN_ADAPTERS.some((a) => a.commandPatterns.some((p) => p.test(command)));
}

/** Returns the adapter that recognizes `command`, if any. */
export function detectAdapterForCommand(command: string): ToolchainAdapter | undefined {
  return TOOLCHAIN_ADAPTERS.find((a) => a.commandPatterns.some((p) => p.test(command)));
}

/** Best-effort detection of applicable adapters from files present in a project root. */
export function detectAdaptersForProject(projectRoot: string): ToolchainAdapter[] {
  return TOOLCHAIN_ADAPTERS.filter(
    (a) => a.markerFiles?.some((f) => existsSync(join(projectRoot, f))) ?? false,
  );
}
