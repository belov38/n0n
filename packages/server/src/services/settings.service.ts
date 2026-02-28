import type { SettingsRepo } from '@n0n/db';

export class SettingsService {
	constructor(private repo: SettingsRepo) {}

	async findAll() {
		return this.repo.findAll();
	}

	async findByKey(key: string) {
		const setting = await this.repo.findByKey(key);
		if (!setting) throw new Error('Setting not found');
		return setting;
	}

	async upsert(key: string, value: string) {
		return this.repo.upsert(key, value);
	}

	async delete(key: string) {
		await this.repo.delete(key);
	}

	async getAsRecord() {
		return this.repo.getAsRecord();
	}
}
