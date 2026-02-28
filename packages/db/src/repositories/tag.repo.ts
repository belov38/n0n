import { eq, inArray } from 'drizzle-orm';
import type { Database } from '../connection';
import { tag } from '../schema/tag';
import type { Tag, NewTag } from '../schema/tag';
import { workflowTagMapping } from '../schema/workflow-tag-mapping';

export class TagRepo {
  constructor(private db: Database) {}

  async findById(id: string): Promise<Tag | undefined> {
    const results = await this.db.select().from(tag).where(eq(tag.id, id)).limit(1);
    return results[0];
  }

  async findByName(name: string): Promise<Tag | undefined> {
    const results = await this.db.select().from(tag).where(eq(tag.name, name)).limit(1);
    return results[0];
  }

  async findAll(): Promise<Tag[]> {
    return this.db.select().from(tag);
  }

  async create(data: NewTag): Promise<Tag> {
    const results = await this.db.insert(tag).values(data).returning();
    return results[0];
  }

  async update(id: string, data: Partial<NewTag>): Promise<Tag | undefined> {
    const results = await this.db
      .update(tag)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tag.id, id))
      .returning();
    return results[0];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(tag).where(eq(tag.id, id));
  }

  async findByWorkflowId(workflowId: string): Promise<Tag[]> {
    const mappings = await this.db
      .select({ tagId: workflowTagMapping.tagId })
      .from(workflowTagMapping)
      .where(eq(workflowTagMapping.workflowId, workflowId));

    const tagIds = mappings.map((m) => m.tagId);
    if (tagIds.length === 0) return [];

    return this.db.select().from(tag).where(inArray(tag.id, tagIds));
  }

  async setWorkflowTags(workflowId: string, tagIds: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .delete(workflowTagMapping)
        .where(eq(workflowTagMapping.workflowId, workflowId));

      if (tagIds.length === 0) return;

      await tx.insert(workflowTagMapping).values(
        tagIds.map((tagId) => ({ workflowId, tagId })),
      );
    });
  }
}
