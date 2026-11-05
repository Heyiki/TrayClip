import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ClipTypeToken } from "../../../src/components/ClipTypeToken";
import { ClipList } from "../../../src/components/ClipList";
import { GroupBar } from "../../../src/components/GroupBar";
import { WindowBar } from "../../../src/components/WindowBar";
import { FALLBACK_BOOTSTRAP } from "../../../src/lib/constants";
import type { ClipGroup, ClipListItem, ClipTypeFilter } from "../../../src/lib/types";
import { zh } from "../../../src/lib/locales/zh";
import { en } from "../../../src/lib/locales/en";
import { DemoI18n, type Locale } from "./i18n";
import "./style.css";

const text = {
    "zh-CN": ["项目资料与常用链接，留一份在手边。", "https://github.com/Heyiki/TrayClip", "灵感备忘：给阅读清单增加一个「稍后再看」分组。", "C:\\Documents\\项目资料.pdf", "Meeting notes\n设计评审 · 周三 14:00\n整理反馈，确认下一版。", "谢谢反馈，我们会在下个版本中跟进。"],
    en: ["Keep project notes and useful links within reach.", "https://github.com/Heyiki/TrayClip", "Idea: add a Read later group to the reading list.", "C:\\Documents\\Project-notes.pdf", "Meeting notes\nDesign review · Wednesday 14:00\nReview feedback and agree on the next version.", "Thanks for the feedback. We will follow up in the next release."],
};
function samples(): ClipListItem[] {
    const now = new Date().toISOString();
    return text["zh-CN"].map((_, index) => ({
        id: index + 1, content_type: index === 3 ? "file_paths" : index === 4 ? "rich_text" : "plain_text",
        preview: "", summary: "", preview_truncated: false, has_url: index === 1, image_path: null, file_paths: [],
        source_app: ["Notepad", "Chrome", "Notepad", "Explorer", "Visual Studio Code", "Notepad"][index],
        is_pinned: index === 0, is_truncated: false, group_id: [3, 1, 2, 1, 1, 3][index],
        created_at: now, updated_at: now, last_used_at: null,
    }));
}
const initialGroups = (): ClipGroup[] => [1, 2, 3].map((id) => ({ id, name: "", created_at: "", updated_at: "" }));
let currentText = new Map<number, string>();
let currentLocale: Locale = "zh-CN";
function notify(key: string) { window.parent.postMessage({ type: "trayclip-demo-status", key }, location.origin); }
mockWindows("main");
mockIPC(async (command, args) => {
    if (command === "plugin:window|start_dragging") { notify("unavailable"); return; }
    if (command === "get_clip_text") return currentText.get(Number((args as { clipId: number }).clipId)) ?? "";
    if (command === "allow_image_preview") return false;
    if (command === "plugin:opener|open_url") {
        const url = (args as { url?: string }).url;
        if (url === "https://github.com/Heyiki/TrayClip") window.open(url, "_blank", "noopener,noreferrer");
        return;
    }
    if (command === "bing_translate") throw new Error(currentLocale === "en" ? "Online translation is not connected in this demo." : "交互演示未连接在线翻译服务。");
    throw new Error("Desktop service unavailable in the browser demo");
});

function Demo() {
    const [locale, setLocale] = useState<Locale>("zh-CN");
    const [theme, setTheme] = useState<"light" | "dark">("light");
    const [clips, setClips] = useState(samples);
    const [groups, setGroups] = useState(initialGroups);
    const [selected, setSelected] = useState<number | null>(null);
    const [query, setQuery] = useState("");
    const [typeFilter, setTypeFilter] = useState<ClipTypeFilter>("all");
    const searchRef = useRef<HTMLInputElement>(null);
    const [revision, setRevision] = useState(0);
    const [customNames, setCustomNames] = useState<Record<number, string>>({});
    const t = locale === "en" ? en : zh;
    const typeLabels = { all: "", text: t.filterText, image: t.contentType.image, file: t.filterFile };
    const activeTypeLabel = typeLabels[typeFilter];
    const names = locale === "en" ? ["Work", "Ideas", "Saved"] : ["工作", "灵感", "常用"];
    const translatedGroups = groups.map((group) => ({ ...group, name: customNames[group.id] ?? names[group.id - 1] ?? group.name }));
    const translated = clips.map((clip) => {
        const content = text[locale][clip.id - 1];
        return { ...clip, preview: content, summary: content, file_paths: clip.content_type === "file_paths" ? [content] : [] };
    });
    currentLocale = locale;
    currentText = new Map(translated.map((clip) => [clip.id, clip.preview]));
    const visible = translated.filter((clip) => (selected === null || clip.group_id === selected)
        && (typeFilter === "all" || (typeFilter === "text" ? clip.content_type === "plain_text" || clip.content_type === "rich_text"
            : clip.content_type === (typeFilter === "file" ? "file_paths" : "image")))
        && `${clip.preview}\n${clip.source_app}`.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || a.id - b.id);
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (event.source !== window.parent || event.origin !== location.origin) return;
            if (event.data?.type === "trayclip-demo-preferences") {
                if (event.data.locale === "en" || event.data.locale === "zh-CN") {
                    setLocale(event.data.locale);
                    document.documentElement.lang = event.data.locale;
                }
                if (event.data.theme === "light" || event.data.theme === "dark") setTheme(event.data.theme);
            }
            if (event.data?.type === "trayclip-demo-reset") {
                setClips(samples()); setGroups(initialGroups()); setCustomNames({}); setSelected(null); setQuery("");
                setTypeFilter("all");
                setRevision((value) => value + 1); notify("reset");
            }
        };
        window.addEventListener("message", receive);
        window.parent.postMessage({ type: "trayclip-demo-ready" }, location.origin);
        return () => window.removeEventListener("message", receive);
    }, []);
    useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
    useEffect(() => { document.documentElement.lang = locale; }, [locale]);
    const copy = async (id: number) => {
        try { await navigator.clipboard.writeText(currentText.get(id) ?? ""); notify("copied"); }
        catch { notify("copyFailed"); }
    };
    return <DemoI18n locale={locale}>
        <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
            <WindowBar theme={theme} onThemeToggle={() => setTheme((current) => current === "dark" ? "light" : "dark")}
                       onLanguageToggle={() => setLocale((current) => current === "en" ? "zh-CN" : "en")}
                       onTabChange={(tab) => { if (tab !== "clips") notify("unavailable"); }}
                       onClose={() => notify("unavailable")} onCheckUpdate={() => notify("unavailable")}
                       updateAvailable={false} updateChecking={false} />
            <div className="shrink-0 border-b border-border/50 bg-muted">
                <div className="flex items-center gap-2 px-3 py-1.5">
                    <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-lg border border-border/60 bg-card px-1.5 transition-colors focus-within:border-primary/30">
                        <ClipTypeToken value={typeFilter} label={activeTypeLabel}
                                       onChange={(value) => { setTypeFilter(value); setRevision((current) => current + 1); }}
                                       onClosed={() => searchRef.current?.focus()} />
                        <input ref={searchRef} className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/50" type="search"
                               aria-label={locale === "en" ? "Search clipboard" : "搜索剪贴板"}
                               placeholder={activeTypeLabel ? t.searchInType(activeTypeLabel) : t.searchPlaceholder} value={query}
                               onChange={(event) => { setQuery(event.target.value); setRevision((value) => value + 1); }} />
                    </div>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50">{t.recordsCount(visible.length)}</span>
                </div>
                <GroupBar groups={translatedGroups} selectedGroupId={selected}
                          onSelect={(id) => { setSelected(id); setRevision((value) => value + 1); }}
                          onCreate={(name) => {
                              const id = Math.max(3, ...groups.map((group) => group.id)) + 1;
                              setGroups((current) => [...current, { id, name, created_at: "", updated_at: "" }]);
                              setCustomNames((current) => ({ ...current, [id]: name }));
                          }}
                          onRename={(id, name) => setCustomNames((current) => ({ ...current, [id]: name }))}
                          onDelete={(group) => {
                              setGroups((current) => current.filter((item) => item.id !== group.id));
                              setClips((current) => current.map((clip) => clip.group_id === group.id ? { ...clip, group_id: null } : clip));
                              if (selected === group.id) setSelected(null);
                          }} />
            </div>
            <ClipList clips={visible} groups={translatedGroups} settings={FALLBACK_BOOTSTRAP.settings} showGroupName
                      scrollResetKey={revision} filtered={Boolean(query || selected || typeFilter !== "all")}
                      onClearFilters={() => { setQuery(""); setSelected(null); setTypeFilter("all"); setRevision((value) => value + 1); }}
                      onRecopy={(id) => void copy(id)}
                      onPinToggle={(id, pinned) => setClips((current) => current.map((clip) => clip.id === id ? { ...clip, is_pinned: pinned } : clip))}
                      onDelete={(id) => setClips((current) => current.filter((clip) => clip.id !== id))}
                      onMoveGroup={(id, groupId) => setClips((current) => current.map((clip) => clip.id === id ? { ...clip, group_id: groupId } : clip))} />
        </div>
    </DemoI18n>;
}
createRoot(document.getElementById("root")!).render(<Demo />);
