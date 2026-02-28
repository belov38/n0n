import type { FolderRepo } from '@n0n/db';
import { randomUUID } from 'crypto';

export class FolderService {
	constructor(private repo: FolderRepo) {}

	async findAll() {
		return this.repo.findAll();
	}

	async findById(id: string) {
		const folder = await this.repo.findById(id);
		if (!folder) throw new Error('Folder not found');
		return folder;
	}

	async findTree() {
		return this.repo.findTree();
	}

	async create(data: { name: string; parentFolderId?: string | null }) {
		return this.repo.create({ id: randomUUID(), ...data });
	}

	async update(id: string, data: { name?: string; parentFolderId?: string | null }) {
		const folder = await this.repo.update(id, data);
		if (!folder) throw new Error('Folder not found');
		return folder;
	}

	async delete(id: string) {
		await this.repo.delete(id);
	}
}
