import Redis from 'ioredis';

export class LeaderElection {
  private redis: Redis;
  private isLeader = false;
  private intervalId?: ReturnType<typeof setInterval>;
  private readonly KEY = 'n0n:leader';
  private readonly TTL = 10; // seconds
  private readonly RENEWAL_INTERVAL = 5000; // ms
  private readonly instanceId: string;

  constructor(redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379') {
    this.redis = new Redis(redisUrl);
    this.instanceId = `${process.pid}-${Date.now()}`;
  }

  async start(): Promise<void> {
    await this.tryAcquire();
    this.intervalId = setInterval(() => this.tryAcquire(), this.RENEWAL_INTERVAL);
  }

  async stop(): Promise<void> {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.isLeader) {
      await this.release();
    }
    await this.redis.quit();
  }

  getIsLeader(): boolean {
    return this.isLeader;
  }

  private async tryAcquire(): Promise<void> {
    if (this.isLeader) {
      // Renew the TTL
      const result = await this.redis.set(this.KEY, this.instanceId, 'EX', this.TTL, 'XX');
      if (result !== 'OK') {
        // Lost leadership
        this.isLeader = false;
      }
      return;
    }

    // Try to acquire
    const result = await this.redis.set(this.KEY, this.instanceId, 'EX', this.TTL, 'NX');
    if (result === 'OK') {
      this.isLeader = true;
      console.log(`Instance ${this.instanceId} elected as leader`);
    }
  }

  private async release(): Promise<void> {
    // Only release if we're the current leader
    const currentLeader = await this.redis.get(this.KEY);
    if (currentLeader === this.instanceId) {
      await this.redis.del(this.KEY);
    }
    this.isLeader = false;
  }
}
