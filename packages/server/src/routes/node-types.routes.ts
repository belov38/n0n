import { Elysia } from 'elysia';
import type { NodeTypes } from '@n0n/nodes';

export function createNodeTypesRoutes(nodeTypes: NodeTypes) {
	return new Elysia({ prefix: '/rest/node-types' })
		.get('/', () => {
			return { data: nodeTypes.getNodeTypeDescriptions() };
		});
}
