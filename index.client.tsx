import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SnippetsPanel } from "./client/panel";
import { SnippetsScreen, SnippetsSidebarItem } from "./client/screen";
import { registerSnippetsHeaderButtons } from "./client/header-buttons";
import { registerSnippetsComposerPills } from "./client/composer-pills";

export default function contribute(client: PluginClientContext) {
  const removePanel = client.addWorkspacePanel({
    id: "snippets",
    title: "Snippets",
    icon: "Braces",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: SnippetsPanel,
  });
  const removeCommand = client.addCommandCenterItem({
    id: "open-snippets",
    title: "打开快捷命令片段",
    icon: "Braces",
    keywords: ["片段", "快捷命令", "snippets"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("snippets", { location: "explorer" });
    },
  });
  const removeScreen = client.addScreen({ id: "snippets-library", title: "片段库", Component: SnippetsScreen });
  const removeSidebar = client.addSidebarHeaderItem({
    id: "snippets-library", title: "片段", Component: SnippetsSidebarItem,
  });
  const removeHeaderButtons = registerSnippetsHeaderButtons(client);
  const removeComposerPills = registerSnippetsComposerPills(client);
  return () => {
    removeComposerPills();
    removeHeaderButtons();
    removeSidebar();
    removeScreen();
    removeCommand();
    removePanel();
  };
}
