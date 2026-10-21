import assert from "node:assert/strict";
import test from "node:test";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { composerDestination, openSnippetsFromComposer } from "../client/composer-navigation";

test("手机与紧凑 Web 打开片段页，桌面保留 Explorer 面板", () => {
  const calls: unknown[] = [];
  const client = {
    openScreen(input: unknown) { calls.push(["screen", input]); },
    openPanel(id: string, options: unknown) { calls.push(["panel", id, options]); },
  } as Pick<PluginClientContext, "openScreen" | "openPanel">;
  assert.equal(composerDestination(true, 900), "screen");
  assert.equal(composerDestination(false, 719), "screen");
  assert.equal(composerDestination(false, 720), "explorer");
  openSnippetsFromComposer(client, "ws", "agent", true, 900);
  openSnippetsFromComposer(client, "ws", "agent", false, 600);
  openSnippetsFromComposer(client, "ws", "agent", false, 900);
  assert.deepEqual(calls, [
    ["screen", { screenId: "snippets-library" }],
    ["screen", { screenId: "snippets-library" }],
    ["panel", "snippets", { workspaceId: "ws", agentId: "agent", location: "explorer" }],
  ]);
});
