import type { PaseoApi } from "@getpaseo/client";

export async function runOnVisibleWorkspaceAgents(
  paseo: PaseoApi, workspaceId: string, command: string, visibleIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(visibleIds)];
  if (!ids.length) throw new Error("当前工作区没有可见的 Agent 页面");

  const results = await Promise.allSettled(ids.map(async (id) => {
    const agent = await paseo.agents.ref(id).refresh();
    if (!agent || agent.agent.workspaceId !== workspaceId || agent.agent.status === "closed" ||
      agent.agent.archivedAt) throw new Error(`Agent 页面 ${id} 已关闭或不属于当前工作区`);
    await paseo.agents.ref(id).send(command);
  }));
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) {
    const reason = (failed[0] as PromiseRejectedResult).reason;
    throw new Error(`成功 ${results.length - failed.length} 个页面，失败 ${failed.length} 个：${String(reason)}`);
  }
  return results.length;
}
