import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { snippetDraftSchema, snippetFileSchema, snippetGroup, type Snippet, type SnippetDraft } from "../shared/snippets";

export function defaultStorePath(): string {
  return path.join(process.env.PASEO_HOME || path.join(homedir(), ".paseo"),
    "plugin-data", "paseo-snippets", "snippets.json");
}

function normalizedDraft(draft: SnippetDraft) {
  const value = snippetDraftSchema.parse(draft);
  return { ...value, tags: [...new Set(value.tags)] };
}

export class SnippetStore {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly filename: string = defaultStorePath()) {}

  private async read(): Promise<Snippet[]> {
    let content: string;
    try {
      content = await fs.readFile(this.filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    try {
      return snippetFileSchema.parse(JSON.parse(content)).snippets;
    } catch (error) {
      throw new Error(`片段文件无效，原文件未修改：${this.filename}`, { cause: error });
    }
  }

  async list(): Promise<Snippet[]> {
    await this.pending;
    return this.read();
  }

  private async persist(snippets: Snippet[]): Promise<void> {
    const directory = path.dirname(this.filename);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, snippets }, null, 2) + "\n", {
        encoding: "utf8", flag: "wx", mode: 0o600,
      });
      await fs.rename(temporary, this.filename);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  private mutate<T>(change: (snippets: Snippet[]) => { snippets: Snippet[]; result: T }): Promise<T> {
    const operation = this.pending.then(async () => {
      const previous = await this.read();
      const { snippets, result } = change(previous);
      await this.persist(snippets);
      return result;
    });
    this.pending = operation.then(() => undefined, () => undefined);
    return operation;
  }

  create(draft: SnippetDraft): Promise<Snippet> {
    const value = normalizedDraft(draft);
    return this.mutate((snippets) => {
      const now = new Date().toISOString();
      const snippet: Snippet = { ...value, id: randomUUID(), createdAt: now, updatedAt: now };
      return { snippets: [...snippets, snippet], result: snippet };
    });
  }

  update(id: string, draft: SnippetDraft): Promise<Snippet> {
    const value = normalizedDraft(draft);
    return this.mutate((snippets) => {
      const index = snippets.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("片段不存在或已删除");
      const current = snippets[index]!;
      const updated: Snippet = { ...current, ...value, updatedAt: new Date().toISOString() };
      const next = snippets.slice();
      next[index] = updated;
      return { snippets: next, result: updated };
    });
  }

  delete(id: string): Promise<{ deleted: boolean }> {
    return this.mutate((snippets) => {
      const next = snippets.filter((item) => item.id !== id);
      return { snippets: next, result: { deleted: next.length !== snippets.length } };
    });
  }

  deleteGroup(group: string): Promise<{ deleted: number }> {
    return this.deleteGroups([group]);
  }

  deleteGroups(groups: readonly string[]): Promise<{ deleted: number }> {
    const selected = new Set(groups);
    return this.mutate((snippets) => {
      const next = snippets.filter((item) => !selected.has(snippetGroup(item)));
      return { snippets: next, result: { deleted: snippets.length - next.length } };
    });
  }

  renameGroup(group: string, name: string): Promise<{ updated: number }> {
    return this.mutate((snippets) => {
      const updated = snippets.filter((item) => snippetGroup(item) === group).length;
      if (!updated) throw new Error("分组不存在或已删除");
      if (group === name) return { snippets, result: { updated: 0 } };
      if (name === "未分类") throw new Error("「未分类」是保留分组名称");
      if (snippets.some((item) => snippetGroup(item) === name)) throw new Error("已有同名分组");
      const next = snippets.map((item) => snippetGroup(item) === group
        ? { ...item, tags: [name, ...item.tags.slice(1).filter((tag) => tag !== name)],
          updatedAt: new Date().toISOString() }
        : item);
      return { snippets: next, result: { updated } };
    });
  }
}
