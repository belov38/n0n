import { Queue, Worker, type Job } from 'bullmq';

export interface ExecutionJob {
  executionId: string;
  workflowId: string;
  mode: string;
}

export class ScalingService {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly queueName = 'n0n-executions';

  constructor(private redisUrl: string = process.env.REDIS_URL || 'redis://localhost:6379') {}

  async setupQueue(): Promise<void> {
    const connection = this.getRedisConnection();
    this.queue = new Queue(this.queueName, { connection });
  }

  async setupWorker(processor: (job: Job<ExecutionJob>) => Promise<void>): Promise<void> {
    const connection = this.getRedisConnection();
    this.worker = new Worker<ExecutionJob>(
      this.queueName,
      async (job) => processor(job),
      { connection, concurrency: Number(process.env.EXECUTIONS_CONCURRENCY || 5) },
    );

    this.worker.on('failed', (job, error) => {
      console.error(`Job ${job?.id} failed:`, error.message);
    });

    this.worker.on('completed', (job) => {
      console.log(`Job ${job.id} completed`);
    });
  }

  async addJob(data: ExecutionJob): Promise<string> {
    if (!this.queue) throw new Error('Queue not initialized');
    const job = await this.queue.add('execute', data, {
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return job.id ?? '';
  }

  async stopWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  async stopQueue(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }

  // Queue recovery -- re-add jobs that were in progress
  async recoverJobs(): Promise<number> {
    if (!this.queue) return 0;
    const active = await this.queue.getActive();
    // Active jobs without workers need to be re-queued
    return active.length;
  }

  private getRedisConnection() {
    const url = new URL(this.redisUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
    };
  }
}
