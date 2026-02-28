import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	INodeTypes,
	IVersionedNodeType,
} from 'n8n-workflow';

export class NodeTypes implements INodeTypes {
	private nodeTypes: Map<string, INodeType | IVersionedNodeType> = new Map();

	register(nodeType: INodeType | IVersionedNodeType): void {
		const name = nodeType.description.name;
		this.nodeTypes.set(name, nodeType);
	}

	getByName(nodeType: string): INodeType | IVersionedNodeType {
		const found = this.nodeTypes.get(nodeType);
		if (!found) {
			throw new Error(`Unknown node type: ${nodeType}`);
		}
		return found;
	}

	getByNameAndVersion(nodeType: string, version?: number): INodeType {
		const found = this.getByName(nodeType);

		// Versioned node type — resolve specific version
		if ('nodeVersions' in found) {
			return found.getNodeType(version);
		}

		return found;
	}

	getKnownTypes(): IDataObject {
		const result: IDataObject = {};
		for (const [name, nodeType] of this.nodeTypes) {
			result[name] = {
				className: nodeType.description.displayName,
			};
		}
		return result;
	}

	// Return all registered node type descriptions (for the API)
	getNodeTypeDescriptions(): INodeTypeDescription[] {
		const descriptions: INodeTypeDescription[] = [];
		for (const nodeType of this.nodeTypes.values()) {
			if ('nodeVersions' in nodeType) {
				const current = nodeType.nodeVersions[nodeType.currentVersion];
				if (current) {
					descriptions.push(current.description);
				}
			} else {
				descriptions.push(nodeType.description);
			}
		}
		return descriptions;
	}

	get size(): number {
		return this.nodeTypes.size;
	}
}
