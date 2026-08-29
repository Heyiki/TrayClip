import { memo, useCallback, useMemo, useState } from "react";
import { Copy, Expand, Pin, PinOff, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppSettings, ClipGroup, ClipRecord } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { useImagePreview } from "@/hooks/useImagePreview";
import { useClipLlm } from "@/hooks/useClipLlm";
import { extractUrl, isJson } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { GroupSelect } from "@/components/GroupSelect";
import { LLMResultDialog } from "@/components/LLMResultDialog";
import { TranslateDialog } from "@/components/TranslateDialog";
import { ImagePreviewDialog } from "@/components/ImagePreviewDialog";
import { recopyImage } from "@/lib/api";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico", ".tiff", ".tif", ".svg",
]);

function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function FileThumb({ path, onClick }: { path: string; onClick: () => void }) {
  const thumbSrc = useImagePreview(path);
  return (
      <button
          type="button"
          className="cursor-zoom-in rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => { event.stopPropagation(); onClick(); }}
          onDoubleClick={(event) => event.stopPropagation()}
          title={path.split(/[/\\]/).pop() ?? "image"}
      >
        <img
            className="h-9 w-11 rounded-sm object-cover"
            src={thumbSrc ?? undefined}
            alt={path.split(/[/\\]/).pop() ?? "image"}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </button>
  );
}

const TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  rich_text: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
  image: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  file_paths: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
};

const GROUP_COLORS = [
  "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400",
  "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400",
  "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400",
  "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400",
  "bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-400",
  "bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-400",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400",
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function TypeTag({ type, label }: { type: string; label: string }) {
  const color = TYPE_COLORS[type] ?? "bg-muted text-muted-foreground";
  return (
      <span className={`inline-flex h-[15px] items-center rounded-[3px] px-1 font-mono text-[9px] font-bold tracking-wider ${color}`}>
      {label}
    </span>
  );
}

interface ClipCardProps {
  clip: ClipRecord;
  selected: boolean;
  groups: ClipGroup[];
  settings: AppSettings;
  onRecopy: (clipId: number) => void;
  onPinToggle: (clipId: number, pinned: boolean) => void;
  onMoveGroup: (clipId: number, groupId: number | null) => void;
  onDelete: (clipId: number) => void;
}

export const ClipCard = memo(function ClipCard({
                                                 clip,
                                                 selected,
                                                 groups,
                                                 settings,
                                                 onRecopy,
                                                 onPinToggle,
                                                 onMoveGroup,
                                                 onDelete,
                                               }: ClipCardProps) {
  const { t } = useTranslation();
  const typeLabel = t.contentType[clip.content_type] ?? clip.content_type.slice(0, 4).toUpperCase();
  const isFilePaths = clip.content_type === "file_paths";
  const imagePaths = useMemo(() => isFilePaths ? clip.file_paths.filter(isImagePath) : [], [isFilePaths, clip.file_paths]);
  const otherPaths = useMemo(() => isFilePaths ? clip.file_paths.filter((p) => !isImagePath(p)) : [], [isFilePaths, clip.file_paths]);
  const singleImage = imagePaths.length === 1 && otherPaths.length === 0;
  const clipImageSrc = useImagePreview(clip.content_type === "image" ? clip.image_path : null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [copyError, setCopyError] = useState<string | null>(null);
  const previewPaths = useMemo(
      () => clip.content_type === "image" && clip.image_path ? [clip.image_path] : imagePaths,
      [clip.content_type, clip.image_path, imagePaths],
  );
  const previewSrc = useImagePreview(previewOpen ? previewPaths[previewIndex] : null);

  const openPreview = useCallback((index: number) => {
    setPreviewIndex(index);
    setCopyError(null);
    setPreviewOpen(true);
  }, []);

  const copyPreviewImage = useCallback(() => {
    const filePath = previewPaths[previewIndex];
    if (!filePath) return;
    setCopyError(null);
    void recopyImage(filePath)
        .then(() => setPreviewOpen(false))
        .catch((error) => {
          console.error("[TrayClip] failed to copy preview image:", error);
          setCopyError(t.copyImageFailed);
        });
  }, [previewIndex, previewPaths, t.copyImageFailed]);

  const { llmState, enabled: llmEnabled, config: llmConfig, close: closeLlmDialog, handleExtractKeywords, handleSummarize } = useClipLlm(settings);
  const [translateOpen, setTranslateOpen] = useState(false);

  const handleJsonCopy = useCallback(async () => {
    const text = clip.plain_text;
    if (text) {
      try {
        const formatted = JSON.stringify(JSON.parse(text), null, 2);
        await navigator.clipboard.writeText(formatted);
        return;
      } catch {
        // not JSON
      }
    }
    onRecopy(clip.id);
  }, [clip.id, clip.plain_text, onRecopy]);

  const url = useMemo(() => clip.plain_text ? extractUrl(clip.plain_text) : null, [clip.plain_text]);
  const json = useMemo(() => clip.plain_text ? isJson(clip.plain_text) : false, [clip.plain_text]);
  const textContent = clip.plain_text?.trim();

  return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
              className={`group relative cursor-default rounded-lg border-l-[3px] border-y-2 border-r-2 bg-card text-card-foreground shadow-xs transition-all duration-200 ${
                  clip.is_pinned
                      ? `border-l-primary/60 ${selected ? "border-primary/40 shadow-md" : "border-y-transparent border-r-transparent hover:border-primary/40 hover:shadow-md"}`
                      : selected
                          ? "border-primary/40 shadow-md"
                          : "border-transparent hover:border-primary/40 hover:shadow-md"
              }`}
              onDoubleClick={() => onRecopy(clip.id)}
          >

            <div className="px-3 py-2.5">
              {/* Meta row */}
              <div className="mb-1.5 flex items-center gap-2">
                <TypeTag type={clip.content_type} label={typeLabel} />
                {clip.group_id ? (() => {
                  const groupName = groups.find((g) => g.id === clip.group_id)?.name;
                  return groupName ? (
                      <span className={`inline-flex h-[15px] items-center rounded-[3px] px-1.5 text-[9px] font-bold ${GROUP_COLORS[hashName(groupName) % GROUP_COLORS.length]}`}>
                    {groupName}
                  </span>
                  ) : null;
                })() : null}
                {clip.source_app && clip.source_app !== "—" ? (
                    <span className="max-w-[120px] truncate text-[10px] font-medium text-muted-foreground/70">{clip.source_app}</span>
                ) : null}
                {clip.is_truncated ? (
                    <span className="inline-flex h-[15px] items-center rounded-[3px] bg-amber-100 px-1 text-[9px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                  TRUNC
                </span>
                ) : null}
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/50">
                {new Date(clip.updated_at).toLocaleString("zh-CN")}
              </span>
              </div>

              {/* Content */}
              {clip.content_type === "image" && clip.image_path ? (
                  <button
                      type="button"
                      className="group/image relative my-0.5 block max-w-full cursor-zoom-in rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={t.imagePreview}
                      onClick={(event) => {
                        event.stopPropagation();
                        openPreview(0);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <img
                        className="max-h-[56px] max-w-full rounded-sm object-contain"
                        src={clipImageSrc ?? undefined}
                        alt={t.imagePreview}
                    />
                    <span className="pointer-events-none absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded bg-black/55 text-white opacity-0 transition-opacity group-hover/image:opacity-100">
                      <Expand className="h-3 w-3" />
                    </span>
                  </button>
              ) : null}
              {isFilePaths && imagePaths.length > 0 ? (
                  <div className="my-0.5 flex gap-1.5 overflow-hidden">
                    {imagePaths.slice(0, 2).map((path, index) => (
                        <FileThumb key={path} path={path} onClick={() => openPreview(index)} />
                    ))}
                  </div>
              ) : null}
              {isFilePaths ? (
                  singleImage ? null : (
                      <div className="line-clamp-1 break-all text-sm text-foreground/80" title={clip.file_paths.join("\n")}>
                        {otherPaths.slice(0, 2).map((path) => (
                            <span key={path} className="truncate">{path} </span>
                        ))}
                        {otherPaths.length > 2 ? (
                            <span className="text-muted-foreground/50">{t.moreFiles(otherPaths.length - 2)}</span>
                        ) : null}
                      </div>
                  )
              ) : (
                  <div className="line-clamp-1 break-all text-sm text-foreground/80" title={clip.plain_text || clip.summary}>
                    {clip.summary}
                  </div>
              )}

              {/* Actions — show on hover */}
              <div className="mt-1.5 flex items-center gap-2 opacity-0 transition-all duration-150 group-hover:opacity-100">
                <GroupSelect
                    groups={groups}
                    currentGroupId={clip.group_id}
                    onSelect={(groupId) => onMoveGroup(clip.id, groupId)}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded text-muted-foreground/60 hover:bg-background hover:text-foreground hover:shadow-sm"
                    title={t.copy}
                    onClick={() => onRecopy(clip.id)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded text-muted-foreground/60 hover:bg-background hover:text-foreground hover:shadow-sm"
                    title={clip.is_pinned ? t.unpin : t.pin}
                    onClick={() => onPinToggle(clip.id, !clip.is_pinned)}
                >
                  {clip.is_pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded text-muted-foreground/60 hover:bg-background hover:text-destructive hover:shadow-sm"
                    title={t.delete}
                    onClick={() => onDelete(clip.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {/* LLM Dialog */}
            {previewPaths.length > 0 ? (
                <ImagePreviewDialog
                    open={previewOpen}
                    src={previewSrc}
                    index={previewIndex}
                    total={previewPaths.length}
                    onOpenChange={setPreviewOpen}
                    onPrevious={() => setPreviewIndex((current) => Math.max(0, current - 1))}
                    onNext={() => setPreviewIndex((current) => Math.min(previewPaths.length - 1, current + 1))}
                    onCopy={copyPreviewImage}
                    copyError={copyError}
                />
            ) : null}

            {(llmState.loading || llmState.result || llmState.error) && (
                <LLMResultDialog
                    loading={llmState.loading}
                    action={llmState.action}
                    result={llmState.result}
                    error={llmState.error}
                    onCopy={() => {
                      if (llmState.result) void navigator.clipboard.writeText(llmState.result);
                      closeLlmDialog();
                    }}
                    onClose={closeLlmDialog}
                />
            )}

            {/* Translate Dialog */}
            {translateOpen && textContent ? (
                <TranslateDialog
                    text={textContent}
                    llmConfig={llmConfig}
                    llmEnabled={llmEnabled}
                    aiTranslate={settings.llm_ai_translate}
                    onClose={() => setTranslateOpen(false)}
                />
            ) : null}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          {url ? (
              <ContextMenuItem onClick={() => void openUrl(url)}>
                {t.openLink}
              </ContextMenuItem>
          ) : null}
          <ContextMenuItem onClick={() => void handleJsonCopy()}>
            {json ? t.jsonCopy : t.copy}
          </ContextMenuItem>
          {textContent ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => setTranslateOpen(true)}>
                  {t.translate}
                </ContextMenuItem>
              </>
          ) : null}
          {llmEnabled && textContent ? (
              <>
                <ContextMenuItem onClick={() => textContent && handleExtractKeywords(textContent)}>
                  {t.extractKeywords}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => textContent && handleSummarize(textContent)}>
                  {t.aiSummarize}
                </ContextMenuItem>
              </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
  );
});
