/**
 * Expression engine integration for n0n.
 *
 * n8n-workflow's Expression class does the heavy lifting: parsing, sandboxing,
 * evaluating {{ expressions }}. It internally creates a WorkflowDataProxy that
 * builds the full data context ($json, $input, $now, $today, $jmespath, $env, etc.).
 *
 * This module provides getAdditionalKeys() which produces the execution-scoped
 * keys ($execution, $vars) that get merged into that context.
 */
export { getAdditionalKeys, type AdditionalKeysOptions } from './additional-keys';

// Re-export the expression class from n8n-workflow for convenience.
// Expression takes a Workflow in its constructor and provides
// resolveSimpleParameterValue() / getParameterValue() for evaluation.
export { Expression, WorkflowDataProxy } from 'n8n-workflow';
