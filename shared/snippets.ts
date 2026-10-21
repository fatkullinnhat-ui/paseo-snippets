import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const snippetDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  command: z.string().min(1).max(65_536),
  tags: z.array(z.string().trim().min(1).max(40)).max(32),
});

export const snippetSchema = snippetDraftSchema.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const snippetFileSchema = z.object({
  version: z.literal(1),
  snippets: z.array(snippetSchema),
});

export type Snippet = z.output<typeof snippetSchema>;
export type SnippetDraft = z.input<typeof snippetDraftSchema>;

export const listSnippets = defineRpc({
  name: "snippets.list",
  input: z.object({}),
  output: z.object({ snippets: z.array(snippetSchema) }),
});

export const createSnippet = defineRpc({
  name: "snippets.create",
  input: snippetDraftSchema,
  output: snippetSchema,
});

export const updateSnippet = defineRpc({
  name: "snippets.update",
  input: snippetDraftSchema.extend({ id: z.uuid() }),
  output: snippetSchema,
});

export const deleteSnippet = defineRpc({
  name: "snippets.delete",
  input: z.object({ id: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
});

export const deleteSnippetGroup = defineRpc({
  name: "snippets.delete-group",
  input: z.object({ group: z.string().trim().min(1).max(40) }),
  output: z.object({ deleted: z.number().int().nonnegative() }),
});

export const deleteSnippetGroups = defineRpc({
  name: "snippets.delete-groups",
  input: z.object({ groups: z.array(z.string().trim().min(1).max(40)).min(1).max(256) }),
  output: z.object({ deleted: z.number().int().nonnegative() }),
});

export const renameSnippetGroup = defineRpc({
  name: "snippets.rename-group",
  input: z.object({
    group: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(40),
  }),
  output: z.object({ updated: z.number().int().nonnegative() }),
});

const variablePattern = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export function variablesOf(command: string): string[] {
  return [...new Set([...command.matchAll(variablePattern)].map((match) => match[1]!))];
}

export function renderCommand(command: string, values: Record<string, string>): string {
  return command.replace(variablePattern, (token, key: string) =>
    Object.hasOwn(values, key) ? values[key]! : token,
  );
}

export function missingVariables(command: string, values: Record<string, string>): string[] {
  return variablesOf(command).filter((key) => !values[key]?.trim());
}

export function matchesSnippet(snippet: Snippet, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  return !query || [snippet.name, snippet.command, ...snippet.tags]
    .some((text) => text.toLocaleLowerCase().includes(query));
}

export type SortOrder = "name-asc" | "name-desc" | "newest" | "oldest";

export function sortSnippets(items: readonly Snippet[], order: SortOrder): Snippet[] {
  return [...items].sort((a, b) => {
    if (order === "name-asc") return a.name.localeCompare(b.name, "zh-CN");
    if (order === "name-desc") return b.name.localeCompare(a.name, "zh-CN");
    const byDate = a.createdAt.localeCompare(b.createdAt);
    return order === "newest" ? -byDate : byDate;
  });
}

export function groupSnippets(items: readonly Snippet[], order: SortOrder): Array<[string, Snippet[]]> {
  const groups = new Map<string, Snippet[]>();
  for (const snippet of sortSnippets(items, order)) {
    const group = snippetGroup(snippet);
    const members = groups.get(group) ?? [];
    members.push(snippet);
    groups.set(group, members);
  }
  return [...groups.entries()].sort(([nameA, membersA], [nameB, membersB]) => {
    if (order === "name-asc" || order === "name-desc") {
      if (nameA === "未分类") return 1;
      if (nameB === "未分类") return -1;
      return order === "name-asc" ? nameA.localeCompare(nameB, "zh-CN")
        : nameB.localeCompare(nameA, "zh-CN");
    }
    const dateA = membersA[0]!.createdAt;
    const dateB = membersB[0]!.createdAt;
    const byDate = order === "newest" ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
    return byDate || nameA.localeCompare(nameB, "zh-CN");
  });
}

export function snippetGroup(snippet: Snippet): string {
  return snippet.tags[0] || "未分类";
}
