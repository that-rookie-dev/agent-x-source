#!/usr/bin/env node
import { INTEGRATION_PROVIDERS, INTEGRATION_CATALOG, getCatalogStats } from '../packages/engine/src/integrations/catalog/providers.ts';

const KNOWN_PACKAGES = new Set([
  '@modelcontextprotocol/server-github',
  '@modelcontextprotocol/server-slack',
  '@modelcontextprotocol/server-brave-search',
  '@modelcontextprotocol/server-postgres',
  '@pulsemcp/pulse-fetch',
  '@modelcontextprotocol/server-filesystem',
  'mcp-discord',
  '@modelcontextprotocol/server-gdrive',
  '@modelcontextprotocol/server-google-maps',
  '@modelcontextprotocol/server-redis',
  'sqlite-mcp-server',
  '@sentry/mcp-server',
  '@modelcontextprotocol/server-puppeteer',
  '@modelcontextprotocol/server-memory',
  '@stripe/mcp',
  '@paypal/mcp',
  '@shopify/dev-mcp',
  '@supabase/mcp-server-supabase',
  '@mondaydotcomorg/monday-api-mcp',
  'clickup-mcp',
  'mcp-server-trello',
  'obsidian-mcp',
  '@chaindead/telegram-mcp',
  '@gongrzhe/server-gmail-autoauth-mcp',
  'twilio-mcp',
  'zoom-mcp-server',
  'zendesk-mcp',
  'whatsapp-mcp',
  'mcp-travelcode',
  '@striderlabs/mcp-booking',
  'quickbooks-mcp',
  'xero-mcp',
  '@codespar/mcp-coinbase-cdp',
  'yahoo-finance-mcp',
  'alpha-vantage-mcp',
  'amazon-mcp',
  'ebay-mcp',
  '@amitgurbani/mcp-server-woocommerce',
  'walmart-mcp',
  '@striderlabs/mcp-target',
  'mqtt-mcp',
]);

const KNOWN_REMOTE_URLS = new Set([
  'https://mcp.notion.com/mcp',
  'https://mcp.linear.app/mcp',
  'https://mcp.atlassian.com/v1/mcp/authv2',
  'https://mcp.stayker.com/mcp',
]);

let failed = 0;

for (const provider of INTEGRATION_PROVIDERS) {
  if (!provider.id || !provider.name || !provider.category) {
    console.error(`Invalid provider manifest: missing id/name/category`, provider.id);
    failed += 1;
    continue;
  }
  if (provider.auth.primary === 'oauth' && !provider.auth.oauth) {
    console.error(`Provider ${provider.id} uses oauth primary but has no oauth config`);
    failed += 1;
  }
  if (provider.server.type === 'stdio' && provider.auth.primary === 'none' && !provider.server.command) {
    console.error(`Provider ${provider.id} stdio/none requires server.command`);
    failed += 1;
  }
  if (provider.server.type === 'stdio' && provider.server.args?.length) {
    const pkg = provider.server.package ?? provider.server.args.find((arg) => arg.startsWith('@') || arg.startsWith('mcp-'));
    if (pkg && !KNOWN_PACKAGES.has(pkg)) {
      console.error(`Provider ${provider.id} references unverified npm package: ${pkg}`);
      failed += 1;
    }
  }
  if (provider.server.type === 'remote') {
    const url = provider.server.url;
    if (!url && provider.auth.primary === 'remote_url') {
      continue;
    }
    if (!url || !KNOWN_REMOTE_URLS.has(url)) {
      console.error(`Provider ${provider.id} references unverified remote MCP URL: ${url ?? '(missing)'}`);
      failed += 1;
    }
  }
  if (provider.category === 'finance' || provider.category === 'shopping') {
    // lifestyle categories must have at least one provider each (checked below globally)
  }
}

const categories = new Set(INTEGRATION_PROVIDERS.map((p) => p.category));
for (const required of ['finance', 'shopping', 'travel', 'smart_home']) {
  if (!categories.has(required)) {
    console.error(`Missing required lifestyle category in catalog: ${required}`);
    failed += 1;
  }
}

if (INTEGRATION_PROVIDERS.length < 20) {
  console.error(`Expected at least 20 active catalog providers, found ${INTEGRATION_PROVIDERS.length}`);
  failed += 1;
}

const stats = getCatalogStats();
if (INTEGRATION_CATALOG.length < 40) {
  console.error(`Expected at least 40 verified catalog entries (active + candidates), found ${INTEGRATION_CATALOG.length}`);
  failed += 1;
}

const perCategory = new Map();
for (const p of INTEGRATION_CATALOG) {
  if (p.category === 'custom') continue;
  perCategory.set(p.category, (perCategory.get(p.category) ?? 0) + 1);
}
for (const [cat, count] of perCategory) {
  if (count < 1) {
    console.error(`Category ${cat} has ${count} providers; expected at least one verified provider`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`Integration catalog verification failed (${failed} issue(s))`);
  process.exit(1);
}

console.log(`Integration catalog OK (${INTEGRATION_PROVIDERS.length} active, ${INTEGRATION_CATALOG.length} total, ${stats.candidate} candidates)`);
