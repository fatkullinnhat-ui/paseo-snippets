import { usePaseo, useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, TextInput, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { runOnVisibleWorkspaceAgents } from "./agent-actions";
import { feedbackTone } from "./feedback";
import { dispatchToPage } from "./target-actions";
import { focusedPage, observeFocus, pasteInFocusedComposer, relativePointer, visibleWorkspaceAgents } from "./web";
import {
  createSnippet, deleteSnippet, deleteSnippetGroups, listSnippets, matchesSnippet, missingVariables,
  groupSnippets, renameSnippetGroup, renderCommand, snippetGroup, updateSnippet, variablesOf,
  type Snippet, type SortOrder,
} from "../shared/snippets";

type Theme = PluginWorkspacePanelProps["theme"];
export type SnippetsMode = "workspace" | "library";
type Action = "run" | "paste" | "all" | "copy";
type Point = { x: number; y: number };
const orders: { value: SortOrder; label: string; icon: string }[] = [
  { value: "name-asc", label: "名称 A–Z", icon: "A" },
  { value: "name-desc", label: "名称 Z–A", icon: "Z" },
  { value: "newest", label: "最新优先", icon: "↓" },
  { value: "oldest", label: "最旧优先", icon: "↑" },
];
const actionLabel: Record<Action, string> = {
  run: "Run", paste: "Paste", all: "在所有页面运行", copy: "复制",
};

function Tap({ label, onPress, theme, disabled = false, accent = false, danger = false, children }: {
  label: string; onPress: () => void; theme: Theme; disabled?: boolean;
  accent?: boolean; danger?: boolean; children?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
      onPress={(event) => { event.stopPropagation(); onPress(); }}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => {
        const tone = feedbackTone({ pressed, hovered, focused, selected: false });
        return { minHeight: 34, paddingHorizontal: 9, borderRadius: 7, alignItems: "center",
          justifyContent: "center", borderWidth: 1,
          borderColor: tone === "idle" ? theme.colors.surface2 : theme.colors.accent,
          backgroundColor: tone === "idle" ? theme.colors.surface2 : theme.colors.surface1,
          opacity: disabled ? 0.45 : 1 };
      }}>
      {children ?? <Text style={{ color: danger ? theme.colors.statusDanger : accent
        ? theme.colors.accent : theme.colors.foreground, fontSize: 12, fontWeight: "600",
        letterSpacing: 0.15 }}>{label}</Text>}
    </Pressable>
  );
}

function FeedbackRow({ label, onPress, theme, selected = false, danger = false,
  base = "surface2", style, children }: {
  label: string; onPress: () => void; theme: Theme; selected?: boolean;
  danger?: boolean; base?: "surface1" | "surface2"; style?: ViewStyle;
  children: (state: { color: string; active: boolean; pressed: boolean }) => React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const tone = (pressed: boolean) => feedbackTone({ pressed, hovered, focused, selected });
  const border = danger ? theme.colors.statusDanger : theme.colors.accent;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => {
        const state = tone(pressed);
        return [{ minHeight: 38, borderRadius: 7, borderWidth: 1,
          borderColor: state === "idle" ? theme.colors[base] : border,
          backgroundColor: state === "pressed" && !danger ? theme.colors.accent
            : state === "idle" ? theme.colors[base]
            : theme.colors[base === "surface1" ? "surface2" : "surface1"] }, style];
      }}>
      {({ pressed }) => {
        const state = tone(pressed);
        return children({ pressed, active: state !== "idle",
          color: state === "pressed" && !danger ? theme.colors.accentForeground
            : danger ? theme.colors.statusDanger
            : state === "idle" ? theme.colors.foreground : theme.colors.accent });
      }}
    </Pressable>
  );
}

function Input({ value, onChange, placeholder, theme, multiline = false, autoFocus = false }: {
  value: string; onChange: (value: string) => void; placeholder: string;
  theme: Theme; multiline?: boolean; autoFocus?: boolean;
}) {
  return (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted} autoCapitalize="none" autoCorrect={false}
      autoFocus={autoFocus} multiline={multiline}
      style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border, borderWidth: 1, borderRadius: 9, fontSize: 13,
        paddingHorizontal: 12, paddingVertical: 10, minHeight: multiline ? 176 : 42,
        textAlignVertical: multiline ? "top" : "center" }} />
  );
}

export function SnippetsPanel({ workspaceId: workspaceIdProp, theme, layout, mode = "workspace" }: Pick<PluginWorkspacePanelProps, "theme" | "layout"> & { workspaceId?: string; mode?: SnippetsMode }) {
  const workspaceId = workspaceIdProp ?? "";
  const paseo = usePaseo();
  const libraryMode = mode === "library" || layout.compact;
  const toast = useToast();
  const list = useRpc(listSnippets);
  const create = useRpc(createSnippet);
  const update = useRpc(updateSnippet);
  const remove = useRpc(deleteSnippet);
  const removeGroups = useRpc(deleteSnippetGroups);
  const renameGroup = useRpc(renameSnippetGroup);
  const query = useQuery({ queryKey: ["paseo-snippets", "list"], queryFn: () => list({}), refetchInterval: 10_000 });

  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [order, setOrder] = useState<SortOrder>("name-asc");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [selectingGroups, setSelectingGroups] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [group, setGroup] = useState("");
  const [extraTags, setExtraTags] = useState<string[]>([]);
  const [groupChoices, setGroupChoices] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [mouse, setMouse] = useState<Point | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pending, setPending] = useState<{ id: string; action: Action } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const snippets = query.data?.snippets ?? [];
  const filtered = useMemo(() => snippets.filter((s) => matchesSnippet(s, search)), [snippets, search]);
  const groups = useMemo(() => groupSnippets(filtered, order), [filtered, order]);
  const allGroups = useMemo(() => {
    const map = new Map<string, Snippet[]>();
    for (const snippet of snippets) {
      const key = snippetGroup(snippet);
      map.set(key, [...(map.get(key) ?? []), snippet]);
    }
    return [...map.entries()].sort(([a], [b]) => a === "未分类" ? 1 : b === "未分类" ? -1
      : a.localeCompare(b, "zh-CN"));
  }, [snippets]);
  const selectedTotal = allGroups.reduce((count, [groupName, items]) =>
    count + (selectedGroups.includes(groupName) ? items.length : 0), 0);
  const groupNames = useMemo(() => [...new Set(snippets.map(snippetGroup))]
    .filter((item) => item !== "未分类"), [snippets]);
  const pad = layout.compact ? 11 : 15;

  useEffect(() => { if (!libraryMode) return observeFocus(); }, [libraryMode]);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  function hover(id: string): void {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHoveredId(id);
  }

  function leave(id: string): void {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setHoveredId((current) => current === id ? null : current);
      setMouse(null);
    }, 150);
  }

  async function sendToFocusedPage(full: string, execute: boolean): Promise<string> {
    const target = focusedPage(workspaceId);
    if (!target) throw new Error("请先将光标放在当前可见 Agent 对话或终端输入区");
    return dispatchToPage(paseo, workspaceId, full, execute, target,
      () => focusedPage(workspaceId), () => pasteInFocusedComposer(full, workspaceId, target.id));
  }

  function beginEdit(snippet?: Snippet, fromGroup = false): void {
    if (!fromGroup) setEditingGroup(null);
    setEditingId(snippet?.id ?? "new");
    setName(snippet?.name ?? "");
    setCommand(snippet?.command ?? "");
    setGroup(snippet?.tags[0] ?? "");
    setExtraTags(snippet?.tags.slice(1) ?? []);
    setGroupChoices(false);
    setMenuId(null);
    setError("");
  }

  function openGroupEditor(groupName: string): void {
    setEditingGroup(groupName);
    setGroupDraft(groupName);
    setMenuId(null);
    setError("");
  }

  async function saveGroupName(): Promise<void> {
    if (!editingGroup || busy || !groupDraft.trim()) return;
    setBusy(true);
    setError("");
    try {
      const name = groupDraft.trim();
      const { updated } = await renameGroup({ group: editingGroup, name });
      await query.refetch();
      setEditingGroup(name);
      toast.show(`已修改 ${updated} 个片段的分组`, { variant: "success" });
    } catch (cause) { setError(`修改分组失败：${String(cause)}`); }
    finally { setBusy(false); }
  }

  async function save(): Promise<void> {
    if (!editingId || busy) return;
    setBusy(true);
    setError("");
    try {
      const first = group.trim();
      const tags = [...new Set([...(first ? [first] : []), ...extraTags.filter((t) => t !== first)])];
      const draft = { name: name.trim(), command, tags };
      if (editingId === "new") await create(draft);
      else await update({ id: editingId, ...draft });
      await query.refetch();
      setEditingId(null);
      toast.show("片段已保存", { variant: "success" });
    } catch (cause) { setError(`保存失败：${String(cause)}`); }
    finally { setBusy(false); }
  }

  async function erase(id: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await remove({ id });
      await query.refetch();
      setMenuId(null);
      setConfirmDelete(null);
      toast.show("片段已删除", { variant: "success" });
    } catch (cause) { setError(`删除失败：${String(cause)}`); }
    finally { setBusy(false); }
  }

  async function eraseGroups(): Promise<void> {
    if (busy || !selectedGroups.length) return;
    setBusy(true);
    setError("");
    try {
      const { deleted } = await removeGroups({ groups: selectedGroups });
      await query.refetch();
      setSelectingGroups(false);
      setSelectedGroups([]);
      setConfirmBulkDelete(false);
      setMenuId(null);
      setPending(null);
      toast.show(`已删除 ${deleted} 个片段`, { variant: "success" });
    } catch (cause) { setError(`删除分组失败：${String(cause)}`); }
    finally { setBusy(false); }
  }

  function toggleGroupSelection(groupName: string): void {
    setSelectedGroups((current) => current.includes(groupName)
      ? current.filter((name) => name !== groupName) : [...current, groupName]);
    setConfirmBulkDelete(false);
  }

  async function perform(snippet: Snippet, action: Action, substitutions: Record<string, string>): Promise<void> {
    if (libraryMode && action !== "copy") { setError("手机片段库只能管理和复制片段"); return; }
    if (missingVariables(snippet.command, substitutions).length) {
      setError("请先填写所有变量"); return;
    }
    const full = renderCommand(snippet.command, substitutions);
    setBusy(true);
    setError("");
    try {
      if (action === "copy") {
        await copyText(full);
        toast.show("已复制", { variant: "success" });
      } else if (action === "all") {
        const ids = visibleWorkspaceAgents(workspaceId);
        if (!ids) throw new Error("无法识别当前工作区的可见页面；此操作仅支持桌面/Web 客户端");
        const count = await runOnVisibleWorkspaceAgents(paseo, workspaceId, full, ids);
        toast.show(`已发送至 ${count} 个 Agent 对话`, { variant: "success" });
      } else if (action === "run" || action === "paste") {
        toast.show(await sendToFocusedPage(full, action === "run"), { variant: "success" });
      }
      setPending(null);
    } catch (cause) { setError(`${actionLabel[action]}失败：${String(cause)}`); }
    finally { setBusy(false); }
  }

  function choose(snippet: Snippet, action: Action): void {
    setMenuId(null);
    setError("");
    if (!variablesOf(snippet.command).length) void perform(snippet, action, {});
    else { setPending({ id: snippet.id, action }); setValues({}); }
  }

  const menuRow = (label: string, onPress: () => void, danger = false, selected = false) => (
    <FeedbackRow label={label} onPress={onPress} theme={theme} danger={danger} selected={selected}
      style={{ paddingHorizontal: 11, justifyContent: "center" }}>
      {({ color }) => <Text style={{ color, fontSize: 12, fontWeight: "600",
        letterSpacing: 0.15 }}>{label}</Text>}
    </FeedbackRow>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      {editingId !== null ? (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: pad, gap: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="返回片段列表" onPress={() => setEditingId(null)}>
              <Icon name="ArrowLeft" size={20} color={theme.colors.foregroundMuted} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.foreground, fontWeight: "700", fontSize: 14 }}>
                {editingId === "new" ? "新建片段" : "编辑片段"}</Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>本地片段库</Text>
            </View>
            <Tap label="保存" onPress={() => { void save(); }} theme={theme} accent
              disabled={busy || !name.trim() || !command.trim()} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: pad, paddingTop: 20, gap: 12 }}>
            {!!error && <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{error}</Text>}
            <Input value={name} onChange={setName} placeholder="片段名称" theme={theme} />
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1 }}><Input value={group} onChange={setGroup} placeholder="分组（可输入新分组）" theme={theme} /></View>
              <Pressable accessibilityRole="button" accessibilityLabel="选择已有分组" onPress={() => setGroupChoices(!groupChoices)}
                style={{ position: "absolute", right: 0, width: 39, height: 42,
                  alignItems: "center", justifyContent: "center" }}>
                <Icon name="ChevronDown" size={17} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
            {groupChoices && groupNames.length > 0 && (
              <View style={{ backgroundColor: theme.colors.surface2, borderRadius: 8, padding: 4 }}>
                {groupNames.map((item) => <View key={item}>{menuRow(item,
                  () => { setGroup(item); setGroupChoices(false); }, false, group === item)}</View>)}
              </View>
            )}
            <Input value={command} onChange={setCommand} placeholder="脚本 *\n\n输入 Shell 命令或多行脚本…"
              theme={theme} multiline />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
              支持 {'{{变量}}'}，使用前填写；脚本原样保存。</Text>
          </ScrollView>
        </View>
      ) : editingGroup !== null ? (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: pad, gap: 10,
            borderBottomWidth: 1, borderColor: theme.colors.border }}>
            <Pressable accessibilityRole="button" accessibilityLabel="返回片段列表"
              onPress={() => { setEditingGroup(null); setError(""); }}>
              <Icon name="ArrowLeft" size={20} color={theme.colors.foregroundMuted} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.foreground, fontWeight: "700", fontSize: 14 }}>编辑分组</Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                共 {snippets.filter((item) => snippetGroup(item) === editingGroup).length} 个片段
              </Text>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: pad, gap: 12 }}>
            {!!error && <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{error}</Text>}
            <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "600", fontSize: 12 }}>分组名称</Text>
            <Input value={groupDraft} onChange={setGroupDraft} placeholder="输入分组名称" theme={theme} />
            <Tap label="保存分组名称" onPress={() => { void saveGroupName(); }} theme={theme} accent
              disabled={busy || !groupDraft.trim() || groupDraft.trim() === editingGroup} />
            <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "600", fontSize: 12, marginTop: 8 }}>
              分组内全部片段
            </Text>
            {snippets.filter((item) => snippetGroup(item) === editingGroup).map((snippet) => (
              <FeedbackRow key={snippet.id} label={`编辑 ${snippet.name}`}
                onPress={() => beginEdit(snippet, true)} theme={theme} base="surface1"
                style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8 }}>
                {({ color, active, pressed }) => <>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color, fontWeight: "600", fontSize: 12 }}>
                      {snippet.name}
                    </Text>
                    <Text numberOfLines={1} style={{ color: pressed ? theme.colors.accentForeground
                      : theme.colors.foregroundMuted, fontFamily: "monospace", fontWeight: "700", fontSize: 11 }}>
                      {snippet.command}
                    </Text>
                  </View>
                  <Icon name="Pencil" size={15} color={active ? color : theme.colors.foregroundMuted} />
                </>}
              </FeedbackRow>
            ))}
          </ScrollView>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: pad,
            minHeight: 46, borderBottomWidth: 1, borderColor: theme.colors.border }}>
            <Icon name="Braces" size={19} color={theme.colors.accent} />
            <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "700",
              letterSpacing: 0.25, flex: 1 }}>Snippets</Text>
            <Pressable accessibilityRole="button"
              accessibilityLabel={selectingGroups ? "取消选择分组" : "选择并删除分组"}
              onPress={() => { setSelectingGroups(!selectingGroups); setSelectedGroups([]);
                setConfirmBulkDelete(false); setSortOpen(false); setMenuId(null); setPending(null); }}
              style={{ width: 35, height: 35, alignItems: "center", justifyContent: "center" }}>
              <Icon name={selectingGroups ? "X" : "Trash2"} size={17}
                color={selectingGroups ? theme.colors.accent : theme.colors.foregroundMuted} />
            </Pressable>
          </View>
          <View style={{ minHeight: 55, flexDirection: "row", alignItems: "center", gap: 9,
            paddingHorizontal: pad, borderBottomWidth: 1, borderColor: theme.colors.border }}>
            {selectingGroups ? (
              <>
                <Text style={{ color: theme.colors.foreground, flex: 1, fontSize: 12, fontWeight: "600" }}>
                  已选 {selectedGroups.length} 组
                </Text>
                <Tap label={selectedGroups.length === allGroups.length ? "清空" : "全选"}
                  onPress={() => { setSelectedGroups(selectedGroups.length === allGroups.length
                    ? [] : allGroups.map(([name]) => name)); setConfirmBulkDelete(false); }}
                  theme={theme} disabled={busy || !allGroups.length} />
                <Tap label={`删除 (${selectedGroups.length})`} onPress={() => setConfirmBulkDelete(true)}
                  theme={theme} danger disabled={busy || !selectedGroups.length} />
              </>
            ) : searchOpen ? (
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 9,
                backgroundColor: theme.colors.surface2, borderRadius: 9, paddingHorizontal: 10 }}>
                <Icon name="Search" size={16} color={theme.colors.foregroundMuted} />
                <TextInput value={search} onChangeText={setSearch} autoFocus autoCapitalize="none"
                  placeholder="搜索名称、分组、命令" placeholderTextColor={theme.colors.foregroundMuted}
                  style={[{ flex: 1, minHeight: 38, color: theme.colors.foreground, fontSize: 13,
                    padding: 0, outlineWidth: 0 }, Platform.OS === "web" &&
                    ({ outlineStyle: "none" } as unknown as TextStyle)]} />
                <Pressable accessibilityRole="button" accessibilityLabel="关闭搜索" onPress={() => { setSearch(""); setSearchOpen(false); }}>
                  <Icon name="X" size={16} color={theme.colors.foregroundMuted} />
                </Pressable>
              </View>
            ) : (
              <>
                <Tap label="新建片段" onPress={() => beginEdit()} theme={theme}>
                  <Text style={{ color: theme.colors.foreground, fontWeight: "600",
                    fontSize: 12, letterSpacing: 0.2 }}>＋ 新建片段</Text>
                </Tap>
                <View style={{ flex: 1 }} />
                <Pressable accessibilityRole="button" accessibilityLabel="搜索片段" onPress={() => { setSortOpen(false); setSearchOpen(true); }}
                  style={{ width: 37, height: 37, alignItems: "center", justifyContent: "center" }}>
                  <Icon name="Search" size={17} color={theme.colors.foregroundMuted} />
                </Pressable>
                <Pressable accessibilityRole="button"
                  accessibilityLabel={`排序片段，当前${orders.find((item) => item.value === order)?.label ?? "名称 A–Z"}`}
                  onPress={() => setSortOpen(!sortOpen)}
                  style={{ width: 35, height: 35, borderRadius: 7, borderWidth: 1, borderColor: theme.colors.border,
                    alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: sortOpen || order !== "name-asc" ? theme.colors.accent
                    : theme.colors.foregroundMuted, fontWeight: "700",
                    fontSize: 12, letterSpacing: 0.1 }}>A↕</Text>
                </Pressable>
              </>
            )}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: pad,
            paddingTop: 5, paddingBottom: 25 }}>
            {!!error && <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 12, marginVertical: 8 }}>{error}</Text>}
            {!selectingGroups && !searchOpen && order !== "name-asc" && (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, textAlign: "right",
                paddingVertical: 4 }}>排序：{orders.find((item) => item.value === order)?.label}</Text>
            )}
            {sortOpen && !searchOpen && (
              <View style={{ alignSelf: "flex-end", minWidth: 172, padding: 5, borderRadius: 8,
                borderColor: theme.colors.border, borderWidth: 1, backgroundColor: theme.colors.surface2 }}>
                {orders.map((item) => (
                  <FeedbackRow key={item.value} label={item.label} theme={theme}
                    selected={order === item.value}
                    onPress={() => { setOrder(item.value); setSortOpen(false); }}
                    style={{ minHeight: 36, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
                    {({ color, active }) => <>
                      <Text style={{ color, width: 15, fontWeight: "600" }}>{item.icon}</Text>
                      <Text style={{ color, flex: 1, fontWeight: "600", fontSize: 12 }}>{item.label}</Text>
                      {order === item.value && <Icon name="Check" size={15}
                        color={active ? color : theme.colors.accent} />}
                    </>}
                  </FeedbackRow>
                ))}
              </View>
            )}
            {query.isError && <View style={{ gap: 8, paddingVertical: 12 }}>
              <Text style={{ color: theme.colors.statusDanger }}>读取片段失败：{String(query.error)}</Text>
              <Tap label="重试" onPress={() => { void query.refetch(); }} theme={theme} />
            </View>}
            {query.isPending && <Text style={{ color: theme.colors.foregroundMuted, marginTop: 16 }}>正在加载…</Text>}
            {!query.isPending && !query.isError && !(selectingGroups ? allGroups : groups).length && (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, marginTop: 18 }}>
                {!selectingGroups && search ? "没有匹配的片段" : "还没有片段，点击「新建片段」添加。"}</Text>
            )}
            {selectingGroups && confirmBulkDelete && <View style={{ padding: 10, gap: 9,
              borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
              backgroundColor: theme.colors.surface1, marginVertical: 8 }}>
              <Text style={{ color: theme.colors.statusDanger, fontSize: 12, fontWeight: "600" }}>
                删除选中的 {selectedGroups.length} 个分组及其中全部 {selectedTotal} 个片段？
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                {selectedGroups.join("、")}{search ? "（包含搜索未显示的片段）" : ""}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Tap label="确认删除" onPress={() => { void eraseGroups(); }} theme={theme} danger disabled={busy} />
                <Tap label="取消" onPress={() => setConfirmBulkDelete(false)} theme={theme} disabled={busy} />
              </View>
            </View>}
            {(selectingGroups ? allGroups : groups).map(([groupName, items]) => {
              const isCollapsed = !search && collapsed.includes(groupName);
              const total = allGroups.find(([name]) => name === groupName)?.[1].length ?? 0;
              return <View key={groupName}>
                <View style={{ minHeight: 43, flexDirection: "row", alignItems: "center", gap: 5 }}>
                  {selectingGroups ? (
                    <Pressable accessibilityRole="checkbox" accessibilityLabel={`选择分组 ${groupName}，共 ${total} 个片段`}
                      accessibilityState={{ checked: selectedGroups.includes(groupName) }}
                      onPress={() => toggleGroupSelection(groupName)}
                      style={{ flex: 1, minWidth: 0, minHeight: 43, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Icon name={selectedGroups.includes(groupName) ? "SquareCheckBig" : "Square"} size={17}
                        color={selectedGroups.includes(groupName) ? theme.colors.accent : theme.colors.foregroundMuted} />
                      <Text numberOfLines={1} style={{ flex: 1, color: theme.colors.foreground,
                        fontWeight: "600", fontSize: 13 }}>{groupName}</Text>
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{total} 个片段</Text>
                    </Pressable>
                  ) : <>
                    <Pressable accessibilityRole="button"
                      accessibilityLabel={`${isCollapsed ? "展开" : "折叠"}${groupName}，共 ${total} 个片段`}
                      onPress={() => setCollapsed((current) => isCollapsed
                        ? current.filter((g) => g !== groupName) : [...current, groupName])}
                      style={{ flex: 1, minWidth: 0, minHeight: 43, flexDirection: "row", alignItems: "center", gap: 7 }}>
                      <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "600",
                        fontSize: 13, flex: 1 }}>{groupName}</Text>
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                        {search ? `${items.length}/${total} 个片段` : `${total} 个片段`}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`编辑「${groupName}」分组及全部 ${total} 个片段`}
                      onPress={() => openGroupEditor(groupName)}
                      style={{ width: 29, height: 34, alignItems: "center", justifyContent: "center" }}>
                      <Icon name="Pencil" size={15} color={theme.colors.foregroundMuted} />
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${isCollapsed ? "展开" : "折叠"}${groupName}`}
                      onPress={() => setCollapsed((current) => isCollapsed
                        ? current.filter((g) => g !== groupName) : [...current, groupName])}
                      style={{ width: 20, height: 34, alignItems: "center", justifyContent: "center" }}>
                      <Icon name={isCollapsed ? "ChevronRight" : "ChevronDown"} size={16}
                        color={theme.colors.foregroundMuted} />
                    </Pressable>
                  </>}
                </View>
                {!selectingGroups && !isCollapsed && items.map((snippet) => {
                  const selected = pending?.id === snippet.id;
                  const keys = selected ? variablesOf(snippet.command) : [];
                  const expanded = menuId === snippet.id || selected || (!libraryMode && hoveredId === snippet.id);
                  const toggleMenu = () => setMenuId((id) => id === snippet.id ? null : snippet.id);
                  return <View key={snippet.id}
                    onPointerEnter={() => hover(snippet.id)}
                    onPointerLeave={() => leave(snippet.id)}
                    onPointerMove={(event) => {
                      if (hoverTimer.current) clearTimeout(hoverTimer.current);
                      if (hoveredId !== snippet.id) hover(snippet.id);
                      if (!menuId && !selected && variablesOf(snippet.command).length)
                        setMouse(relativePointer(event));
                    }}
                    style={{ paddingVertical: 7, paddingHorizontal: 8, marginVertical: 2, borderRadius: 10,
                      backgroundColor: expanded ? theme.colors.surface1 : theme.colors.surface0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 31 }}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`打开片段 ${snippet.name} 的操作`}
                        onPress={toggleMenu} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Icon name="Braces" size={14} color={expanded ? theme.colors.accent : theme.colors.foregroundMuted} />
                        <Text numberOfLines={1} style={{ flex: 1,
                          color: expanded ? theme.colors.accent : theme.colors.foregroundMuted,
                          fontWeight: "600", fontSize: 13 }}>{snippet.name}</Text>
                      </Pressable>
                      {!libraryMode && expanded && <>
                        <Tap label="Run" onPress={() => choose(snippet, "run")} theme={theme} disabled={busy} />
                        <Tap label="Paste" onPress={() => choose(snippet, "paste")} theme={theme} disabled={busy} />
                      </>}
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel={`打开片段 ${snippet.name} 的操作`}
                      onPress={toggleMenu} style={{ minHeight: 20, justifyContent: "center" }}>
                      <Text numberOfLines={expanded ? undefined : 1} style={{
                        color: expanded ? theme.colors.accent : theme.colors.foregroundMuted,
                        fontSize: expanded ? 12 : 11, lineHeight: expanded ? 19 : 16,
                        marginLeft: expanded ? 0 : 20, marginTop: expanded ? 5 : 2,
                        fontFamily: "monospace", fontWeight: "700" }}>{snippet.command}</Text>
                    </Pressable>
                    {hoveredId === snippet.id && mouse && variablesOf(snippet.command).length > 0 && !selected && !menuId && (
                      <View pointerEvents="none" style={{ position: "absolute", left: mouse.x, top: mouse.y,
                        backgroundColor: theme.colors.surface2, borderColor: theme.colors.border, borderWidth: 1,
                        borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>变量 {'{{…}}'}</Text>
                      </View>
                    )}
                    {menuId === snippet.id && <View style={{ alignSelf: "flex-end", width: 190,
                      backgroundColor: theme.colors.surface2, borderColor: theme.colors.border,
                      borderWidth: 1, borderRadius: 9, padding: 4, marginTop: 6 }}>
                      {!libraryMode && menuRow("Run", () => choose(snippet, "run"))}
                      {!libraryMode && menuRow("Paste", () => choose(snippet, "paste"))}
                      {variablesOf(snippet.command).length > 0 && menuRow("变量", () => {
                        setPending({ id: snippet.id, action: libraryMode ? "copy" : "paste" }); setValues({}); setMenuId(null);
                      })}
                      {menuRow("编辑", () => beginEdit(snippet))}
                      {!libraryMode && menuRow("在所有页面运行", () => choose(snippet, "all"))}
                      {menuRow("复制", () => choose(snippet, "copy"))}
                      <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />
                      {menuRow("删除", () => { setConfirmDelete(snippet.id); setMenuId(null); }, true)}
                    </View>}
                    {confirmDelete === snippet.id && <View style={{ padding: 8, gap: 8 }}>
                      <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>删除「{snippet.name}」？</Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Tap label="确认删除" onPress={() => { void erase(snippet.id); }} theme={theme} danger disabled={busy} />
                        <Tap label="取消" onPress={() => setConfirmDelete(null)} theme={theme} />
                      </View>
                    </View>}
                    {selected && pending && <View style={{ padding: 9, gap: 9, borderTopWidth: 1,
                      borderColor: theme.colors.border, marginTop: 8 }}>
                      <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontSize: 12 }}>填写变量</Text>
                      {keys.map((key) => <View key={key} style={{ gap: 3 }}>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{key}</Text>
                        <Input value={values[key] ?? ""} onChange={(value) => setValues((old) => ({ ...old, [key]: value }))}
                          placeholder={`请输入 ${key}`} theme={theme} />
                      </View>)}
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>命令预览</Text>
                      <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace",
                        fontSize: 11, fontWeight: "700" }}>
                        {renderCommand(snippet.command, values)}</Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Tap label={actionLabel[pending.action]} onPress={() => { void perform(snippet, pending.action, values); }}
                          theme={theme} accent disabled={busy || missingVariables(snippet.command, values).length > 0} />
                        <Tap label="取消" onPress={() => setPending(null)} theme={theme} />
                      </View>
                    </View>}
                  </View>;
                })}
              </View>;
            })}
            {busy && <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, marginTop: 10 }}>处理中…</Text>}
          </ScrollView>
        </>
      )}
    </View>
  );
}
