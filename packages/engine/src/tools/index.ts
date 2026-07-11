export { ToolRegistry } from './ToolRegistry.js';
export { ToolExecutor } from './ToolExecutor.js';
export { EnhancedToolExecutor } from './EnhancedToolExecutor.js';
export { ParallelClassifier } from './ParallelClassifier.js';
export type { ClassifiedTool, ParallelClassification } from './ParallelClassifier.js';
export {
  getCoreTools,
  shouldDisclose,
  createBridgeTools,
  resolveBridgeToolCall,
} from './ProgressiveDisclosure.js';
export { createDefaultToolkit } from './toolkit.js';
export type { PermissionRequestHandler } from './ToolExecutor.js';
export { PermissionManager } from './permissions/PermissionManager.js';
export { ScopeGuard } from './permissions/ScopeGuard.js';
export {
  IS_WINDOWS, IS_MACOS, IS_LINUX,
  getShellCommand, getWhichCommand, getProcessListCommand,
  getDiskSpaceCommand, getPortListCommand, getDirectorySizeCommand,
  getGrepCommand, getFindCommand, checkCommandExists,
} from './platform.js';

// Filesystem tools
export {
  fileRead,
  fileWrite,
  fileDelete,
  folderCreate,
  folderDelete,
  folderList,
  folderMove,
} from './builtin/filesystem.js';

// Shell tools
export { shellExec, shellBackground, processKill, processList, setShellSandbox } from './builtin/shell.js';

// Git tools
export {
  gitStatus, gitDiff, gitLog, gitCommit, gitAdd,
  gitBranch, gitCheckout, gitStash, gitBlame, gitShow,
} from './builtin/git.js';

// Code intelligence tools
export { codeSearch, codeDefinitions, codeReplace, codeInsert, codeSymbols } from './builtin/code.js';

// Package tools
export { packageInstall, packageRemove, packageList, packageOutdated, packageRun } from './builtin/packages.js';

// Testing tools
export { testRun, testWatch, testCoverage, testCreate } from './builtin/testing.js';

// Data tools
export { jsonParse, jsonQuery, jsonSet, csvParse, textTransform } from './builtin/data.js';
export { renderChart } from './builtin/data.js';

// Web tools
export { httpGet, httpPost, httpRequest, webScrape, webSearch } from './builtin/web.js';

// Container tools
export {
  containerList, containerLogs, containerStart, containerStop,
  containerExec, containerRun, containerCompose, containerImages,
} from './builtin/containers.js';

// Database tools
export { dbQuery, dbSchema, dbExport, envRead } from './builtin/database.js';

// GitHub tools
export {
  ghIssueList, ghIssueCreate, ghPrList, ghPrCreate,
  ghPrView, ghRepoView, ghWorkflowList, ghRelease,
} from './builtin/github.js';

// System tools
export {
  systemInfo, systemDiskSpace, systemEnv, systemWhich,
  systemPorts, systemTreeSize, securityAudit, securitySecrets, fileChecksum,
} from './builtin/system.js';

// Browser automation tools
export { browserOpen, browserScreenshot, browserClick, browserEval } from './builtin/browser.js';
