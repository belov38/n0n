import type { TagRepo } from '@n0n/db';
import { randomUUID } from 'crypto';

export class TagService {
	constructor(private repo: TagRepo) {}

	async findAll() {
		return this.repo.findAll();
	}

	async findById(id: string) {
		const tag = await this.repo.findById(id);
		if (!tag) throw new Error('Tag not found');
		return tag;
	}

	async create(data: { name: string }) {
		return this.repo.create({ id: randomUUID(), name: data.name });
	}

	async update(id: string, data: { name: string }) {
		const tag = await this.repo.update(id, data);
		if (!tag) throw new Error('Tag not found');
		return tag;
	}

	async delete(id: string) {
		await this.repo.delete(id);
	}
}
