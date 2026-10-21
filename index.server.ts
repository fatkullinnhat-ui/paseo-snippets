import type { PluginServerContext } from "@getpaseo/plugin/server";
import { SnippetStore } from "./server/store";
import { createSnippet, deleteSnippet, deleteSnippetGroup, deleteSnippetGroups, listSnippets,
  renameSnippetGroup, updateSnippet } from "./shared/snippets";

export default function contribute(server: PluginServerContext) {
  const store = new SnippetStore();

  server.handle(listSnippets, async () => ({ snippets: await store.list() }));
  server.handle(createSnippet, (input) => store.create(input));
  server.handle(updateSnippet, ({ id, ...draft }) => store.update(id, draft));
  server.handle(deleteSnippet, ({ id }) => store.delete(id));
  server.handle(deleteSnippetGroup, ({ group }) => store.deleteGroup(group));
  server.handle(deleteSnippetGroups, ({ groups }) => store.deleteGroups(groups));
  server.handle(renameSnippetGroup, ({ group, name }) => store.renameGroup(group, name));
  return () => {};
}
