import type { ITriggerResponse } from 'n8n-workflow';

interface WorkflowData {
  triggerResponses: ITriggerResponse[];
}

/**
 * In-memory registry of active trigger/poller workflows.
 * Tracks trigger responses so they can be closed on deactivation.
 */
export class ActiveWorkflows {
  private activeWorkflows = new Map<string, WorkflowData>();

  isActive(workflowId: string): boolean {
    return this.activeWorkflows.has(workflowId);
  }

  allActiveWorkflowIds(): string[] {
    return Array.from(this.activeWorkflows.keys());
  }

  get(workflowId: string): WorkflowData | undefined {
    return this.activeWorkflows.get(workflowId);
  }

  /**
   * Register a workflow as active with its trigger responses.
   * Trigger responses contain closeFunction for cleanup on deactivation.
   */
  add(workflowId: string, triggerResponses: ITriggerResponse[]): void {
    this.activeWorkflows.set(workflowId, { triggerResponses });
  }

  /**
   * Remove a workflow from active state.
   * Calls closeFunction on each trigger response for cleanup.
   */
  async remove(workflowId: string): Promise<boolean> {
    const data = this.activeWorkflows.get(workflowId);
    if (!data) return false;

    for (const response of data.triggerResponses) {
      if (response.closeFunction) {
        try {
          await response.closeFunction();
        } catch (error) {
          console.error(
            `Error closing trigger for workflow "${workflowId}":`,
            error,
          );
        }
      }
    }

    this.activeWorkflows.delete(workflowId);
    return true;
  }

  async removeAll(): Promise<void> {
    for (const workflowId of this.activeWorkflows.keys()) {
      await this.remove(workflowId);
    }
  }
}
