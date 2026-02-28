import type { IRunExecutionData, WorkflowExecuteMode } from 'n8n-workflow';

export interface ActiveExecution {
	id: string;
	workflowId: string;
	mode: WorkflowExecuteMode;
	startedAt: Date;
	status: 'running' | 'waiting';
	responsePromise?: {
		resolve: (data: IRunExecutionData) => void;
		reject: (error: Error) => void;
	};
	cancel?: () => void;
}

export class ActiveExecutions {
	private activeExecutions = new Map<string, ActiveExecution>();

	add(execution: ActiveExecution): void {
		this.activeExecutions.set(execution.id, execution);
	}

	remove(id: string): void {
		this.activeExecutions.delete(id);
	}

	get(id: string): ActiveExecution | undefined {
		return this.activeExecutions.get(id);
	}

	getAll(): ActiveExecution[] {
		return Array.from(this.activeExecutions.values());
	}

	getRunning(): ActiveExecution[] {
		return this.getAll().filter((e) => e.status === 'running');
	}

	getByWorkflowId(workflowId: string): ActiveExecution[] {
		return this.getAll().filter((e) => e.workflowId === workflowId);
	}

	cancel(id: string): boolean {
		const execution = this.activeExecutions.get(id);
		if (!execution) return false;
		if (execution.cancel) {
			execution.cancel();
		}
		execution.status = 'waiting';
		return true;
	}

	getCount(): number {
		return this.activeExecutions.size;
	}
}
