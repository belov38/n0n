/**
 * Manages cron-based scheduled tasks for active workflows.
 * Uses setInterval as a simplified cron — in production, swap to a proper cron library.
 */

interface ScheduledCron {
  workflowId: string;
  nodeId: string;
  expression: string;
  intervalId: ReturnType<typeof setInterval>;
}

export interface CronContext {
  workflowId: string;
  nodeId: string;
  expression: string;
  timezone?: string;
}

export class ScheduledTaskManager {
  private cronsByWorkflow = new Map<string, Map<string, ScheduledCron>>();

  /**
   * Register a cron expression for a workflow node.
   * Calls onTick on the computed interval.
   */
  registerCron(ctx: CronContext, onTick: () => void): void {
    const { workflowId, nodeId, expression } = ctx;
    const key = this.toCronKey(ctx);

    const existing = this.cronsByWorkflow.get(workflowId);
    if (existing?.has(key)) {
      console.warn(`Cron already registered: ${key}`);
      return;
    }

    const intervalMs = this.cronToMs(expression);
    const intervalId = setInterval(() => {
      try {
        onTick();
      } catch (error) {
        console.error(`Cron error for workflow ${workflowId}, node ${nodeId}:`, error);
      }
    }, intervalMs);

    const cron: ScheduledCron = { workflowId, nodeId, expression, intervalId };

    if (!existing) {
      this.cronsByWorkflow.set(workflowId, new Map([[key, cron]]));
    } else {
      existing.set(key, cron);
    }
  }

  deregisterCrons(workflowId: string): void {
    const crons = this.cronsByWorkflow.get(workflowId);
    if (!crons) return;

    for (const cron of crons.values()) {
      clearInterval(cron.intervalId);
    }

    this.cronsByWorkflow.delete(workflowId);
  }

  deregisterAllCrons(): void {
    for (const workflowId of this.cronsByWorkflow.keys()) {
      this.deregisterCrons(workflowId);
    }
  }

  /**
   * Simplified cron-to-interval conversion.
   * Handles basic patterns like "* /5 * * * *" (every 5 min) and "0 * * * *" (hourly).
   * Replace with a proper cron library (e.g. croner) for production.
   */
  private cronToMs(cron: string): number {
    const parts = cron.trim().split(/\s+/);
    if (parts.length >= 5) {
      const minute = parts[0];
      if (minute.startsWith('*/')) {
        return parseInt(minute.slice(2), 10) * 60 * 1000;
      }
      if (minute === '0' && parts[1] === '*') {
        return 60 * 60 * 1000; // Hourly
      }
    }
    // Default: every minute
    return 60 * 1000;
  }

  private toCronKey(ctx: CronContext): string {
    return `${ctx.workflowId}:${ctx.nodeId}:${ctx.expression}`;
  }
}
