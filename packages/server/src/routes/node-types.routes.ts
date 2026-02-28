import { Elysia } from 'elysia';
import type { NodeTypes, CredentialTypes } from '@n0n/nodes';

export function createNodeTypesRoutes(
	nodeTypes: NodeTypes,
	credentialTypes?: CredentialTypes,
) {
	return new Elysia({ prefix: '/rest/node-types' })
		.get('/', () => {
			return { data: nodeTypes.getNodeTypeDescriptions() };
		})
		.get('/credential-types', () => {
			if (!credentialTypes) {
				return { data: [] };
			}
			return { data: credentialTypes.getAll() };
		})
		.get('/:nodeType', ({ params, set }) => {
			try {
				const nodeType = nodeTypes.getByNameAndVersion(params.nodeType);
				return { data: nodeType.description };
			} catch {
				set.status = 404;
				return { error: `Node type not found: ${params.nodeType}` };
			}
		});
}
