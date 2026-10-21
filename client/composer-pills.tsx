import type { PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Dimensions, Platform, View } from "react-native";
import { openSnippetsFromComposer } from "./composer-navigation";
import { composerBracesGeometry } from "./composer-icon-layout";

type AgentTarget = {
  id: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
  status?: string;
};

function CenteredBracesIcon({ size, color }: PluginButtonIconProps) {
  const geometry = composerBracesGeometry(size);
  return (
    <View style={{ width: 16, height: 16 }}>
      <View style={{ position: "absolute", left: geometry.left, top: geometry.top }}>
        <Icon name="Braces" size={geometry.size} color={color} />
      </View>
    </View>
  );
}

export function registerSnippetsComposerPills(client: PluginClientContext): () => void {
  const lifetime = new AbortController();
  const pills = new Map<string, PluginButtonRegistration>();
  let unsubscribe: (() => void) | undefined;
  let release: (() => Promise<void>) | undefined;

  const remove = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  const add = (agent: AgentTarget) => {
    if (lifetime.signal.aborted || !agent.workspaceId || agent.archivedAt || agent.status === "closed") {
      remove(agent.id);
      return;
    }
    pills.get(agent.id)?.remove();
    pills.set(agent.id, client.addComposerPill({
      id: "open-snippets-composer",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        title: "打开片段库",
        icon: CenteredBracesIcon,
        label: "\u200B",
        behavior: {
          kind: "action",
          onPress: () => openSnippetsFromComposer(client, agent.workspaceId!, agent.id,
            Platform.OS !== "web", Dimensions.get("window").width),
        },
      },
    }));
  };

  void (async () => {
    const first = await client.paseo.agents.list({ subscribe: {}, page: { limit: 200 } });
    if (lifetime.signal.aborted) {
      await first.subscription.release();
      return;
    }
    release = () => first.subscription.release();
    let entries = first.entries.map((entry) => entry.agent);
    let pageInfo = first.pageInfo;
    while (pageInfo.hasMore && pageInfo.nextCursor && !lifetime.signal.aborted) {
      const page = await client.paseo.agents.list({
        page: { limit: 200, cursor: pageInfo.nextCursor },
      });
      entries = [...entries, ...page.entries.map((entry) => entry.agent)];
      pageInfo = page.pageInfo;
    }
    if (lifetime.signal.aborted) return;
    for (const agent of entries) add(agent);
    unsubscribe = first.subscription.subscribe({
      snapshot(snapshot) {
        for (const agent of snapshot.entries.map((entry) => entry.agent)) add(agent);
      },
      update(message) {
        if (message.type !== "agent_update") return;
        if (message.payload.kind === "upsert") add(message.payload.agent);
        else remove(message.payload.agentId);
      },
      error(error) {
        if (!lifetime.signal.aborted) console.error("片段 Composer 按钮订阅失败", error);
      },
    });
  })().catch((error: unknown) => {
    if (!lifetime.signal.aborted) console.error("片段 Composer 按钮初始化失败", error);
  });

  return () => {
    lifetime.abort();
    unsubscribe?.();
    if (release) void release().catch((error: unknown) => console.error("片段 Composer 订阅清理失败", error));
    for (const agentId of pills.keys()) remove(agentId);
  };
}
