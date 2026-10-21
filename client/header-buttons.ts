import type { PluginClientContext, PluginButtonRegistration } from "@getpaseo/plugin/client";

export function registerSnippetsHeaderButtons(client: PluginClientContext): () => void {
  const lifetime = new AbortController();
  const buttons = new Map<string, PluginButtonRegistration>();
  let unsubscribe: (() => void) | undefined;
  let release: (() => Promise<void>) | undefined;

  const add = (workspaceId: string) => {
    if (lifetime.signal.aborted || buttons.has(workspaceId)) return;
    buttons.set(workspaceId, client.addHeaderButton({
      id: "open-snippets-header",
      workspaceId,
      button: {
        title: "打开片段库",
        icon: "Braces",
        behavior: { kind: "action", onPress: () => client.openPanel("snippets", {
          workspaceId, location: "explorer",
        }) },
      },
    }));
  };
  const remove = (workspaceId: string) => {
    buttons.get(workspaceId)?.remove();
    buttons.delete(workspaceId);
  };
  const replace = (ids: readonly string[]) => {
    const current = new Set(ids);
    for (const id of buttons.keys()) if (!current.has(id)) remove(id);
    for (const id of current) add(id);
  };

  void (async () => {
    const first = await client.paseo.workspaces.list({ subscribe: {} });
    if (lifetime.signal.aborted) {
      await first.subscription.release();
      return;
    }
    release = () => first.subscription.release();
    const initial = first.entries.map((workspace) => workspace.id);
    let pageInfo = first.pageInfo;
    while (pageInfo.hasMore && pageInfo.nextCursor && !lifetime.signal.aborted) {
      const page = await client.paseo.workspaces.list({
        page: { limit: 200, cursor: pageInfo.nextCursor },
      });
      initial.push(...page.entries.map((workspace) => workspace.id));
      pageInfo = page.pageInfo;
    }
    if (lifetime.signal.aborted) return;
    replace(initial);
    unsubscribe = first.subscription.subscribe({
      snapshot(snapshot) { replace(snapshot.entries.map((workspace) => workspace.id)); },
      update(message) {
        if (message.type !== "workspace_update") return;
        if (message.payload.kind === "upsert") add(message.payload.workspace.id);
        else remove(message.payload.id);
      },
      error(error) { if (!lifetime.signal.aborted) console.error("片段按钮订阅失败", error); },
    });
  })().catch((error: unknown) => {
    if (!lifetime.signal.aborted) console.error("片段按钮初始化失败", error);
  });

  return () => {
    lifetime.abort();
    unsubscribe?.();
    if (release) void release().catch((error: unknown) => console.error("片段订阅清理失败", error));
    for (const id of buttons.keys()) remove(id);
  };
}
