import type {
  INode,
  INodeExecutionData,
  INodeType,
  IPollFunctions,
  ITriggerFunctions,
  ITriggerResponse,
  Workflow,
  WorkflowActivateMode,
  WorkflowExecuteMode,
} from 'n8n-workflow';

export type GetTriggerFunctions = (
  workflow: Workflow,
  node: INode,
  mode: WorkflowExecuteMode,
  activation: WorkflowActivateMode,
) => ITriggerFunctions;

export type GetPollFunctions = (
  workflow: Workflow,
  node: INode,
  mode: WorkflowExecuteMode,
  activation: WorkflowActivateMode,
) => IPollFunctions;

export class TriggersAndPollers {
  /**
   * Run a trigger node's trigger() method and return the response
   * containing the closeFunction for deactivation.
   */
  async runTrigger(
    workflow: Workflow,
    node: INode,
    getTriggerFunctions: GetTriggerFunctions,
    mode: WorkflowExecuteMode,
    activation: WorkflowActivateMode,
  ): Promise<ITriggerResponse | undefined> {
    const triggerFunctions = getTriggerFunctions(workflow, node, mode, activation);
    const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

    if (!nodeType.trigger) {
      throw new Error(`Node type "${node.type}" does not have a trigger method`);
    }

    return nodeType.trigger.call(triggerFunctions);
  }

  /**
   * Run a poll node's poll() method and return the output data.
   */
  async runPoll(
    workflow: Workflow,
    node: INode,
    pollFunctions: IPollFunctions,
  ): Promise<INodeExecutionData[][] | null> {
    const nodeType = workflow.nodeTypes.getByNameAndVersion(node.type, node.typeVersion);

    if (!nodeType.poll) {
      throw new Error(`Node type "${node.type}" does not have a poll method`);
    }

    return nodeType.poll.call(pollFunctions);
  }
}
