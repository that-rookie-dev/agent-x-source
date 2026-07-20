#!/usr/bin/env bash
pnpm --filter @agentx/shared --filter @agentx/engine --filter @agentx/web-api --filter @agentx/web-ui run build

rsync -a packages/web-api/dist/ /Applications/Agent-X.app/Contents/Resources/web-api/
rsync -a packages/web-ui/dist/ /Applications/Agent-X.app/Contents/Resources/web-ui/