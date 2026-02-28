import { eq } from 'drizzle-orm';
import type { Database } from '../connection';
import { credential } from '../schema/credential';
import type { Credential, NewCredential } from '../schema/credential';

export class CredentialRepo {
  constructor(private db: Database) {}

  async findById(id: string): Promise<Credential | undefined> {
    const results = await this.db.select().from(credential).where(eq(credential.id, id)).limit(1);
    return results[0];
  }

  async findMany(options?: { type?: string }): Promise<Credential[]> {
    if (options?.type) {
      return this.findByType(options.type);
    }
    return this.db.select().from(credential);
  }

  async create(data: NewCredential): Promise<Credential> {
    const results = await this.db.insert(credential).values(data).returning();
    return results[0];
  }

  async update(id: string, data: Partial<NewCredential>): Promise<Credential | undefined> {
    const results = await this.db
      .update(credential)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(credential.id, id))
      .returning();
    return results[0];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(credential).where(eq(credential.id, id));
  }

  async findByType(type: string): Promise<Credential[]> {
    return this.db.select().from(credential).where(eq(credential.type, type));
  }
}
