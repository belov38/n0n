import { eq, isNull } from 'drizzle-orm';
import type { Database } from '../connection';
import { folder } from '../schema/folder';
import type { Folder, NewFolder } from '../schema/folder';

export interface FolderTreeNode extends Folder {
  children: FolderTreeNode[];
}

export class FolderRepo {
  constructor(private db: Database) {}

  async findById(id: string): Promise<Folder | undefined> {
    const results = await this.db.select().from(folder).where(eq(folder.id, id)).limit(1);
    return results[0];
  }

  async findAll(): Promise<Folder[]> {
    return this.db.select().from(folder);
  }

  async findByParentId(parentFolderId: string | null): Promise<Folder[]> {
    if (parentFolderId === null) {
      return this.db.select().from(folder).where(isNull(folder.parentFolderId));
    }
    return this.db.select().from(folder).where(eq(folder.parentFolderId, parentFolderId));
  }

  async create(data: NewFolder): Promise<Folder> {
    const results = await this.db.insert(folder).values(data).returning();
    return results[0];
  }

  async update(id: string, data: Partial<NewFolder>): Promise<Folder | undefined> {
    const results = await this.db
      .update(folder)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(folder.id, id))
      .returning();
    return results[0];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(folder).where(eq(folder.id, id));
  }

  async findTree(): Promise<FolderTreeNode[]> {
    const allFolders = await this.findAll();
    return this.buildTree(allFolders);
  }

  private buildTree(folders: Folder[]): FolderTreeNode[] {
    const map = new Map<string, FolderTreeNode>();
    const roots: FolderTreeNode[] = [];

    for (const f of folders) {
      map.set(f.id, { ...f, children: [] });
    }

    for (const f of folders) {
      const node = map.get(f.id)!;
      if (f.parentFolderId === null) {
        roots.push(node);
      } else {
        const parent = map.get(f.parentFolderId);
        if (parent) {
          parent.children.push(node);
        } else {
          // Orphan folder (parent missing) — treat as root
          roots.push(node);
        }
      }
    }

    return roots;
  }
}
