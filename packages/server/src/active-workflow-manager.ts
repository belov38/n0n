import type { WorkflowRepo } from '@n0n/db';

export interface WebhookRegistrar {
  registerWebhook(data: {
    workflowId: string;
    webhookPath: string;
    method: string;
    node: string;
    webhookId?: string;
  }): Promise<unknown>;
  unregisterWorkflowWebhooks(workflowId: string): Promise<void>;
}

interface WorkflowNode {
  type: string;
  name: string;
  parameters: Record<string, unknown>;
}

const WEBHOOK_NODE_TYPES = new Set([
  'n0n-nodes.webhook',
  'n8n-nodes-base.webhook',
]);

/**
 * Manages activation/deactivation of workflows.
 * Registers webhooks, starts triggers/pollers on activation.
 * On startup, re-activates all workflows marked active in the DB.
 */
export class ActiveWorkflowManager {
  private activeWorkflowIds = new Set<string>();

  constructor(
    private workflowRepo: WorkflowRepo,
    private webhookService: WebhookRegistrar,
  ) {}

  /**
   * Initialize on server startup: activate all workflows flagged active in DB.
   */
  async init(): Promise<void> {
    const activeWorkflows = await this.workflowRepo.findAllActive();
    for (const wf of activeWorkflows) {
      try {
        await this.add(wf.id);
      } catch (error) {
        console.error(`Failed to activate workflow ${wf.id}:`, error);
      }
    }
  }

  /**
   * Activate a workflow: register its webhooks, start triggers/pollers.
   */
  async add(workflowId: string): Promise<void> {
    if (this.activeWorkflowIds.has(workflowId)) return;

    const wfData = await this.workflowRepo.findById(workflowId);
    if (!wfData) throw new Error(`Workflow ${workflowId} not found`);

    const nodes = (wfData.nodes ?? []) as WorkflowNode[];

    for (const node of nodes) {
      if (this.isWebhookNode(node.type)) {
        const path = (node.parameters?.path as string) || node.name;
        const method = ((node.parameters?.httpMethod as string) || 'GET').toUpperCase();
        await this.webhookService.registerWebhook({
          workflowId,
          webhookPath: path,
          method,
          node: node.name,
        });
      }

      // TODO: Start trigger nodes (cron, polling) via ActiveWorkflows + ScheduledTaskManager
    }

    this.activeWorkflowIds.add(workflowId);
  }

  /**
   * Deactivate a workflow: remove webhooks, stop triggers/pollers.
   */
  async remove(workflowId: string): Promise<void> {
    if (!this.activeWorkflowIds.has(workflowId)) return;

    await this.webhookService.unregisterWorkflowWebhooks(workflowId);

    // TODO: Stop trigger nodes via ActiveWorkflows.remove()

    this.activeWorkflowIds.delete(workflowId);
  }

  isActive(workflowId: string): boolean {
    return this.activeWorkflowIds.has(workflowId);
  }

  getActiveIds(): string[] {
    return Array.from(this.activeWorkflowIds);
  }

  private isWebhookNode(nodeType: string): boolean {
    return WEBHOOK_NODE_TYPES.has(nodeType);
  }
}
