import type {
  ExecutionStatus,
  WorkflowExecuteMode,
  INode,
  IConnections,
  IWorkflowSettings,
} from 'n8n-workflow';

// Workflow DTOs
export interface WorkflowCreateDto {
  name: string;
  nodes: INode[];
  connections: IConnections;
  settings?: IWorkflowSettings;
  staticData?: Record<string, unknown>;
  tags?: string[];
  folderId?: string;
}

export interface WorkflowUpdateDto {
  name?: string;
  nodes?: INode[];
  connections?: IConnections;
  settings?: IWorkflowSettings;
  staticData?: Record<string, unknown>;
  active?: boolean;
  tags?: string[];
  folderId?: string;
  versionId?: string;
}

export interface WorkflowListParams {
  active?: boolean;
  tags?: string[];
  name?: string;
  folderId?: string;
  cursor?: string;
  limit?: number;
}

// Execution DTOs
export interface ExecutionListParams {
  workflowId?: string;
  status?: ExecutionStatus;
  startedAfter?: string;
  startedBefore?: string;
  cursor?: string;
  limit?: number;
}

export interface ExecutionStopResult {
  mode: WorkflowExecuteMode;
  startedAt: Date;
  stoppedAt: Date;
  finished: boolean;
  status: ExecutionStatus;
}

// Credential DTOs
export interface CredentialCreateDto {
  name: string;
  type: string;
  data: Record<string, unknown>;
}

export interface CredentialUpdateDto {
  name?: string;
  data?: Record<string, unknown>;
}

// Tag DTOs
export interface TagCreateDto {
  name: string;
}

// Folder DTOs
export interface FolderCreateDto {
  name: string;
  parentFolderId?: string;
}

export interface FolderUpdateDto {
  name?: string;
  parentFolderId?: string;
}

// Variable DTOs
export interface VariableCreateDto {
  key: string;
  value: string;
}

// Settings DTOs
export interface SettingsUpdateDto {
  [key: string]: string;
}

// Push event types
export type PushEventType =
  | 'executionStarted'
  | 'executionFinished'
  | 'executionRecovered'
  | 'nodeExecuteBefore'
  | 'nodeExecuteAfter'
  | 'workflowActivated'
  | 'workflowDeactivated'
  | 'workflowFailedToActivate'
  | 'sendWorkerStatusMessage';

export interface PushEvent {
  type: PushEventType;
  data: Record<string, unknown>;
}
