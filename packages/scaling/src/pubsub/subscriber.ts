import Redis from 'ioredis';

export type EventHandler = (event: string, data: Record<string, unknown>) => void;

export class Subscriber {
  private redis: Redis;
  private handlers: Map<string, EventHandler[]> = new Map();
  private readonly channel: string;

  constructor(
    redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379',
    channel = 'n0n:events',
  ) {
    this.redis = new Redis(redisUrl);
    this.channel = channel;
  }

  async start(): Promise<void> {
    await this.redis.subscribe(this.channel);
    this.redis.on('message', (_channel: string, message: string) => {
      try {
        const { event, data } = JSON.parse(message) as { event: string; data: Record<string, unknown> };
        const handlers = this.handlers.get(event) || [];
        for (const handler of handlers) {
          handler(event, data);
        }
      } catch (error) {
        console.error('Error processing pub/sub message:', error);
      }
    });
  }

  on(event: string, handler: EventHandler): void {
    const existing = this.handlers.get(event) || [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  async close(): Promise<void> {
    await this.redis.unsubscribe();
    await this.redis.quit();
  }
}
