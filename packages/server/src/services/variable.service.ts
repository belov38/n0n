import type { VariableRepo } from '@n0n/db';
import type { NewVariable } from '@n0n/db';

export class VariableService {
	constructor(private repo: VariableRepo) {}

	async findAll() {
		return this.repo.findAll();
	}

	async findByKey(key: string) {
		const variable = await this.repo.findByKey(key);
		if (!variable) throw new Error('Variable not found');
		return variable;
	}

	async create(data: NewVariable) {
		return this.repo.create(data);
	}

	async update(id: number, data: Partial<NewVariable>) {
		const variable = await this.repo.update(id, data);
		if (!variable) throw new Error('Variable not found');
		return variable;
	}

	async delete(id: number) {
		await this.repo.delete(id);
	}
}
