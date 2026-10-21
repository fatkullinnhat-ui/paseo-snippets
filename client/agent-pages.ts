export interface AgentPageElement {
  getAttribute(name: string): string | null;
  getClientRects(): { length: number };
  querySelector(selector: string): AgentPageElement | null;
  closest(selector: string): AgentPageElement | null;
}

export interface AgentPageRoot {
  querySelectorAll(selector: string): ArrayLike<AgentPageElement>;
}

const paneSelector = '[data-testid^="workspace-pane-"]';
const selectedAgentSelector = '[data-testid^="workspace-tab-agent_"][aria-selected="true"]';
const agentPrefix = "workspace-tab-agent_";
const selectedTerminalSelector = '[data-testid^="workspace-tab-terminal_"][aria-selected="true"]';
const terminalPrefix = "workspace-tab-terminal_";

export function workspaceFromPath(pathname: string): string | null {
  const match = /\/workspace\/([^/]+)/.exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]!); } catch { return null; }
}

export function isVisible(element: AgentPageElement): boolean {
  return element.getClientRects().length > 0;
}

function selectedId(pane: AgentPageElement, selector: string, prefix: string): string | null {
  if (!isVisible(pane)) return null;
  const selected = pane.querySelector(selector);
  if (!selected || !isVisible(selected)) return null;
  const testId = selected.getAttribute("data-testid");
  return testId?.startsWith(prefix) ? testId.slice(prefix.length) || null : null;
}

function selectedAgentId(pane: AgentPageElement): string | null {
  return selectedId(pane, selectedAgentSelector, agentPrefix);
}

export function agentIdForComposer(input: AgentPageElement): string | null {
  if (!isVisible(input)) return null;
  const pane = input.closest(paneSelector);
  return pane ? selectedAgentId(pane) : null;
}

export function terminalIdForInput(input: AgentPageElement): string | null {
  const pane = input.closest(paneSelector);
  return pane ? selectedId(pane, selectedTerminalSelector, terminalPrefix) : null;
}

export function visibleAgentIds(root: AgentPageRoot): string[] {
  const ids = new Set<string>();
  for (const pane of Array.from(root.querySelectorAll(paneSelector))) {
    const id = selectedAgentId(pane);
    if (id) ids.add(id);
  }
  return [...ids];
}
