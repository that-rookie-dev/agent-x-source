/**
 * MCP Integrations Hub — per-provider connect wizard metadata (MCP Store only).
 * Unrelated to first-run app setup in web-ui `pages/SetupWizard.tsx`.
 */
import type {
  ConnectGuideStep,
  IntegrationCategory,
  IntegrationProvider,
  ProviderSetupWizardSpec,
  SetupPreflightCheckId,
  SetupWizardTemplate,
} from '@agentx/shared';

const LIFESTYLE_CATEGORIES = new Set<IntegrationCategory>([
  'travel',
  'productivity',
  'communication',
  'finance',
  'shopping',
  'smart_home',
]);

function inferTemplate(provider: IntegrationProvider): SetupWizardTemplate {
  if (provider.id === 'custom') return 'custom';
  if (provider.auth.packageSignIn) return 'package_sign_in';
  if (provider.auth.primary === 'oauth' || provider.auth.primary === 'sign_in_browser') {
    return provider.server.type === 'remote' ? 'oauth_remote' : 'oauth_remote';
  }
  if (provider.id === 'filesystem') return 'folder_sandbox';
  if (provider.auth.primary === 'remote_url') return 'remote_url';
  if (provider.auth.primary === 'none' && provider.server.type === 'stdio') return 'stdio_none';
  if (provider.auth.fields?.some((f) => /DATABASE|REDIS|URL|CONNECTION/i.test(f.key))) {
    return 'connection_string';
  }
  return 'api_key';
}

function inferPreflight(provider: IntegrationProvider, template: SetupWizardTemplate): SetupPreflightCheckId[] {
  const checks: SetupPreflightCheckId[] = ['network_reachable', 'mcp_handshake'];
  if (provider.server.type === 'stdio' || template === 'stdio_none' || template === 'api_key' || template === 'connection_string' || template === 'folder_sandbox' || template === 'package_sign_in') {
    checks.unshift('npx_available', 'node_available');
  }
  if (provider.auth.oauth?.clientIdEnv) {
    checks.push('oauth_env_configured');
  }
  if (template === 'oauth_remote' && provider.server.type === 'remote') {
    checks.push('oauth_client_configured');
  }
  if (template === 'folder_sandbox') {
    checks.push('folder_readable', 'folder_writable');
  }
  if (provider.id === 'obsidian' || provider.id === 'home-assistant') {
    checks.push('local_port_reachable');
  }
  return [...new Set(checks)];
}

/** Checks that require credentials — run after the credentials step, before test. */
export function inferCredentialPreflight(provider: IntegrationProvider): SetupPreflightCheckId[] {
  if (provider.id === 'postgres') return ['postgres_reachable'];
  if (provider.id === 'redis') return ['redis_reachable'];
  if (provider.id === 'sqlite') return ['folder_readable'];
  return [];
}

function inferOsPermissions(provider: IntegrationProvider, template: SetupWizardTemplate): ProviderSetupWizardSpec['osPermissions'] {
  if (template === 'folder_sandbox' || provider.id === 'filesystem') return ['folder_access'];
  if (provider.id === 'home-assistant' || provider.id === 'mqtt') return ['local_network'];
  return undefined;
}

interface ProviderSetupCopy {
  highlights?: string[];
  connectGuide?: ConnectGuideStep[];
}

/**
 * Non-developer setup copy per provider: what it does (highlights) and how to get
 * credentials (connectGuide with deep links). Merged in only where the catalog does
 * not already define its own, so hand-authored catalog copy always wins.
 */
const PROVIDER_SETUP_COPY: Record<string, ProviderSetupCopy> = {
  fetch: {
    highlights: [
      'Read any public web page and return clean, readable text',
      'No account or API key needed — runs locally on your machine',
      'Great for summarising articles, docs, and reference pages',
    ],
    connectGuide: [
      { title: 'Nothing to configure', body: 'Fetch runs a local MCP server via npx. Just click Continue and test the connection.' },
    ],
  },
  notion: {
    highlights: [
      'Search, read, and update your Notion pages and databases',
      'Sign in securely with your Notion account — no tokens to copy',
      'Turn meeting notes and tasks into actions from chat',
    ],
    connectGuide: [
      { title: 'Sign in with Notion', body: 'A browser window opens for you to authorise Agent-X. Approve access to continue.' },
      { title: 'Share your pages', body: 'After signing in, open Notion and share the pages or databases you want Agent-X to use (••• → Connections → Agent-X).', link: 'https://www.notion.so' },
    ],
  },
  linear: {
    highlights: [
      'Create, search, and update Linear issues from chat',
      'Sign in with your Linear workspace — no API key needed',
      'Track sprint progress and triage bugs hands-free',
    ],
    connectGuide: [
      { title: 'Sign in with Linear', body: 'Authorise Agent-X in the browser window. Choose the workspace you want to connect.' },
    ],
  },
  slack: {
    highlights: [
      'Read channels, search messages, and post updates',
      'Summarise long threads and catch up in seconds',
      'Send reminders and notifications from your agent',
    ],
    connectGuide: [
      { title: 'Create a Slack app', body: 'Go to the Slack API dashboard, create an app, and add a Bot Token (starts with xoxb-).', link: 'https://api.slack.com/apps' },
      { title: 'Add scopes', body: 'Under OAuth & Permissions add channels:read, chat:write, and search:read, then install to your workspace.' },
      { title: 'Paste the token', body: 'Copy the Bot User OAuth Token and paste it below.' },
    ],
  },
  github: {
    highlights: [
      'Search repos, read issues and PRs, and manage code',
      'Review pull requests and open issues from chat',
      'Works with a fine-grained personal access token',
    ],
    connectGuide: [
      { title: 'Create a token', body: 'Open GitHub → Settings → Developer settings → Fine-grained tokens and generate a new token.', link: 'https://github.com/settings/tokens?type=beta' },
      { title: 'Pick scopes', body: 'Grant read access to repositories (and write if you want Agent-X to open issues/PRs).' },
      { title: 'Paste the token', body: 'Copy the token (starts with github_pat_) and paste it below.' },
    ],
  },
  'brave-search': {
    highlights: [
      'Private web search that respects your privacy',
      'Fresh results for research and fact-checking',
      'Free tier available from the Brave dashboard',
    ],
    connectGuide: [
      { title: 'Get an API key', body: 'Sign up for the Brave Search API and create a key from the dashboard.', link: 'https://brave.com/search/api/' },
      { title: 'Paste the key', body: 'Copy your subscription key and paste it below.' },
    ],
  },
  filesystem: {
    highlights: [
      'Let your agent read and write files in one folder you choose',
      'Access is sandboxed to the folder you pick — nothing else',
      'Great for organising documents and drafting files locally',
    ],
    connectGuide: [
      { title: 'Choose a folder', body: 'Pick the single folder Agent-X may read and write. You can change it later by reconnecting.' },
    ],
  },
  trello: {
    highlights: [
      'Create cards, move them across lists, and track boards',
      'Turn chat requests into Trello tasks instantly',
    ],
    connectGuide: [
      { title: 'Get your API key', body: 'Open the Trello power-up admin page and copy your API key.', link: 'https://trello.com/power-ups/admin' },
      { title: 'Generate a token', body: 'Click the token link next to your key to authorise access, then copy the token.' },
    ],
  },
  monday: {
    highlights: [
      'Manage boards, items, and updates in monday.com',
      'Automate status changes and follow-ups from chat',
    ],
    connectGuide: [
      { title: 'Get an API token', body: 'In monday.com open your avatar → Developers → My access tokens and copy a token.', link: 'https://monday.com' },
    ],
  },
  clickup: {
    highlights: ['Create and track ClickUp tasks from chat', 'Manage lists, spaces, and due dates hands-free'],
    connectGuide: [
      { title: 'Get an API token', body: 'ClickUp → Settings → Apps → Generate to create a personal API token.', link: 'https://app.clickup.com' },
    ],
  },
  discord: {
    highlights: ['Read and post messages in your Discord servers', 'Summarise channels and send announcements'],
    connectGuide: [
      { title: 'Create a bot', body: 'In the Discord Developer Portal create an application and add a Bot, then copy its token.', link: 'https://discord.com/developers/applications' },
      { title: 'Invite the bot', body: 'Use the OAuth2 URL generator to invite the bot to your server with message permissions.' },
    ],
  },
  telegram: {
    highlights: ['Send and receive Telegram messages', 'Push notifications and updates to a chat'],
    connectGuide: [
      { title: 'Talk to BotFather', body: 'Message @BotFather on Telegram, run /newbot, and follow the prompts to get a bot token.', link: 'https://t.me/BotFather' },
      { title: 'Paste the token', body: 'Copy the token BotFather gives you and paste it below.' },
    ],
  },
  'google-maps': {
    highlights: ['Places, directions, and travel search', 'Plan trips and find nearby options'],
    connectGuide: [
      { title: 'Enable the API', body: 'In Google Cloud Console enable the Maps/Places APIs for a project.', link: 'https://console.cloud.google.com/google/maps-apis' },
      { title: 'Create an API key', body: 'Create an API key under Credentials and paste it below.' },
    ],
  },
  'google-drive': {
    highlights: ['Search and read your Google Drive files', 'Pull docs and sheets into your workflow'],
    connectGuide: [
      { title: 'Create an OAuth client', body: 'In Google Cloud Console create an OAuth client (Web application) and paste the Client ID into this wizard when asked.', link: 'https://console.cloud.google.com/apis/credentials' },
      { title: 'Sign in with Google', body: 'Authorise Agent-X in the browser window to grant read access to your Drive.' },
    ],
  },
  stripe: {
    highlights: ['View customers, payments, and billing data', 'Answer revenue questions from chat'],
    connectGuide: [
      { title: 'Create a restricted key', body: 'In Stripe → Developers → API keys, create a restricted key with read scopes.', link: 'https://dashboard.stripe.com/apikeys' },
      { title: 'Paste the key', body: 'Use a test key (sk_test_) first to try it safely.' },
    ],
  },
  paypal: {
    highlights: ['Check balances, transactions, and invoices', 'Sandbox mode available for safe testing'],
    connectGuide: [
      { title: 'Create app credentials', body: 'In the PayPal Developer dashboard create an app and copy the client ID/secret.', link: 'https://developer.paypal.com/dashboard/' },
    ],
  },
  'yahoo-finance': {
    highlights: ['Live quotes, charts, and market data', 'No account required — easiest finance setup'],
    connectGuide: [
      { title: 'Nothing to configure', body: 'Runs locally via npx. Click Continue and test the connection.' },
    ],
  },
  'home-assistant': {
    highlights: ['Control lights, switches, and scenes', 'Monitor sensors across your smart home'],
    connectGuide: [
      { title: 'Instance URL', body: 'Enter your Home Assistant MCP endpoint, e.g. https://your-home.example.com/mcp.' },
      { title: 'Long-lived token', body: 'In Home Assistant → Profile → Long-lived access tokens, create one and paste it below.' },
    ],
  },
  postgres: {
    highlights: ['Run read-only queries against your database', 'Explore schemas and answer data questions'],
    connectGuide: [
      { title: 'Connection string', body: 'Provide a read-only connection URL, e.g. postgres://user:pass@host:5432/db.' },
    ],
  },
  redis: {
    highlights: ['Inspect keys and run read-only Redis commands', 'Debug caches and queues from chat'],
    connectGuide: [
      { title: 'Redis URL', body: 'Provide your Redis connection URL, e.g. redis://localhost:6379.' },
    ],
  },
  sqlite: {
    highlights: ['Query local SQLite databases', 'Explore tables without writing SQL by hand'],
    connectGuide: [
      { title: 'Database file', body: 'Provide the path to your .db/.sqlite file. Choose a file you trust.' },
    ],
  },
  'booking-com': {
    highlights: ['Search stays and check availability', 'Browser sign-in handled inside setup'],
    connectGuide: [
      { title: 'Browser sign-in', body: 'After the connection test, a login window opens so you can sign in to Booking.com.' },
    ],
  },
  '1stay': {
    highlights: ['Find and book stays via 1Stay', 'Sign in securely — no tokens to copy'],
    connectGuide: [
      { title: 'Sign in', body: 'Authorise Agent-X in the browser window to connect your 1Stay account.' },
    ],
  },
  puppeteer: {
    highlights: ['Automate a real browser for scraping and testing', 'Downloads a Chromium build on first run'],
    connectGuide: [
      { title: 'First-run download', body: 'The first connection downloads Chromium (~150MB). This is normal and only happens once.' },
    ],
  },
  memory: {
    highlights: ['Persistent knowledge-graph memory for your agent', 'No account required'],
    connectGuide: [
      { title: 'Nothing to configure', body: 'Runs locally via npx. Click Continue and test the connection.' },
    ],
  },
  sentry: {
    highlights: ['Search issues and events across Sentry projects', 'Triage production errors from chat'],
    connectGuide: [
      { title: 'Create an auth token', body: 'In Sentry → Settings → Auth Tokens, create a token with project read scope.', link: 'https://sentry.io/settings/account/api/auth-tokens/' },
      { title: 'Paste the token', body: 'Copy the token (starts with sntrys_) and paste it below.' },
    ],
  },
  supabase: {
    highlights: ['Query Supabase tables and run read-only SQL', 'Explore project data without opening the dashboard'],
    connectGuide: [
      { title: 'Get an access token', body: 'In Supabase → Account → Access Tokens, generate a personal token.', link: 'https://supabase.com/dashboard/account/tokens' },
      { title: 'Read-only recommended', body: 'Use a read-only token or enable read-only mode when connecting.' },
    ],
  },
  atlassian: {
    highlights: ['Search Jira issues and Confluence pages', 'Sign in with your Atlassian account'],
    connectGuide: [
      { title: 'Sign in with Atlassian', body: 'Authorise Agent-X in the browser window to access your Jira and Confluence workspace.' },
    ],
  },
  obsidian: {
    highlights: ['Search and read notes in your Obsidian vault', 'Requires the Obsidian MCP plugin running locally'],
    connectGuide: [
      { title: 'Install the plugin', body: 'Install the Obsidian MCP community plugin and start its local server.', link: 'https://obsidian.md' },
      { title: 'Local URL', body: 'Enter the plugin MCP endpoint URL (usually http://127.0.0.1:PORT/mcp).' },
    ],
  },
  gmail: {
    highlights: ['Read and draft Gmail messages', 'Manage inbox tasks from chat'],
    connectGuide: [
      { title: 'OAuth setup', body: 'This community package uses a local OAuth helper. Follow the package auth flow after connecting.', link: 'https://mail.google.com' },
    ],
  },
  twilio: {
    highlights: ['Send SMS and check Twilio account data', 'Automate notifications from your agent'],
    connectGuide: [
      { title: 'Get credentials', body: 'From Twilio Console copy your Account SID and Auth Token.', link: 'https://console.twilio.com' },
    ],
  },
  zoom: {
    highlights: ['List meetings and calendar events', 'Sign in with your Zoom account'],
    connectGuide: [
      { title: 'Sign in with Zoom', body: 'Authorise Agent-X in the browser window to access your Zoom workspace.' },
    ],
  },
  zendesk: {
    highlights: ['Search tickets and help-center content', 'Triage support requests from chat'],
    connectGuide: [
      { title: 'Create an API token', body: 'In Zendesk Admin → Apps and integrations → APIs → Zendesk API, enable token access and create a token.', link: 'https://www.zendesk.com' },
    ],
  },
  whatsapp: {
    highlights: ['Send WhatsApp Business messages', 'Requires Meta Business API setup'],
    connectGuide: [
      { title: 'Business API token', body: 'From Meta Business Suite create a WhatsApp Business app and copy the access token.', link: 'https://business.facebook.com' },
    ],
  },
  travelcode: {
    highlights: ['Search flights and hotels via TravelCode', 'OAuth auth required before connecting'],
    connectGuide: [
      { title: 'Authenticate locally', body: 'Run npx mcp-travelcode-auth auth in a terminal first, then connect here.', link: 'https://travel-code.com' },
    ],
  },
  quickbooks: {
    highlights: ['Invoices, expenses, and accounting data', 'Sign in with your Intuit account'],
    connectGuide: [
      { title: 'Sign in with QuickBooks', body: 'Authorise Agent-X in the browser window to access your QuickBooks company.' },
    ],
  },
  xero: {
    highlights: ['Accounting, invoices, and contacts', 'Sign in with your Xero organisation'],
    connectGuide: [
      { title: 'Sign in with Xero', body: 'Authorise Agent-X in the browser window to access your Xero data.' },
    ],
  },
  coinbase: {
    highlights: ['Coinbase Developer Platform wallets and trading', 'Use CDP API keys only'],
    connectGuide: [
      { title: 'Create CDP keys', body: 'In Coinbase Developer Platform create an API key and download the private key.', link: 'https://portal.cdp.coinbase.com' },
    ],
  },
  'alpha-vantage': {
    highlights: ['Market data, forex, and crypto quotes', 'Free tier available from Alpha Vantage'],
    connectGuide: [
      { title: 'Get an API key', body: 'Sign up at Alpha Vantage and copy your API key from the dashboard.', link: 'https://www.alphavantage.co/support/#api-key' },
    ],
  },
  shopify: {
    highlights: ['Products, orders, and store analytics', 'Works with your Shopify Admin API token'],
    connectGuide: [
      { title: 'Create an app token', body: 'In Shopify Admin → Settings → Apps → Develop apps, create an app and generate an Admin API access token.', link: 'https://admin.shopify.com' },
      { title: 'Store domain', body: 'Enter your store domain (e.g. your-store.myshopify.com) below.' },
    ],
  },
  amazon: {
    highlights: ['Seller catalog and orders via SP-API', 'Complex setup — use restricted credentials'],
    connectGuide: [
      { title: 'SP-API credentials', body: 'In Seller Central create SP-API credentials and copy the refresh token.', link: 'https://sellercentral.amazon.com' },
    ],
  },
  ebay: {
    highlights: ['Listings, orders, and inventory', 'Sign in with your eBay developer account'],
    connectGuide: [
      { title: 'Sign in with eBay', body: 'Authorise Agent-X in the browser window to access your eBay seller account.' },
    ],
  },
  woocommerce: {
    highlights: ['Products and orders from your WooCommerce store', 'Uses REST API keys from your site'],
    connectGuide: [
      { title: 'Generate REST keys', body: 'In WordPress → WooCommerce → Settings → Advanced → REST API, create read keys.', link: 'https://woocommerce.com' },
      { title: 'Site URL', body: 'Enter your store URL if required by the MCP package.' },
    ],
  },
  walmart: {
    highlights: ['Walmart Marketplace items and orders', 'Requires Marketplace API credentials'],
    connectGuide: [
      { title: 'Marketplace credentials', body: 'From Walmart Seller Center copy your Client ID and secret.', link: 'https://marketplace.walmart.com' },
    ],
  },
  target: {
    highlights: ['Target product search and cart helpers', 'No API key required — runs locally'],
    connectGuide: [
      { title: 'Nothing to configure', body: 'Runs locally via npx. Browser sign-in may be required after connecting.' },
    ],
  },
  mqtt: {
    highlights: ['Publish and subscribe to MQTT topics', 'Connect to your IoT broker'],
    connectGuide: [
      { title: 'Broker URL', body: 'Enter your MQTT broker URL, e.g. mqtt://localhost:1883 or mqtts://broker.example.com:8883.' },
    ],
  },
};

/** Attach or infer per-provider setup wizard metadata for the MCP Store. */
export function enrichProviderSetupWizard(provider: IntegrationProvider): IntegrationProvider {
  const copy = PROVIDER_SETUP_COPY[provider.id];
  const highlights = provider.highlights?.length ? provider.highlights : copy?.highlights;
  const connectGuide = provider.auth.connectGuide?.length ? provider.auth.connectGuide : copy?.connectGuide;

  const withCopy: IntegrationProvider = (highlights !== provider.highlights || connectGuide !== provider.auth.connectGuide)
    ? {
        ...provider,
        highlights,
        auth: { ...provider.auth, connectGuide },
      }
    : provider;

  if (withCopy.setupWizard) return withCopy;

  const template = inferTemplate(withCopy);
  const preflight = inferPreflight(withCopy, template);
  const hideDeveloperTab = LIFESTYLE_CATEGORIES.has(withCopy.category) || withCopy.category !== 'dev_ops';
  return {
    ...withCopy,
    setupWizard: {
      template,
      preflight,
      osPermissions: inferOsPermissions(withCopy, template),
      hideDeveloperTab,
    },
  };
}

export function enrichCatalogProviders(providers: IntegrationProvider[]): IntegrationProvider[] {
  return providers.map(enrichProviderSetupWizard);
}
