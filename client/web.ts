import { Platform } from "react-native";
import { agentIdForComposer, terminalIdForInput, visibleAgentIds, workspaceFromPath,
  type AgentPageElement, type AgentPageRoot } from "./agent-pages";

type WebElement = AgentPageElement & {
  isConnected?: boolean;
  focus(): void;
  matches(selector: string): boolean;
};
type WebDocument = AgentPageRoot & {
  activeElement: WebElement | null;
  addEventListener(event: string, callback: (event: { target: unknown }) => void, capture: boolean): void;
  removeEventListener(event: string, callback: (event: { target: unknown }) => void, capture: boolean): void;
  execCommand(command: string, showUI: boolean, value: string): boolean;
};
type WebLocation = { pathname: string };

type FocusedTarget = { kind: "agent" | "terminal"; id: string };
let latest: { kind: FocusedTarget["kind"]; element: WebElement } | null = null;
let users = 0;
let cleanup: (() => void) | undefined;

function browser(): { document: WebDocument; location: WebLocation } | null {
  if (Platform.OS !== "web") return null;
  const global = globalThis as typeof globalThis & { document?: WebDocument; location?: WebLocation };
  return global.document && global.location ? { document: global.document, location: global.location } : null;
}

function capture(element: unknown): void {
  const app = browser();
  if (!app || !element || typeof element !== "object" || !("matches" in element)) return;
  const input = element as WebElement;
  if (typeof input.matches !== "function") return;
  if (input.matches("textarea[data-composer-input]")) latest = { kind: "agent", element: input };
  else if (input.matches("textarea.xterm-helper-textarea")) latest = { kind: "terminal", element: input };
}

export function observeFocus(): () => void {
  const app = browser();
  if (!app) return () => {};
  users++;
  if (!cleanup) {
    const listener = (event: { target: unknown }) => capture(event.target);
    capture(app.document.activeElement);
    app.document.addEventListener("focusin", listener, true);
    cleanup = () => app.document.removeEventListener("focusin", listener, true);
  }
  return () => {
    users--;
    if (!users) { cleanup?.(); cleanup = undefined; latest = null; }
  };
}

export function focusedPage(workspaceId: string): FocusedTarget | null {
  const app = browser();
  if (!app || !latest || latest.element.isConnected === false ||
    workspaceFromPath(app.location.pathname) !== workspaceId) return null;
  const id = latest.kind === "agent"
    ? agentIdForComposer(latest.element) : terminalIdForInput(latest.element);
  return id ? { kind: latest.kind, id } : null;
}

export function visibleWorkspaceAgents(workspaceId: string): string[] | null {
  const app = browser();
  if (!app || workspaceFromPath(app.location.pathname) !== workspaceId) return null;
  return visibleAgentIds(app.document);
}

export function pasteInFocusedComposer(text: string, workspaceId: string, agentId: string): boolean {
  const app = browser();
  const target = focusedPage(workspaceId);
  if (!app || !latest || target?.kind !== "agent" || target.id !== agentId) return false;
  const input = latest.element;
  input.focus();
  return app.document.execCommand("insertText", false, text);
}

export function relativePointer(event: { nativeEvent: { clientX: number; clientY: number }; currentTarget: unknown }): { x: number; y: number } | null {
  if (Platform.OS !== "web") return null;
  const target = event.currentTarget as { getBoundingClientRect?: () => { left: number; top: number; width: number; height: number } };
  const rect = target.getBoundingClientRect?.();
  if (!rect) return null;
  return {
    x: Math.max(4, Math.min(rect.width - 81, event.nativeEvent.clientX - rect.left + 12)),
    y: Math.max(4, Math.min(rect.height - 26, event.nativeEvent.clientY - rect.top + 11)),
  };
}
