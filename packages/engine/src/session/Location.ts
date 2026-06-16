import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Location {
  path: string;
  workspaceId?: string;
  projectName?: string;
  gitRoot?: string;
  gitBranch?: string;
  gitDirty?: boolean;
}

export function detectLocation(scopePath: string): Location {
  const loc: Location = { path: scopePath };
  let current = scopePath;
  while (current !== '/') {
    if (existsSync(join(current, '.git'))) {
      loc.gitRoot = current;
      loc.projectName = current.split('/').pop();
      try {
        const head = readFileSync(join(current, '.git', 'HEAD'), 'utf-8').trim();
        const branchMatch = head.match(/ref: refs\/heads\/(.+)/);
        if (branchMatch) loc.gitBranch = branchMatch[1];
      } catch {}
      break;
    }
    current = join(current, '..');
  }
  return loc;
}
