-- Drop the legacy per-session permissions table.
-- Permission decisions are now stored in the file-backed SessionPermissionStore
-- at {dataDir}/sessions/{sessionId}/permissions.json, and the bypass flag is
-- managed by the unified permission system. The old DB table is no longer
-- read or written by any code path.
DROP TABLE IF EXISTS permissions;
DROP INDEX IF EXISTS idx_permissions_session;
