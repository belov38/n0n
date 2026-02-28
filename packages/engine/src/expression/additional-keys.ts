import type {
  IRunExecutionData,
  IWorkflowDataProxyAdditionalKeys,
  WorkflowExecuteMode,
} from 'n8n-workflow';

const PLACEHOLDER_EMPTY_EXECUTION_ID = '__UNKNOWN__';
const METADATA_KV_LIMIT = 10;

export interface AdditionalKeysOptions {
  executionId?: string;
  webhookWaitingBaseUrl?: string;
  formWaitingBaseUrl?: string;
  variables?: Record<string, string>;
}

/**
 * Validates a metadata key: alphanumeric + underscore only, max 50 chars.
 */
function validateMetadataKey(key: string): void {
  if (typeof key !== 'string') {
    throw new Error('Execution metadata key must be a string');
  }
  if (key.replace(/[A-Za-z0-9_]/g, '').length !== 0) {
    throw new Error(
      `Execution metadata key can only contain characters "A-Za-z0-9_" (key "${key}")`,
    );
  }
}

function setWorkflowExecutionMetadata(
  executionData: IRunExecutionData,
  key: string,
  value: string,
): void {
  if (!executionData.resultData.metadata) {
    executionData.resultData.metadata = {};
  }
  if (
    !(key in executionData.resultData.metadata) &&
    Object.keys(executionData.resultData.metadata).length >= METADATA_KV_LIMIT
  ) {
    return;
  }
  validateMetadataKey(key);
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error(`Execution metadata value for key "${key}" must be a string, number, or bigint`);
  }
  const val = String(value);
  executionData.resultData.metadata[key.slice(0, 50)] = val.slice(0, 512);
}

function setAllWorkflowExecutionMetadata(
  executionData: IRunExecutionData,
  obj: Record<string, string>,
): void {
  const errors: Error[] = [];
  for (const [key, value] of Object.entries(obj)) {
    try {
      setWorkflowExecutionMetadata(executionData, key, value);
    } catch (e) {
      errors.push(e as Error);
    }
  }
  if (errors.length) {
    throw errors[0];
  }
}

function getWorkflowExecutionMetadata(
  executionData: IRunExecutionData,
  key: string,
): string {
  return getAllWorkflowExecutionMetadata(executionData)[String(key).slice(0, 50)];
}

function getAllWorkflowExecutionMetadata(
  executionData: IRunExecutionData,
): Record<string, string> {
  return executionData.resultData.metadata ? { ...executionData.resultData.metadata } : {};
}

/**
 * Returns the additional keys for expression evaluation.
 * These get merged into the WorkflowDataProxy context and are available
 * as top-level variables in {{ expressions }}.
 *
 * Mirrors n8n-core's getAdditionalKeys():
 * - $execution: { id, mode, resumeUrl, resumeFormUrl, customData }
 * - $vars: instance-level variables
 * - $executionId (deprecated alias)
 * - $resumeWebhookUrl (deprecated alias)
 */
export function getAdditionalKeys(
  mode: WorkflowExecuteMode,
  runExecutionData: IRunExecutionData | null,
  options?: AdditionalKeysOptions,
): IWorkflowDataProxyAdditionalKeys {
  const executionId = options?.executionId ?? PLACEHOLDER_EMPTY_EXECUTION_ID;
  const webhookWaitingBaseUrl = options?.webhookWaitingBaseUrl ?? '';
  const formWaitingBaseUrl = options?.formWaitingBaseUrl ?? '';
  const resumeUrl = webhookWaitingBaseUrl
    ? `${webhookWaitingBaseUrl}/${executionId}`
    : '';
  const resumeFormUrl = formWaitingBaseUrl
    ? `${formWaitingBaseUrl}/${executionId}`
    : '';

  return {
    $execution: {
      id: executionId,
      mode: mode === 'manual' ? 'test' : 'production',
      resumeUrl,
      resumeFormUrl,
      customData: runExecutionData
        ? {
            set(key: string, value: string): void {
              try {
                setWorkflowExecutionMetadata(runExecutionData, key, value);
              } catch (e) {
                if (mode === 'manual') {
                  throw e;
                }
              }
            },
            setAll(obj: Record<string, string>): void {
              try {
                setAllWorkflowExecutionMetadata(runExecutionData, obj);
              } catch (e) {
                if (mode === 'manual') {
                  throw e;
                }
              }
            },
            get(key: string): string {
              return getWorkflowExecutionMetadata(runExecutionData, key);
            },
            getAll(): Record<string, string> {
              return getAllWorkflowExecutionMetadata(runExecutionData);
            },
          }
        : undefined,
    },
    $vars: options?.variables ?? {},
  };
}
