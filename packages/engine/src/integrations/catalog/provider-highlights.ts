import type { IntegrationProvider } from '@agentx/shared';

/** Human-readable capability bullets shown in the MCP Store detail modal. */
const HIGHLIGHTS: Record<string, string[]> = {
  github: ['Browse repos and code', 'Issues and pull requests', 'Search code'],
  notion: ['Search workspace pages', 'Read and update databases', 'Create pages'],
  linear: ['Issues and projects', 'Team workflows', 'Create and update tickets'],
  slack: ['Read channels', 'Search messages', 'Send messages (confirmed)'],
  'brave-search': ['Live web search', 'Current events and facts'],
  postgres: ['Run read-only SQL', 'Inspect schemas and tables'],
  fetch: ['Fetch public URLs', 'Extract page text'],
  filesystem: ['Read files in allowed folder', 'Write files (confirmed)'],
  custom: ['Any MCP server by URL or command', 'Full stdio and remote support'],
  discord: ['Read server channels', 'Send messages (confirmed)'],
  'google-drive': ['Search Drive files', 'Read and upload files'],
  'google-maps': ['Places search', 'Directions and routes', 'Travel time estimates'],
  redis: ['Inspect keys', 'Read-only Redis commands'],
  sqlite: ['Query local SQLite databases'],
  sentry: ['Issues and stack traces', 'Project health', 'Event search'],
  puppeteer: ['Browse pages', 'Screenshots and scraping (confirmed)'],
  memory: ['Persistent agent memory graph', 'Store and recall facts'],
  'home-assistant': ['Device state', 'Control lights and switches (confirmed)', 'Automations'],
  stripe: ['Customers and payments', 'Invoices', 'Charges (confirmed)'],
  paypal: ['Account activity', 'Payments (confirmed)'],
  shopify: ['Products and inventory', 'Orders', 'Fulfillment (confirmed)'],
  supabase: ['Projects and tables', 'SQL queries (read-only recommended)'],
  atlassian: ['Jira issues and sprints', 'Confluence pages'],
  monday: ['Boards and items', 'Status updates'],
  clickup: ['Tasks and lists', 'Spaces'],
  trello: ['Boards and cards', 'Checklists'],
  obsidian: ['Search vault notes', 'Read note content'],
  telegram: ['Read chats', 'Send messages (confirmed)'],
  gmail: ['Read inbox', 'Draft messages'],
  twilio: ['Send SMS', 'Voice call metadata'],
  zoom: ['Meetings list', 'Schedule meetings'],
  zendesk: ['Tickets', 'Help center articles'],
  whatsapp: ['Business messages (confirmed)', 'Template sends'],
  '1stay': ['Search 300K+ hotels', 'Real bookings with checkout handoff'],
  travelcode: ['Flights and hotels', 'Orders and flight status'],
  'booking-com': ['Search hotels by destination and dates', 'Check availability and prices', 'Sign in from MCP Store after connecting'],
  quickbooks: ['Invoices and expenses', 'Accounting reports'],
  xero: ['Invoices and contacts', 'Bank reconciliation'],
  coinbase: ['Portfolio balances', 'Market prices', 'Trades (confirmed)'],
  'yahoo-finance': ['Stock quotes', 'Historical prices', 'Market news'],
  'alpha-vantage': ['Forex and crypto', 'Technical indicators'],
  amazon: ['Seller catalog', 'Orders (SP-API)'],
  ebay: ['Listings', 'Order management'],
  woocommerce: ['Store products', 'Orders'],
  walmart: ['Marketplace listings', 'Orders'],
  target: ['Product search', 'Availability'],
  mqtt: ['Publish and subscribe IoT topics'],
};

export function getProviderHighlights(provider: IntegrationProvider): string[] {
  if (provider.highlights?.length) return provider.highlights;
  const mapped = HIGHLIGHTS[provider.id];
  if (mapped?.length) return mapped;
  const caps: string[] = [];
  if (provider.capabilities.search) caps.push('Search');
  if (provider.capabilities.read) caps.push('Read data');
  if (provider.capabilities.write) caps.push('Create and update (confirmed in chat)');
  if (provider.capabilities.transact) caps.push('Payments and bookings (confirmed in chat)');
  return caps.length > 0 ? caps : ['Connect to see available tools'];
}

export function withProviderHighlights(provider: IntegrationProvider): IntegrationProvider {
  return {
    ...provider,
    highlights: getProviderHighlights(provider),
  };
}
