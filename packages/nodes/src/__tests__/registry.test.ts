import { describe, it, expect } from 'bun:test';
import type {
	ICredentialType,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { NodeTypes } from '../registry/node-types';
import { CredentialTypes } from '../registry/credential-types';

function createMockNodeType(name: string, displayName: string): INodeType {
	return {
		description: {
			name,
			displayName,
			description: `${displayName} description`,
			group: ['transform'],
			version: 1,
			defaults: { name: displayName },
			inputs: [{ type: 'main' as const }],
			outputs: [{ type: 'main' as const }],
			properties: [],
		} as unknown as INodeTypeDescription,
	};
}

function createMockCredentialType(
	name: string,
	opts?: { extends?: string[]; supportedNodes?: string[] },
): ICredentialType {
	return {
		name,
		displayName: `${name} Display`,
		properties: [],
		...opts,
	};
}

describe('NodeTypes', () => {
	it('should register and retrieve a node type', () => {
		const registry = new NodeTypes();
		const node = createMockNodeType('n0n.testNode', 'Test Node');

		registry.register(node);

		expect(registry.getByName('n0n.testNode')).toBe(node);
		expect(registry.size).toBe(1);
	});

	it('should throw for unknown node type', () => {
		const registry = new NodeTypes();

		expect(() => registry.getByName('n0n.nonExistent')).toThrow(
			'Unknown node type: n0n.nonExistent',
		);
	});

	it('should return node type via getByNameAndVersion', () => {
		const registry = new NodeTypes();
		const node = createMockNodeType('n0n.testNode', 'Test Node');

		registry.register(node);

		expect(registry.getByNameAndVersion('n0n.testNode')).toBe(node);
		expect(registry.getByNameAndVersion('n0n.testNode', 1)).toBe(node);
	});

	it('should return node type descriptions', () => {
		const registry = new NodeTypes();
		registry.register(createMockNodeType('n0n.nodeA', 'Node A'));
		registry.register(createMockNodeType('n0n.nodeB', 'Node B'));

		const descriptions = registry.getNodeTypeDescriptions();

		expect(descriptions).toHaveLength(2);
		expect(descriptions.map((d) => d.name)).toEqual([
			'n0n.nodeA',
			'n0n.nodeB',
		]);
	});

	it('should return known types metadata', () => {
		const registry = new NodeTypes();
		registry.register(createMockNodeType('n0n.testNode', 'Test Node'));

		const known = registry.getKnownTypes();

		expect(known['n0n.testNode']).toEqual({ className: 'Test Node' });
	});
});

describe('CredentialTypes', () => {
	it('should register and retrieve a credential type', () => {
		const registry = new CredentialTypes();
		const cred = createMockCredentialType('testApi');

		registry.register(cred);

		expect(registry.getByName('testApi')).toBe(cred);
	});

	it('should throw for unknown credential type', () => {
		const registry = new CredentialTypes();

		expect(() => registry.getByName('nonExistent')).toThrow(
			'Unknown credential type: nonExistent',
		);
	});

	it('should recognize registered types', () => {
		const registry = new CredentialTypes();
		registry.register(createMockCredentialType('testApi'));

		expect(registry.recognizes('testApi')).toBe(true);
		expect(registry.recognizes('otherApi')).toBe(false);
	});

	it('should return all registered credential types', () => {
		const registry = new CredentialTypes();
		registry.register(createMockCredentialType('apiA'));
		registry.register(createMockCredentialType('apiB'));

		const all = registry.getAll();

		expect(all).toHaveLength(2);
		expect(all.map((c) => c.name)).toEqual(['apiA', 'apiB']);
	});

	it('should return supported nodes for a credential type', () => {
		const registry = new CredentialTypes();
		registry.register(
			createMockCredentialType('testApi', {
				supportedNodes: ['n0n.nodeA', 'n0n.nodeB'],
			}),
		);

		expect(registry.getSupportedNodes('testApi')).toEqual([
			'n0n.nodeA',
			'n0n.nodeB',
		]);
		expect(registry.getSupportedNodes('unknown')).toEqual([]);
	});

	it('should return parent types recursively', () => {
		const registry = new CredentialTypes();
		registry.register(
			createMockCredentialType('oAuth2Api', { extends: ['oAuthApi'] }),
		);
		registry.register(
			createMockCredentialType('oAuthApi', { extends: ['httpAuth'] }),
		);
		registry.register(createMockCredentialType('httpAuth'));

		const parents = registry.getParentTypes('oAuth2Api');

		expect(parents).toEqual(['oAuthApi', 'httpAuth']);
	});
});
