import type { PaseoApi } from "@getpaseo/client";

export type PageTarget = { kind: "agent" | "terminal"; id: string };

export async function dispatchToPage(
  paseo: PaseoApi, workspaceId: string, text: string, execute: boolean,
  target: PageTarget, currentTarget: () => PageTarget | null, pasteToAgent: () => boolean,
): Promise<string> {
  const stillFocused = () => {
    const current = currentTarget();
    return current?.kind === target.kind && current.id === target.id;
  };

  if (target.kind === "terminal") {
    const terminal = paseo.terminals.ref(target.id);
    const entry = await terminal.refresh();
    if (!entry || entry.workspaceId !== workspaceId) throw new Error("当前终端不可用或不属于这个工作区");
    if (!stillFocused()) throw new Error("终端窗口已切换，请重新选择");
    terminal.write(text);
    if (execute) terminal.sendKeys(["Enter"]);
    return execute ? "已发送到当前终端" : "已输入到当前终端（不追加 Enter）";
  }

  const agent = await paseo.agents.ref(target.id).refresh();
  if (!agent || agent.agent.workspaceId !== workspaceId || agent.agent.status === "closed" ||
    agent.agent.archivedAt) throw new Error("当前 Agent 对话不可用或不属于这个工作区");
  if (!stillFocused()) throw new Error("当前 Agent 页面已切换，请重新选择");
  if (!execute) {
    if (!pasteToAgent()) throw new Error("无法写入当前对话输入框");
    return "已粘贴到当前 Agent 对话，未发送";
  }
  await paseo.agents.ref(target.id).send(text);
  return "已发送到当前 Agent 对话";
}
