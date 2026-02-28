import { eq } from 'drizzle-orm';
import type { Database } from '../connection';
import { settings } from '../schema/settings';
import type { Settings } from '../schema/settings';

export class SettingsRepo {
  constructor(private db: Database) {}

  async findByKey(key: string): Promise<Settings | undefined> {
    const results = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    return results[0];
  }

  async findAll(): Promise<Settings[]> {
    return this.db.select().from(settings);
  }

  async findStartupSettings(): Promise<Settings[]> {
    return this.db.select().from(settings).where(eq(settings.loadOnStartup, true));
  }

  async upsert(key: string, value: string): Promise<Settings> {
    const results = await this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value },
      })
      .returning();
    return results[0];
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(settings).where(eq(settings.key, key));
  }

  async getAsRecord(): Promise<Record<string, string>> {
    const rows = await this.db.select().from(settings);
    const record: Record<string, string> = {};
    for (const row of rows) {
      record[row.key] = row.value;
    }
    return record;
  }
}
