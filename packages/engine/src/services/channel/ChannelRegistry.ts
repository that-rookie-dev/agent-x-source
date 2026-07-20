import type { ChannelId } from './IChannelService.js';
import type { IChannelBridge } from './IChannelBridge.js';

export class ChannelRegistry {
  private readonly bridges = new Map<ChannelId, IChannelBridge>();

  register(channelId: ChannelId, bridge: IChannelBridge): void {
    this.bridges.set(channelId, bridge);
  }

  get(channelId: ChannelId): IChannelBridge | undefined {
    return this.bridges.get(channelId);
  }

  unregister(channelId: ChannelId): void {
    this.bridges.delete(channelId);
  }

  list(): Array<{ channelId: ChannelId; bridge: IChannelBridge }> {
    return Array.from(this.bridges.entries()).map(([channelId, bridge]) => ({ channelId, bridge }));
  }

  clear(): void {
    this.bridges.clear();
  }
}
