import type {
  ProviderPlan,
  ProviderRoute,
  ProviderTransport,
} from '@agentx/shared';
import { makeRoute, openAIProtocol, anthropicProtocol } from './routes/Route.js';
import { OpenAITransport } from './transports/OpenAITransport.js';
import { AnthropicTransport } from './transports/AnthropicTransport.js';
import { GenericTransport } from './transports/GenericTransport.js';
import { AuthProfileManager } from './AuthProfileManager.js';

export class ProviderRouter {
  private routes = new Map<string, ProviderRoute>();
  private transports = new Map<string, ProviderTransport>();
  private genericTransport: GenericTransport;

  constructor(private authProfiles: AuthProfileManager) {
    const genericRoute = makeRoute({
      id: 'openai-compatible',
      provider: 'generic',
      protocol: openAIProtocol(),
      endpoint: {
        baseUrl: 'https://api.openai.com/v1',
        path: '/chat/completions',
      },
      auth: {
        type: 'bearer' as const,
        getHeaders: () =>
          Promise.resolve({ Authorization: 'Bearer ' }),
      },
      framing: 'sse',
    });

    this.genericTransport = new GenericTransport(genericRoute);
    this.routes.set(genericRoute.id, genericRoute);
    this.transports.set(genericRoute.id, this.genericTransport);
  }

  registerRoute(route: ProviderRoute, transport: ProviderTransport): void {
    this.routes.set(route.id, route);
    this.transports.set(route.id, transport);
  }

  registerOpenAIRoute(
    baseUrl: string,
    providerName: string,
    routeId: string,
  ): void {
    const authManager = this.authProfiles;

    const route = makeRoute({
      id: routeId,
      provider: providerName,
      protocol: openAIProtocol(),
      endpoint: {
        baseUrl,
        path: '/chat/completions',
      },
      auth: {
        type: 'api-key' as const,
        getHeaders: async () => {
          const cred = await authManager.getCredential(providerName);
          return { Authorization: `Bearer ${cred}` };
        },
      },
      framing: 'sse',
    });

    this.registerRoute(route, new OpenAITransport(route));
  }

  registerAnthropicRoute(baseUrl: string): void {
    const routeId = 'anthropic-messages';
    const authManager = this.authProfiles;

    const route = makeRoute({
      id: routeId,
      provider: 'anthropic',
      protocol: anthropicProtocol(),
      endpoint: {
        baseUrl,
        path: '/messages',
      },
      auth: {
        type: 'api-key' as const,
        getHeaders: async () => {
          const cred = await authManager.getCredential('anthropic');
          return {
            'x-api-key': cred,
            'anthropic-version': '2023-06-01',
          };
        },
      },
      framing: 'sse',
    });

    this.registerRoute(route, new AnthropicTransport(route));
  }

  route(plan: ProviderPlan): ProviderTransport {
    if (plan.route) {
      const transport = this.transports.get(plan.route);
      if (transport && transport.canHandle(plan)) {
        return transport;
      }
    }

    const providerRouteId = `${plan.providerId}-chat`;
    const providerTransport = this.transports.get(providerRouteId);
    if (providerTransport && providerTransport.canHandle(plan)) {
      return providerTransport;
    }

    if (this.genericTransport.canHandle(plan)) {
      const genericRoute = this.routes.get('openai-compatible');
      if (genericRoute && plan.providerId) {
        this.updateGenericRoute(plan);
      }
      return this.genericTransport;
    }

    throw new Error(
      `NO_TRANSPORT: No transport found for provider "${plan.providerId}" ` +
        `route "${plan.route || 'auto'}"`,
    );
  }

  listRoutes(): ProviderRoute[] {
    return Array.from(this.routes.values());
  }

  getRoute(id: string): ProviderRoute | undefined {
    return this.routes.get(id);
  }

  private updateGenericRoute(plan: ProviderPlan): void {
    const genericRoute = this.routes.get('openai-compatible');
    if (!genericRoute) return;

    const baseUrlMap: Record<string, string> = {
      'openai': 'https://api.openai.com/v1',
      'anthropic': 'https://api.anthropic.com',
      'deepseek': 'https://api.deepseek.com/v1',
      'groq': 'https://api.groq.com/openai/v1',
      'mistral': 'https://api.mistral.ai/v1',
      'together': 'https://api.together.xyz/v1',
      'xai': 'https://api.x.ai/v1',
      'fireworks': 'https://api.fireworks.ai/inference/v1',
      'perplexity': 'https://api.perplexity.ai',
      'cohere': 'https://api.cohere.ai/compatibility/v1',
      'moonshot': 'https://api.moonshot.ai/v1',
      'azure': 'https://YOUR_RESOURCE.openai.azure.com',
      'commandcode': 'https://api.commandcode.ai/provider/v1',
      'opencode': 'https://opencode.ai/zen/go/v1',
      'opencode-zen': 'https://opencode.ai/zen/v1',
    };

    const baseUrl = baseUrlMap[plan.providerId] ?? 'https://api.openai.com/v1';
    genericRoute.endpoint = (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/') as any;
  }
}
