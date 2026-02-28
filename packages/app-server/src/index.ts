import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import {
	db,
	WorkflowRepo,
	ExecutionRepo,
	ExecutionDataRepo,
	ExecutionMetadataRepo,
	CredentialRepo,
	WebhookRepo,
	TagRepo,
	WorkflowHistoryRepo,
	WorkflowStatisticsRepo,
	VariableRepo,
	SettingsRepo,
	FolderRepo,
} from '@n0n/db';
import { loadAllNodes } from '@n0n/nodes';
import type { NodeExecutor } from '@n0n/engine';
import { ActiveWorkflows, ScheduledTaskManager, TriggersAndPollers } from '@n0n/engine';
import {
	// Route creators
	createWorkflowRoutes,
	createExecutionRoutes,
	createCredentialRoutes,
	createTagRoutes,
	createFolderRoutes,
	createVariableRoutes,
	createSettingsRoutes,
	createNodeTypesRoutes,
	createImportExportRoutes,
	createWebhookRoutes,
	createOAuthRoutes,
	healthRoutes,
	registerHealthDependency,
	pushRoutes,
	// Services
	WorkflowService,
	ExecutionService,
	CredentialService,
	TagService,
	FolderService,
	VariableService,
	SettingsService,
	ActiveExecutions,
	ExecutionPersistence,
	ExecutionPruningService,
	WorkflowRunner,
	getLifecycleHooksForRegularMain,
	// Encryption
	InstanceSettings,
	Cipher,
	// Node execution
	createNodeExecutor,
	buildAdditionalData,
	CredentialsHelper,
	// Binary data
	BinaryDataService,
	// Webhooks
	WebhookRequestHandler,
	LiveWebhooks,
	TestWebhooks,
	WaitingWebhooks,
	WebhookService,
	// Active workflows
	ActiveWorkflowManager,
	// Push
	getPushService,
} from '@n0n/server';

const PORT = Number(process.env.PORT || 5678);
const QUEUE_MODE = process.env.QUEUE_MODE === 'true';

async function main() {
	console.log('Starting n0n server...');

	// ── 1. Repositories ──────────────────────────────────────────────
	const workflowRepo = new WorkflowRepo(db);
	const executionRepo = new ExecutionRepo(db);
	const executionDataRepo = new ExecutionDataRepo(db);
	const executionMetadataRepo = new ExecutionMetadataRepo(db);
	const credentialRepo = new CredentialRepo(db);
	const webhookRepo = new WebhookRepo(db);
	const tagRepo = new TagRepo(db);
	const historyRepo = new WorkflowHistoryRepo(db);
	const statisticsRepo = new WorkflowStatisticsRepo(db);
	const variableRepo = new VariableRepo(db);
	const settingsRepo = new SettingsRepo(db);
	const folderRepo = new FolderRepo(db);

	// ── 2. Core services ─────────────────────────────────────────────
	const instanceSettings = new InstanceSettings();
	const activeExecutions = new ActiveExecutions();
	const pushService = getPushService();

	const workflowService = new WorkflowService(workflowRepo, tagRepo, historyRepo);
	const credentialService = new CredentialService(credentialRepo, instanceSettings);
	const tagService = new TagService(tagRepo);
	const folderService = new FolderService(folderRepo);
	const variableService = new VariableService(variableRepo);
	const settingsService = new SettingsService(settingsRepo);

	// Binary data
	const binaryDataService = new BinaryDataService('filesystem');
	await binaryDataService.init();

	// Node types
	const { nodeTypes, credentialTypes } = loadAllNodes();

	// Execution persistence
	const executionPersistence = new ExecutionPersistence(
		executionRepo,
		executionDataRepo,
		executionMetadataRepo,
	);

	// Credentials helper (for node execution contexts)
	const cipher = new Cipher(instanceSettings);
	const credentialsHelper = new CredentialsHelper(credentialRepo, cipher, credentialTypes);

	// Additional data for the engine (rich n8n-compatible version)
	const additionalData = buildAdditionalData({ credentialsHelper, variableRepo, pushService });

	// Node executor wired with real additional data
	const nodeExecutor: NodeExecutor = createNodeExecutor(additionalData);

	// Lifecycle hook deps
	const hookDeps = {
		persistence: executionPersistence,
		statisticsRepo,
		pushService,
		activeExecutions,
	};

	// Workflow runner (used by ExecutionService for manual runs)
	const workflowRunner = new WorkflowRunner({
		activeExecutions,
		persistence: executionPersistence,
		pushService,
		nodeTypes,
		nodeExecutor,
		executionMode: QUEUE_MODE ? 'queue' : 'direct',
		maxTimeout: 0,
		hookDeps,
	});

	// Execution service (needs runner + binary data)
	const executionService = new ExecutionService(
		executionRepo,
		executionDataRepo,
		activeExecutions,
		binaryDataService,
		workflowRunner,
	);

	// Hook factory for webhook handlers
	const createHooks = (
		executionId: string,
		workflowId: string,
		mode: Parameters<typeof getLifecycleHooksForRegularMain>[2],
	) => getLifecycleHooksForRegularMain(executionId, workflowId, mode, hookDeps);

	// Webhooks
	const webhookService = new WebhookService(webhookRepo);
	const liveWebhooks = new LiveWebhooks({
		webhookService,
		workflowRepo,
		executionPersistence,
		pushService,
		activeExecutions,
		nodeExecutor,
		nodeTypes,
		createHooks,
		additionalData,
	});
	const testWebhooks = new TestWebhooks({
		workflowRepo,
		executionPersistence,
		pushService,
		activeExecutions,
		nodeExecutor,
		nodeTypes,
		createHooks,
		additionalData,
	});
	const waitingWebhooks = new WaitingWebhooks({
		executionRepo,
		executionDataRepo,
		pushService,
		activeExecutions,
		nodeExecutor,
		nodeTypes,
		createHooks,
		additionalData,
	});
	const webhookHandler = new WebhookRequestHandler(liveWebhooks, testWebhooks, waitingWebhooks);

	// Execution pruning
	const pruningService = new ExecutionPruningService(executionRepo, executionDataRepo);

	// ── 3. Health check dependencies ─────────────────────────────────
	registerHealthDependency({
		name: 'database',
		check: async () => {
			try {
				await settingsRepo.findAll();
				return true;
			} catch {
				return false;
			}
		},
	});

	// ── 4. Build Elysia app ──────────────────────────────────────────
	const app = new Elysia()
		.use(cors())
		// Health endpoints at root level
		.use(healthRoutes)
		// Push WebSocket
		.use(pushRoutes)
		// REST API routes
		.use(createWorkflowRoutes(workflowService))
		.use(createExecutionRoutes(executionService))
		.use(createCredentialRoutes(credentialService))
		.use(createTagRoutes(tagService))
		.use(createFolderRoutes(folderService))
		.use(createVariableRoutes(variableService))
		.use(createSettingsRoutes(settingsService))
		.use(createNodeTypesRoutes(nodeTypes, credentialTypes))
		.use(createImportExportRoutes(workflowService))
		// Webhook routes
		.use(createWebhookRoutes(webhookHandler))
		// OAuth routes
		.use(createOAuthRoutes(credentialService));

	// ── 5. Active workflow manager (non-queue mode only) ─────────────
	let activeWorkflowManager: ActiveWorkflowManager | undefined;

	if (!QUEUE_MODE) {
		const engineActiveWorkflows = new ActiveWorkflows();
		const scheduledTaskManager = new ScheduledTaskManager();
		const triggersAndPollers = new TriggersAndPollers();
		activeWorkflowManager = new ActiveWorkflowManager(
			workflowRepo,
			webhookService,
			nodeTypes,
			engineActiveWorkflows,
			scheduledTaskManager,
			triggersAndPollers,
			workflowRunner,
		);
		await activeWorkflowManager.init();
		console.log('Active workflows re-activated');
	} else {
		console.log('Queue mode enabled — skipping active workflow activation');
	}

	// Start execution pruning
	pruningService.start();

	// ── 6. Start server ──────────────────────────────────────────────
	app.listen(PORT);
	console.log(`n0n server running on http://localhost:${PORT}`);

	// ── 7. Graceful shutdown ─────────────────────────────────────────
	const shutdown = async () => {
		console.log('Shutting down n0n server...');

		pruningService.stop();

		if (activeWorkflowManager) {
			const activeIds = activeWorkflowManager.getActiveIds();
			for (const id of activeIds) {
				try {
					await activeWorkflowManager.remove(id);
				} catch (error) {
					console.error(`Failed to deactivate workflow ${id}:`, error);
				}
			}
		}

		// Close push connections
		pushService.broadcast({ type: 'sendWorkerStatusMessage', data: { status: 'shutting_down' } });

		process.exit(0);
	};

	process.on('SIGTERM', shutdown);
	process.on('SIGINT', shutdown);
}

main().catch((error) => {
	console.error('Failed to start n0n server:', error);
	process.exit(1);
});
