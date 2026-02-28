import {
  db,
  ExecutionRepo,
  ExecutionDataRepo,
  ExecutionMetadataRepo,
  WorkflowRepo,
  WorkflowStatisticsRepo,
  CredentialRepo,
  VariableRepo,
} from '@n0n/db';
import { ScalingService, JobProcessor } from '@n0n/queue';
import { LeaderElection } from '@n0n/scaling';
import { loadAllNodes } from '@n0n/nodes';
import {
  ExecutionPersistence,
  ActiveExecutions,
  getPushService,
  getLifecycleHooksForScalingWorker,
  InstanceSettings,
  Cipher,
  CredentialsHelper,
  createNodeExecutor,
  buildAdditionalData,
} from '@n0n/server';
import { WorkflowExecute } from '@n0n/engine';
import { Workflow, createRunExecutionData } from 'n8n-workflow';
import type { IRunExecutionData, INode, IConnections, IWorkflowSettings, IDataObject } from 'n8n-workflow';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

async function main() {
  console.log('Starting n0n worker...');

  // Initialize repositories
  const executionRepo = new ExecutionRepo(db);
  const executionDataRepo = new ExecutionDataRepo(db);
  const executionMetadataRepo = new ExecutionMetadataRepo(db);
  const workflowRepo = new WorkflowRepo(db);
  const workflowStatisticsRepo = new WorkflowStatisticsRepo(db);
  const credentialRepo = new CredentialRepo(db);
  const variableRepo = new VariableRepo(db);

  // Load node types
  const { nodeTypes, credentialTypes } = loadAllNodes();

  // Build encryption + credentials infrastructure
  const instanceSettings = new InstanceSettings();
  const cipher = new Cipher(instanceSettings);
  const credentialsHelper = new CredentialsHelper(credentialRepo, cipher, credentialTypes);

  // Build execution infrastructure
  const persistence = new ExecutionPersistence(executionRepo, executionDataRepo, executionMetadataRepo);
  const activeExecutions = new ActiveExecutions();
  const pushService = getPushService();

  // Build IWorkflowExecuteAdditionalData and NodeExecutor via server factories
  const additionalData = buildAdditionalData({
    credentialsHelper,
    variableRepo,
    pushService,
  });
  const nodeExecutor = createNodeExecutor(additionalData);

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
      const workflowData = await workflowRepo.findById(workflowId);
      if (!workflowData) throw new Error(`Workflow ${workflowId} not found`);

      const workflow = new Workflow({
        id: workflowData.id,
        name: workflowData.name,
        nodes: workflowData.nodes as INode[],
        connections: workflowData.connections as IConnections,
        active: workflowData.active,
        nodeTypes,
        staticData: workflowData.staticData as IDataObject,
        settings: workflowData.settings as IWorkflowSettings,
      });

      const execDataRecord = await executionDataRepo.findByExecutionId(Number(executionId));
      const runExecutionData: IRunExecutionData = execDataRecord
        ? (JSON.parse(execDataRecord.data) as IRunExecutionData)
        : createRunExecutionData();

      const hooks = getLifecycleHooksForScalingWorker(
        executionId,
        workflowId,
        'integrated',
        {
          persistence,
          statisticsRepo: workflowStatisticsRepo,
          pushService,
          activeExecutions,
        },
        { saveProgress: true },
      );

      // Set the executionId on the shared additionalData for this execution
      additionalData.executionId = executionId;

      const executor = new WorkflowExecute(
        { executionId },
        'integrated',
        nodeExecutor,
        runExecutionData,
        hooks,
      );

      activeExecutions.add({
        id: executionId,
        workflowId,
        mode: 'integrated',
        startedAt: new Date(),
        status: 'running',
        cancel: () => executor.cancel(),
      });

      await executor.runFrom(workflow);
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
