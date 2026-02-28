import type { INodeType, ICredentialType } from 'n8n-workflow';

import { NodeTypes } from './registry/node-types';
import { CredentialTypes } from './registry/credential-types';

import { DateTime } from './nodes/DateTime/DateTime.node';
import { Function } from './nodes/Function/Function.node';
import { FunctionItem } from './nodes/Function/FunctionItem.node';

export interface LoadedNodes {
	nodeTypes: NodeTypes;
	credentialTypes: CredentialTypes;
}

// Will be populated as nodes are created
const nodeModules: INodeType[] = [
	new DateTime(),
	new Function(),
	new FunctionItem(),
];

// Will be populated as credential types are created
const credentialModules: ICredentialType[] = [];

export function loadAllNodes(): LoadedNodes {
	const nodeTypes = new NodeTypes();
	const credentialTypes = new CredentialTypes();

	for (const node of nodeModules) {
		nodeTypes.register(node);
	}

	for (const cred of credentialModules) {
		credentialTypes.register(cred);
	}

	return { nodeTypes, credentialTypes };
}

export function registerNode(nodeTypes: NodeTypes, node: INodeType): void {
	nodeTypes.register(node);
}

export function registerCredential(
	credentialTypes: CredentialTypes,
	credential: ICredentialType,
): void {
	credentialTypes.register(credential);
}
