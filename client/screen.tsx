import type { PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SnippetsPanel } from "./panel";

export function SnippetsScreen({ theme, layout }: PluginScreenProps) {
  return <SnippetsPanel theme={theme} layout={layout} mode="library" />;
}

export function SnippetsSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="Braces" label="片段" active={currentScreen?.screenId === "snippets-library"}
    onPress={() => openScreen({ screenId: "snippets-library" })} />;
}
