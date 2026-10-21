import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PaseoApi } from "@getpaseo/client";
import { runOnVisibleWorkspaceAgents } from "../client/agent-actions";
import { feedbackTone } from "../client/feedback";
import { agentIdForComposer, terminalIdForInput, visibleAgentIds, workspaceFromPath,
  type AgentPageElement } from "../client/agent-pages";
import { dispatchToPage } from "../client/target-actions";
import { SnippetStore } from "../server/store";
import { groupSnippets, matchesSnippet, missingVariables, renderCommand, snippetGroup,
  sortSnippets, variablesOf } from "../shared/snippets";

test("展开菜单悬停、键盘焦点、按下与选中反馈优先级", () => {
  assert.equal(feedbackTone({ pressed: false, hovered: false, focused: false, selected: false }), "idle");
  assert.equal(feedbackTone({ pressed: false, hovered: false, focused: false, selected: true }), "selected");
  assert.equal(feedbackTone({ pressed: false, hovered: true, focused: false, selected: false }), "hover");
  assert.equal(feedbackTone({ pressed: false, hovered: false, focused: true, selected: false }), "hover");
  assert.equal(feedbackTone({ pressed: true, hovered: true, focused: true, selected: true }), "pressed");
  assert.equal(feedbackTone({ pressed: false, hovered: false, focused: false, selected: false }), "idle");
});

test("变量去重、未填写预览和原样替换", () => {
  const command = "ssh {{user}}@{{host}} -p {{port}}; echo {{user}}";
  assert.deepEqual(variablesOf(command), ["user", "host", "port"]);
  assert.equal(renderCommand(command, { user: "alice", host: "lab.local" }),
    "ssh alice@lab.local -p {{port}}; echo alice");
  assert.equal(renderCommand("echo {{x}}", { x: "a b; c" }), "echo a b; c");
  assert.deepEqual(missingVariables(command, { user: "alice", host: "lab.local", port: "  " }), ["port"]);
});

test("片段按名称、标签、命令搜索", () => {
  const item = { id: "00000000-0000-4000-8000-000000000000", name: "容器日志",
    command: "docker logs -f {{container}}", tags: ["Docker"],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  assert.equal(matchesSnippet(item, "容器"), true);
  assert.equal(matchesSnippet(item, "docker"), true);
  assert.equal(matchesSnippet(item, "logs"), true);
  assert.equal(matchesSnippet(item, "nginx"), false);
});

test("CRUD 与并发写入不会丢片段", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-snippets-"));
  try {
    const store = new SnippetStore(path.join(directory, "snippets.json"));
    const created = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      store.create({ name: `命令 ${i}`, command: `echo ${i}`, tags: ["测试", "测试"] })));
    assert.equal((await store.list()).length, 12);
    assert.deepEqual(created[0]?.tags, ["测试"]);
    const edited = await store.update(created[0]!.id, { name: "更新", command: "pwd", tags: [] });
    assert.equal(edited.name, "更新");
    assert.equal((await store.delete(edited.id)).deleted, true);
    assert.equal((await store.list()).length, 11);
    assert.equal((await store.delete(edited.id)).deleted, false);
    await assert.rejects(() => store.update(edited.id, { name: "x", command: "y", tags: [] }), /不存在/);
    assert.equal(JSON.parse(await readFile(path.join(directory, "snippets.json"), "utf8")).version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("整组删除一次性移除全部成员，保留其他组和未分类片段", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-snippets-group-"));
  try {
    const store = new SnippetStore(path.join(directory, "snippets.json"));
    await store.create({ name: "a", command: "pwd", tags: ["开发", "共享标签"] });
    await store.create({ name: "b", command: "ls", tags: ["开发"] });
    await store.create({ name: "c", command: "date", tags: ["运维", "开发"] });
    await store.create({ name: "d", command: "whoami", tags: [] });
    assert.deepEqual(await store.deleteGroup("开发"), { deleted: 2 });
    assert.deepEqual((await store.list()).map((item) => item.name), ["c", "d"]);
    assert.deepEqual(await store.deleteGroup("开发"), { deleted: 0 });
    assert.deepEqual(await store.deleteGroup("未分类"), { deleted: 1 });
    assert.deepEqual((await store.list()).map((item) => item.name), ["c"]);
    assert.equal(JSON.parse(await readFile(path.join(directory, "snippets.json"), "utf8")).snippets.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("勾选单组或多组时原子删除完整分组，不受搜索过滤影响", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-snippets-multi-"));
  try {
    const store = new SnippetStore(path.join(directory, "snippets.json"));
    await store.create({ name: "可见", command: "pwd", tags: ["开发"] });
    await store.create({ name: "搜索未显示", command: "date", tags: ["开发"] });
    await store.create({ name: "其他", command: "ls", tags: ["运维"] });
    await store.create({ name: "未分类", command: "id", tags: [] });
    assert.deepEqual(await store.deleteGroups(["开发", "开发"]), { deleted: 2 });
    assert.deepEqual((await store.list()).map((item) => item.name), ["其他", "未分类"]);
    assert.deepEqual(await store.deleteGroups(["运维", "未分类"]), { deleted: 2 });
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("编辑分组名称批量更新成员，保留其他标签并拒绝撞名", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-snippets-rename-"));
  try {
    const store = new SnippetStore(path.join(directory, "snippets.json"));
    await store.create({ name: "一", command: "pwd", tags: ["旧组", "共享"] });
    await store.create({ name: "二", command: "ls", tags: ["旧组"] });
    await store.create({ name: "三", command: "date", tags: ["已有"] });
    assert.deepEqual(await store.renameGroup("旧组", "新组"), { updated: 2 });
    assert.deepEqual((await store.list()).map((item) => item.tags),
      [["新组", "共享"], ["新组"], ["已有"]]);
    await assert.rejects(() => store.renameGroup("新组", "已有"), /同名/);
    await assert.rejects(() => store.renameGroup("新组", "未分类"), /保留/);
    await assert.rejects(() => store.renameGroup("不存在", "名字"), /不存在/);
    assert.deepEqual(await store.renameGroup("新组", "新组"), { updated: 0 });
    await store.create({ name: "四", command: "id", tags: [] });
    assert.deepEqual(await store.renameGroup("未分类", "归档"), { updated: 1 });
    assert.deepEqual((await store.list())[3]?.tags, ["归档"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("同时改名与删除分组按顺序写入，其他片段不丢失", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-snippets-queue-"));
  try {
    const store = new SnippetStore(path.join(directory, "snippets.json"));
    await store.create({ name: "一", command: "pwd", tags: ["开发"] });
    await store.create({ name: "二", command: "ls", tags: ["运维"] });
    await Promise.all([store.renameGroup("开发", "新开发"), store.deleteGroups(["运维"]),
      store.create({ name: "三", command: "id", tags: ["保留"] })]);
    assert.deepEqual((await store.list()).map((item) => item.tags[0]), ["新开发", "保留"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("损坏 JSON 原样保留，拒绝覆盖", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "paseo-snippets-"));
  const filename = path.join(directory, "snippets.json");
  try {
    await writeFile(filename, "{broken", "utf8");
    const store = new SnippetStore(filename);
    await assert.rejects(() => store.list(), /原文件未修改/);
    await assert.rejects(() => store.create({ name: "test", command: "pwd", tags: [] }), /原文件未修改/);
    await assert.rejects(() => store.deleteGroup("开发"), /原文件未修改/);
    assert.equal(await readFile(filename, "utf8"), "{broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("所有页面仅覆盖可见 Agent，不触碰终端或隐藏会话", async () => {
  const writes: string[] = [];
  const paseo = { terminals: {
    list: async () => { throw new Error("不应读取终端"); },
  }, agents: {
    list: async () => { throw new Error("不应列出所有 Agent"); },
    ref: (id: string) => ({
      refresh: async () => ({ agent: { id, workspaceId: "current", status: "idle", archivedAt: null } }),
      send: async (command: string) => { writes.push(`${id}:${command}`); },
    }),
  } } as unknown as PaseoApi;
  assert.equal(await runOnVisibleWorkspaceAgents(paseo, "current", "pwd", ["agent1", "agent1"]), 1);
  assert.deepEqual(writes, ["agent1:pwd"]);
});

test("没有 Agent 时拒绝全页面运行", async () => {
  await assert.rejects(() => runOnVisibleWorkspaceAgents({} as PaseoApi, "empty", "pwd", []), /没有可见/);
});

test("可见页面汇报部分失败，跨工作区目标不发送", async () => {
  const sent: string[] = [];
  const paseo = { agents: {
    ref: (id: string) => ({
      refresh: async () => ({ agent: { id, workspaceId: id === "other" ? "elsewhere" : "work",
        status: "idle", archivedAt: null } }),
      send: async (command: string) => {
        sent.push(`${id}:${command}`);
        if (id === "b") throw new Error("agent unavailable");
      },
    }),
  } } as unknown as PaseoApi;
  await assert.rejects(() => runOnVisibleWorkspaceAgents(paseo, "work", "echo hi", ["a", "b"]),
    /成功 1 个页面，失败 1 个/);
  assert.deepEqual(sent, ["a:echo hi", "b:echo hi"]);
  sent.length = 0;
  await assert.rejects(() => runOnVisibleWorkspaceAgents(paseo, "work", "echo hi", ["other"]), /失败 1 个/);
  assert.deepEqual(sent, []);
});

test("可见标签与光标定位：排除隐藏页、非 Agent 页和旧焦点", () => {
  const tab = (id: string, kind = "agent", visible = true): AgentPageElement => ({
    getAttribute: (name) => name === "data-testid" ? `workspace-tab-${kind}_${id}` : null,
    getClientRects: () => ({ length: visible ? 1 : 0 }),
    querySelector: () => null, closest: () => null,
  });
  const pane = (id: string | null, visible = true, kind = "agent"): AgentPageElement => ({
    getAttribute: () => null,
    getClientRects: () => ({ length: visible ? 1 : 0 }),
    querySelector: (selector) => selector.includes(`workspace-tab-${kind}_`) && id ? tab(id, kind) : null,
    closest: () => null,
  });
  const active = pane("a");
  const other = pane("b");
  const hidden = pane("hidden", false);
  assert.deepEqual(visibleAgentIds({ querySelectorAll: () => [active, other, hidden, pane(null)] }), ["a", "b"]);
  const composer = (owner: AgentPageElement, visible: boolean): AgentPageElement => ({
    getAttribute: () => null, getClientRects: () => ({ length: visible ? 1 : 0 }),
    querySelector: () => null, closest: () => owner,
  });
  assert.equal(agentIdForComposer(composer(other, true)), "b");
  assert.equal(agentIdForComposer(composer(hidden, true)), null);
  assert.equal(agentIdForComposer(composer(active, false)), null);
  assert.equal(terminalIdForInput(composer(pane("term-1", true, "terminal"), true)), "term-1");
  assert.equal(terminalIdForInput(composer(pane("term-1", false, "terminal"), true)), null);
  assert.equal(terminalIdForInput(composer(active, true)), null);
  assert.equal(workspaceFromPath("/h/srv/workspace/work%20a"), "work a");
  assert.equal(workspaceFromPath("/h/srv/agent/a"), null);
});

test("单窗口 Agent Run/Paste 仅操作选中的对话", async () => {
  const calls: string[] = [];
  const paseo = { agents: { ref: (id: string) => ({
    refresh: async () => ({ agent: { id, workspaceId: "current", status: "idle", archivedAt: null } }),
    send: async (text: string) => { calls.push(`send:${id}:${text}`); },
  }) } } as unknown as PaseoApi;
  const target = { kind: "agent" as const, id: "a" };
  assert.match(await dispatchToPage(paseo, "current", "任意内容 ; {{literal}}", true,
    target, () => target, () => { throw new Error("不应 Paste"); }), /已发送/);
  assert.deepEqual(calls, ["send:a:任意内容 ; {{literal}}"]);
  assert.match(await dispatchToPage(paseo, "current", "draft", false,
    target, () => target, () => { calls.push("paste:draft"); return true; }), /未发送/);
  assert.deepEqual(calls, ["send:a:任意内容 ; {{literal}}", "paste:draft"]);
  await assert.rejects(() => dispatchToPage(paseo, "current", "wrong", true,
    target, () => ({ kind: "agent", id: "b" }), () => true), /已切换/);
  assert.equal(calls.length, 2);
});

test("单窗口终端 Run 写入并 Enter，Paste 只写入", async () => {
  const calls: string[] = [];
  const paseo = { terminals: { ref: (id: string) => ({
    refresh: async () => ({ id, workspaceId: "current" }),
    write: (text: string) => { calls.push(`write:${id}:${text}`); return text.length; },
    sendKeys: (keys: string[]) => { calls.push(`keys:${keys.join(",")}`); return keys.length; },
  }) } } as unknown as PaseoApi;
  const target = { kind: "terminal" as const, id: "term-1" };
  assert.match(await dispatchToPage(paseo, "current", "echo 你好", false,
    target, () => target, () => false), /不追加 Enter/);
  assert.deepEqual(calls, ["write:term-1:echo 你好"]);
  assert.match(await dispatchToPage(paseo, "current", "pwd", true,
    target, () => target, () => false), /已发送/);
  assert.deepEqual(calls, ["write:term-1:echo 你好", "write:term-1:pwd", "keys:Enter"]);
  await assert.rejects(() => dispatchToPage(paseo, "other", "ignored", true,
    target, () => target, () => false), /不属于/);
  assert.equal(calls.length, 3);
});

test("四种排序与旧版标签分组兼容", () => {
  const base = { command: "pwd", updatedAt: "2026-01-01T00:00:00.000Z" };
  const a = { ...base, id: "a", name: "Alpha", tags: ["日常", "旧标签"], createdAt: "2026-01-01T00:00:00.000Z" };
  const b = { ...base, id: "b", name: "Beta", tags: [], createdAt: "2026-02-01T00:00:00.000Z" };
  assert.equal(snippetGroup(a), "日常");
  assert.equal(snippetGroup(b), "未分类");
  assert.deepEqual(sortSnippets([b, a], "name-asc").map((s) => s.id), ["a", "b"]);
  assert.deepEqual(sortSnippets([a, b], "name-desc").map((s) => s.id), ["b", "a"]);
  assert.deepEqual(sortSnippets([a, b], "newest").map((s) => s.id), ["b", "a"]);
  assert.deepEqual(sortSnippets([a, b], "oldest").map((s) => s.id), ["a", "b"]);
});

test("A↕ 排序同时改变分组和组内片段顺序，相同名称仍能按时间排序", () => {
  const item = (id: string, group: string, date: string) => ({ id, name: "同名",
    command: "pwd", tags: [group], createdAt: date, updatedAt: date });
  const items = [
    item("alpha-old", "Alpha", "2026-01-01T00:00:00.000Z"),
    item("zulu-new", "Zulu", "2026-04-01T00:00:00.000Z"),
    item("alpha-new", "Alpha", "2026-03-01T00:00:00.000Z"),
    item("zulu-old", "Zulu", "2026-02-01T00:00:00.000Z"),
  ];
  assert.deepEqual(groupSnippets(items, "name-asc").map(([name]) => name), ["Alpha", "Zulu"]);
  assert.deepEqual(groupSnippets(items, "name-desc").map(([name]) => name), ["Zulu", "Alpha"]);
  assert.deepEqual(groupSnippets(items, "newest").map(([name, members]) =>
    [name, members.map((member) => member.id)]),
  [["Zulu", ["zulu-new", "zulu-old"]], ["Alpha", ["alpha-new", "alpha-old"]]]);
  assert.deepEqual(groupSnippets(items, "oldest").map(([name, members]) =>
    [name, members.map((member) => member.id)]),
  [["Alpha", ["alpha-old", "alpha-new"]], ["Zulu", ["zulu-old", "zulu-new"]]]);
  assert.deepEqual(items.map((entry) => entry.id),
    ["alpha-old", "zulu-new", "alpha-new", "zulu-old"]);
});
