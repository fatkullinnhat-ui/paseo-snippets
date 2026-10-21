import type { PluginClientContext } from "@getpaseo/plugin/client";

export function composerDestination(native: boolean, width: number): "screen" | "explorer" {
  return native || width < 720 ? "screen" : "explorer";
}

export function openSnippetsFromComposer(
  client: Pick<PluginClientContext, "openScreen" | "openPanel">,
  workspaceId: string, agentId: string, native: boolean, width: number,
): void {
  if (composerDestination(native, width) === "screen") {
    client.openScreen({ screenId: "snippets-library" });
    return;
  }
  client.openPanel("snippets", { workspaceId, agentId, location: "explorer" });
}
