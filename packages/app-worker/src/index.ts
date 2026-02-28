import { db, ExecutionRepo, ExecutionDataRepo, WorkflowRepo } from '@n0n/db';
import { ScalingService, JobProcessor } from '@n0n/queue';
import { LeaderElection } from '@n0n/scaling';
import { loadAllNodes } from '@n0n/nodes';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function main() {
  console.log('Starting n0n worker...');

  // Initialize repositories
  const executionRepo = new ExecutionRepo(db);
  const executionDataRepo = new ExecutionDataRepo(db);
  const workflowRepo = new WorkflowRepo(db);

  // Load node types
  // Will be used when execution engine integration is wired up
  const nodeRegistry = loadAllNodes();

  // Initialize scaling service (BullMQ)
  const scalingService = new ScalingService(REDIS_URL);
  await scalingService.setupQueue();

  // Initialize leader election
  const leaderElection = new LeaderElection(REDIS_URL);
  await leaderElection.start();

  // Create job processor
  const jobProcessor = new JobProcessor({
    loadExecution: async (executionId: string) => {
      const execution = await executionRepo.findById(Number(executionId));
      if (!execution) return null;
      const data = await executionDataRepo.findByExecutionId(Number(executionId));
      return {
        workflowId: execution.workflowId,
        data: data ? JSON.parse(data.data) : null,
      };
    },

    runExecution: async (executionId: string, workflowId: string) => {
      const workflow = await workflowRepo.findById(workflowId);
      if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

      // TODO: Create WorkflowExecute instance and run
      console.log(`Running execution ${executionId} for workflow ${workflowId}`);
    },

    reportResult: async (executionId: string, status: 'success' | 'error', error?: string) => {
      await executionRepo.markAsFinished(
        Number(executionId),
        status === 'success' ? 'success' : 'error',
      );
      if (error) {
        console.error(`Execution ${executionId} failed:`, error);
      }
    },
  });

  // Setup worker to process jobs
  await scalingService.setupWorker(async (job) => {
    await jobProcessor.process(job);
  });

  console.log('n0n worker running, waiting for jobs...');

  // Health check HTTP endpoint
  Bun.serve({
    port: Number(process.env.WORKER_PORT || 5681),
    fetch() {
      return new Response(
        JSON.stringify({
          status: 'ok',
          isLeader: leaderElection.getIsLeader(),
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  });

  console.log(`Worker health check on port ${process.env.WORKER_PORT || 5681}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down worker...');
    await scalingService.stopWorker();
    await scalingService.stopQueue();
    await leaderElection.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('Failed to start n0n worker:', error);
  process.exit(1);
});
