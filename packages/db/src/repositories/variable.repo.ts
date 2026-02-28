import { eq } from 'drizzle-orm';
import type { Database } from '../connection';
import { variable } from '../schema/variable';
import type { Variable, NewVariable } from '../schema/variable';

export class VariableRepo {
  constructor(private db: Database) {}

  async findAll(): Promise<Variable[]> {
    return this.db.select().from(variable);
  }

  async findByKey(key: string): Promise<Variable | undefined> {
    const results = await this.db
      .select()
      .from(variable)
      .where(eq(variable.key, key))
      .limit(1);
    return results[0];
  }

  async create(data: NewVariable): Promise<Variable> {
    const results = await this.db.insert(variable).values(data).returning();
    return results[0];
  }

  async update(id: number, data: Partial<NewVariable>): Promise<Variable | undefined> {
    const results = await this.db
      .update(variable)
      .set(data)
      .where(eq(variable.id, id))
      .returning();
    return results[0];
  }

  async delete(id: number): Promise<void> {
    await this.db.delete(variable).where(eq(variable.id, id));
  }

  async getAsRecord(): Promise<Record<string, string>> {
    const rows = await this.db.select().from(variable);
    const record: Record<string, string> = {};
    for (const row of rows) {
      record[row.key] = row.value;
    }
    return record;
  }
}
