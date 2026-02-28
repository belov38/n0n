import Redis from 'ioredis';

export class Publisher {
  private redis: Redis;
  private readonly channel: string;

  constructor(
    redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379',
    channel = 'n0n:events',
  ) {
    this.redis = new Redis(redisUrl);
    this.channel = channel;
  }

  async publish(event: string, data: Record<string, unknown>): Promise<void> {
    await this.redis.publish(this.channel, JSON.stringify({ event, data, timestamp: Date.now() }));
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}
