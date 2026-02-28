import { describe, it, expect } from 'bun:test';
import { DateTime } from 'luxon';
import {
  Expression,
  Workflow,
  NodeConnectionTypes,
} from 'n8n-workflow';
import type {
  INodeType,
  INodeTypes,
  IDataObject,
  IVersionedNodeType,
  INodeExecutionData,
  IWorkflowDataProxyAdditionalKeys,
} from 'n8n-workflow';

import { getAdditionalKeys } from '../expression/additional-keys';

// Minimal node type for testing
const setNode: INodeType = {
  description: {
    displayName: 'Set',
    name: 'set',
    group: ['input'],
    version: 1,
    description: 'Sets a value',
    defaults: { name: 'Set', color: '#0000FF' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    properties: [
      {
        displayName: 'Value1',
        name: 'value1',
        type: 'string',
        default: 'default-value1',
      },
    ],
  },
};

const nodeTypes: INodeTypes = {
  getByName(_nodeType: string): INodeType | IVersionedNodeType {
    return setNode;
  },
  getByNameAndVersion(_nodeType: string, _version?: number): INodeType {
    return setNode;
  },
  getKnownTypes(): IDataObject {
    return {};
  },
};

function createTestWorkflow() {
  return new Workflow({
    id: 'test-workflow-1',
    name: 'Test Workflow',
    nodes: [
      {
        id: 'uuid-1234',
        name: 'TestNode',
        type: 'test.set',
        typeVersion: 1,
        position: [0, 0],
        parameters: {},
      },
    ],
    connections: {},
    active: false,
    nodeTypes,
  });
}

/**
 * Evaluate an expression using n8n-workflow's Expression class.
 * The npm version's Expression class constructor takes a Workflow,
 * and resolveSimpleParameterValue takes (parameterValue, siblingParameters,
 * runExecutionData, runIndex, itemIndex, activeNodeName, connectionInputData,
 * mode, additionalKeys, ...).
 */
function evaluateExpression(
  expressionStr: string,
  inputData: IDataObject = {},
  additionalKeys: IWorkflowDataProxyAdditionalKeys = {},
): unknown {
  const workflow = createTestWorkflow();
  const expression = new Expression(workflow);
  const connectionInputData: INodeExecutionData[] = [{ json: inputData }];
  return expression.resolveSimpleParameterValue(
    expressionStr,
    {},
    null,
    0,
    0,
    'TestNode',
    connectionInputData,
    'manual',
    additionalKeys,
  );
}

describe('getAdditionalKeys', () => {
  it('returns $execution with correct id and mode for manual', () => {
    const keys = getAdditionalKeys('manual', null, {
      executionId: 'exec-123',
    });

    expect(keys.$execution).toBeDefined();
    const execution = keys.$execution as Record<string, unknown>;
    expect(execution.id).toBe('exec-123');
    expect(execution.mode).toBe('test');
  });

  it('returns $execution with production mode for non-manual', () => {
    const keys = getAdditionalKeys('webhook', null, {
      executionId: 'exec-456',
    });

    const execution = keys.$execution as Record<string, unknown>;
    expect(execution.mode).toBe('production');
  });

  it('returns $execution.resumeUrl based on webhookWaitingBaseUrl', () => {
    const keys = getAdditionalKeys('manual', null, {
      executionId: 'exec-789',
      webhookWaitingBaseUrl: 'https://example.com/wait',
    });

    const execution = keys.$execution as Record<string, unknown>;
    expect(execution.resumeUrl).toBe('https://example.com/wait/exec-789');
  });

  it('returns $vars from options', () => {
    const keys = getAdditionalKeys('manual', null, {
      variables: { MY_VAR: 'my_value' },
    });

    const vars = keys.$vars as Record<string, string>;
    expect(vars.MY_VAR).toBe('my_value');
  });

  it('returns placeholder execution id when none provided', () => {
    const keys = getAdditionalKeys('manual', null);
    const execution = keys.$execution as Record<string, unknown>;
    expect(execution.id).toBe('__UNKNOWN__');
  });

  it('provides customData methods when runExecutionData is present', () => {
    const runExecutionData = {
      startData: {},
      resultData: {
        runData: {},
        metadata: {} as Record<string, string>,
      },
      executionData: {
        contextData: {},
        nodeExecutionStack: [],
        metadata: {},
        waitingExecution: {},
        waitingExecutionSource: {},
      },
    } as unknown as import('n8n-workflow').IRunExecutionData;

    const keys = getAdditionalKeys('manual', runExecutionData, {
      executionId: 'exec-100',
    });

    const execution = keys.$execution as Record<string, unknown>;
    const customData = execution.customData as {
      set: (key: string, value: string) => void;
      get: (key: string) => string;
      setAll: (obj: Record<string, string>) => void;
      getAll: () => Record<string, string>;
    };
    expect(customData).toBeDefined();

    customData.set('testKey', 'testValue');
    expect(customData.get('testKey')).toBe('testValue');

    customData.setAll({ foo: 'bar', baz: 'qux' });
    const all = customData.getAll();
    expect(all.foo).toBe('bar');
    expect(all.baz).toBe('qux');
    expect(all.testKey).toBe('testValue');
  });

  it('customData is undefined when runExecutionData is null', () => {
    const keys = getAdditionalKeys('manual', null, {
      executionId: 'exec-100',
    });

    const execution = keys.$execution as Record<string, unknown>;
    expect(execution.customData).toBeUndefined();
  });
});

describe('Expression evaluation with n8n-workflow', () => {
  it('evaluates simple property access: $json.name', () => {
    const result = evaluateExpression('={{ $json.name }}', { name: 'Alice' });
    expect(result).toBe('Alice');
  });

  it('evaluates math expressions: 1 + 2', () => {
    const result = evaluateExpression('={{ 1 + 2 }}');
    expect(result).toBe(3);
  });

  it('evaluates string methods: "hello".toUpperCase()', () => {
    const result = evaluateExpression('={{ "hello".toUpperCase() }}');
    expect(result).toBe('HELLO');
  });

  it('$now is a Luxon DateTime (has current year)', () => {
    const result = evaluateExpression('={{ $now.year }}');
    expect(result).toBe(DateTime.now().year);
  });

  it('$today is at midnight (hour is 0)', () => {
    const result = evaluateExpression('={{ $today.hour }}');
    expect(result).toBe(0);
  });

  it('$execution.id returns correct value from additional keys', () => {
    const additionalKeys = getAdditionalKeys('manual', null, {
      executionId: 'test-exec-id',
    });
    const result = evaluateExpression(
      '={{ $execution.id }}',
      {},
      additionalKeys,
    );
    expect(result).toBe('test-exec-id');
  });

  it('$execution.mode returns "test" for manual mode', () => {
    const additionalKeys = getAdditionalKeys('manual', null, {
      executionId: 'exec-1',
    });
    const result = evaluateExpression(
      '={{ $execution.mode }}',
      {},
      additionalKeys,
    );
    expect(result).toBe('test');
  });

  it('$vars are accessible in expressions', () => {
    const additionalKeys = getAdditionalKeys('manual', null, {
      variables: { API_URL: 'https://api.example.com' },
    });
    const result = evaluateExpression(
      '={{ $vars.API_URL }}',
      {},
      additionalKeys,
    );
    expect(result).toBe('https://api.example.com');
  });

  it('evaluates nested $json property access', () => {
    const result = evaluateExpression('={{ $json.user.name }}', {
      user: { name: 'Bob', age: 30 },
    });
    expect(result).toBe('Bob');
  });

  it('non-expression values pass through unchanged', () => {
    const result = evaluateExpression('plain text');
    expect(result).toBe('plain text');
  });
});
