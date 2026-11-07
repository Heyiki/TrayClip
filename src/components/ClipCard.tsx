import { memo, useCallback, useMemo, useState } from "react";
import { Copy, Expand, FileText, Files, Image, Pin, PinOff, ScanText, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppSettings, ClipGroup, ClipListItem } from "@/lib/types";
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
import { OcrDialog } from "@/components/OcrDialog";
import { getClipText, recopyImage } from "@/lib/api";
import { formatClipTime } from "@/lib/clip-time";

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
          className="flex h-fit w-fit max-w-20 shrink-0 cursor-zoom-in overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => { event.stopPropagation(); onClick(); }}
          onDoubleClick={(event) => event.stopPropagation()}
          title={path.split(/[/\\]/).pop() ?? "image"}
      >
        <img
            className="block h-auto max-h-16 w-auto max-w-full rounded object-contain"
            src={thumbSrc ?? undefined}
            alt={path.split(/[/\\]/).pop() ?? "image"}
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </button>
  );
}

function TypeTag({ type, label }: { type: string; label: string }) {
  const Icon = type === "image" ? Image : type === "file_paths" ? Files : FileText;
  return (
      <span className="inline-flex shrink-0 items-center text-muted-foreground" title={label} aria-label={label}>
        <Icon className="size-3" aria-hidden="true" />
      </span>
  );
}

interface ClipCardProps {
  clip: ClipListItem;
  selected: boolean;
  now: number;
  groups: ClipGroup[];
  showGroupName?: boolean;
  settings: AppSettings;
  onRecopy: (clipId: number) => void;
  onPinToggle: (clipId: number, pinned: boolean) => void;
  onMoveGroup: (clipId: number, groupId: number | null) => void;
  onDelete: (clipId: number) => void;
}

export const ClipCard = memo(function ClipCard({
                                                 clip,
                                                 selected,
                                                 now,
                                                 groups,
                                                 showGroupName = true,
                                                 settings,
                                                 onRecopy,
                                                 onPinToggle,
                                                 onMoveGroup,
                                                 onDelete,
                                               }: ClipCardProps) {
  const { t, locale } = useTranslation();
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
  const [ocrOpen, setOcrOpen] = useState(false);
  const [translateText, setTranslateText] = useState<string | null>(null);

  // A list row only carries a preview, so anything that works on the whole clip has to read
  // it back first. The preview is the fallback when that read fails.
  const withFullText = useCallback(async (action: (text: string) => void | Promise<void>) => {
    let text = clip.preview;
    try {
      text = await getClipText(clip.id);
    } catch (error) {
      console.error("[TrayClip] failed to load full clip text:", error);
    }
    const trimmed = text.trim();
    if (trimmed) await action(trimmed);
  }, [clip.id, clip.preview]);

  const handleJsonCopy = useCallback(async () => {
    let text = clip.preview;
    try {
      text = await getClipText(clip.id);
    } catch (error) {
      console.error("[TrayClip] failed to load full clip text:", error);
    }
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
  }, [clip.id, clip.preview, onRecopy]);

  // The preview can be cut before the link, so opening re-reads the full text: a truncated
  // URL would open the wrong page. If the full text cannot be loaded the click does
  // nothing, which beats opening a link that is missing its tail.
  const handleOpenLink = useCallback(async () => {
    let text = clip.preview;
    if (clip.preview_truncated) {
      try {
        text = await getClipText(clip.id);
      } catch (error) {
        console.error("[TrayClip] failed to load full clip text:", error);
        return;
      }
    }
    const fullUrl = extractUrl(text);
    if (fullUrl) await openUrl(fullUrl);
  }, [clip.id, clip.preview, clip.preview_truncated]);

  // A long JSON document is cut by the preview limit, so a truncated preview that starts
  // like an object or an array still counts as JSON: copying re-reads the full text and
  // falls back to a plain copy if it does not parse either.
  const json = useMemo(() => {
    if (!clip.preview) return false;
    if (isJson(clip.preview)) return true;
    if (!clip.preview_truncated) return false;
    const head = clip.preview.trimStart();
    return head.startsWith("{") || head.startsWith("[");
  }, [clip.preview, clip.preview_truncated]);
  const hasText = Boolean(clip.preview.trim());
  const groupName = groups.find((group) => group.id === clip.group_id)?.name;
  const time = formatClipTime(clip.created_at, locale, now, clip.last_used_at);
  const hasImage = (clip.content_type === "image" && Boolean(clip.image_path)) || imagePaths.length > 0;

  return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
              data-clip-card
              data-selected={selected ? "" : undefined}
              className={`clip-card relative cursor-default rounded-[8px] border bg-card text-card-foreground transition-colors duration-150 ${
                  selected
                      ? "border-primary/60 bg-primary/[0.06] dark:bg-primary/[0.10]"
                      : "border-border/60 hover:border-foreground/20 hover:bg-muted"
              }`}
              onDoubleClick={() => onRecopy(clip.id)}
          >

            <div className="px-3 pb-1 pt-2">
              {/* Content */}
              <div className={isFilePaths ? "flex items-start gap-2" : undefined}>
                {clip.content_type === "image" && clip.image_path ? (
                    <button
                        type="button"
                        className="group/image relative flex h-fit w-fit max-w-full cursor-zoom-in overflow-hidden rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={t.imagePreview}
                        onClick={(event) => {
                          event.stopPropagation();
                          openPreview(0);
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <img
                          className="block h-auto max-h-16 w-auto max-w-full rounded-sm object-contain"
                          src={clipImageSrc ?? undefined}
                          alt={t.imagePreview}
                      />
                      <span className="pointer-events-none absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded bg-black/55 text-white opacity-0 transition-opacity group-hover/image:opacity-100">
                      <Expand className="h-3 w-3" />
                    </span>
                    </button>
                ) : null}
                {isFilePaths && imagePaths.length > 0 ? (
                    <div className="flex shrink-0 gap-1.5 overflow-hidden">
                      {imagePaths.slice(0, 2).map((path, index) => (
                          <FileThumb key={path} path={path} onClick={() => openPreview(index)} />
                      ))}
                    </div>
                ) : null}
                {isFilePaths ? (
                    singleImage ? null : (
                        <div className="min-w-0 flex-1 text-sm leading-5" title={clip.file_paths.join("\n")}>
                          {otherPaths.slice(0, otherPaths.length > 2 ? 1 : 2).map((path, index) => (
                              <div key={`${index}-${path}`} className="truncate font-medium">{path.split(/[/\\]/).pop() || path}</div>
                          ))}
                          {otherPaths.length > 2 ? (
                              <div className="truncate text-[11px] text-muted-foreground">{t.moreFiles(otherPaths.length - 1)}</div>
                          ) : otherPaths.length === 1 ? (
                              <div className="truncate text-[11px] text-muted-foreground">{otherPaths[0]}</div>
                          ) : null}
                        </div>
                    )
                ) : (
                    <div className={`${hasImage ? "line-clamp-1 text-[11px] leading-4 text-muted-foreground" : "line-clamp-2 text-sm leading-5"} whitespace-pre-wrap break-words [overflow-wrap:anywhere]`} title={clip.summary}>
                      {clip.summary}
                    </div>
                )}
              </div>

              <div className="mt-1 flex min-w-0 items-center gap-2">
                <div className="relative flex h-6 min-w-28 flex-1 items-center">
                  <div className="clip-meta flex min-w-0 items-center gap-1.5 overflow-hidden text-[11px] text-muted-foreground">
                    {clip.is_pinned ? <Pin className="size-3 shrink-0 text-primary" aria-label={t.unpin} /> : null}
                    <TypeTag type={clip.content_type} label={typeLabel} />
                    {clip.source_app && clip.source_app !== "—" ? (
                        <span className="truncate" title={clip.source_app}>{clip.source_app}</span>
                    ) : null}
                    {clip.is_truncated ? <span className="shrink-0 text-amber-700 dark:text-amber-400" title="TRUNC">…</span> : null}
                  </div>
                  <div className="clip-actions absolute left-0 top-1/2 flex h-7 w-28 -translate-y-1/2 items-center">
                    <GroupSelect
                        groups={groups}
                        currentGroupId={clip.group_id}
                        onSelect={(groupId) => onMoveGroup(clip.id, groupId)}
                    />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded text-muted-foreground hover:bg-background hover:text-foreground"
                        title={t.copy}
                        aria-label={t.copy}
                        onClick={() => onRecopy(clip.id)}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded text-muted-foreground hover:bg-background hover:text-foreground"
                        title={clip.is_pinned ? t.unpin : t.pin}
                        aria-label={clip.is_pinned ? t.unpin : t.pin}
                        onClick={() => onPinToggle(clip.id, !clip.is_pinned)}
                    >
                      {clip.is_pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title={t.delete}
                        aria-label={t.delete}
                        onClick={() => onDelete(clip.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  {showGroupName && groupName ? (
                      <>
                        <span className="max-w-20 truncate" title={groupName}>{groupName}</span>
                        <span className="shrink-0" aria-hidden="true">·</span>
                      </>
                  ) : null}
                  <time
                      className="clip-time shrink-0 whitespace-nowrap tabular-nums"
                      dateTime={clip.last_used_at || clip.created_at}
                      title={time.title}
                  >{time.label}</time>
                </div>
              </div>
            </div>

            {/* LLM Dialog */}
            {ocrOpen && previewPaths[0] ? (
                <OcrDialog clipId={clip.id} imagePath={previewPaths[0]} onClose={() => setOcrOpen(false)} />
            ) : null}
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
            {translateOpen && translateText ? (
                <TranslateDialog
                    text={translateText}
                    llmConfig={llmConfig}
                    llmEnabled={llmEnabled}
                    aiTranslate={settings.llm_ai_translate}
                    onClose={() => {
                      setTranslateOpen(false);
                      setTranslateText(null);
                    }}
                />
            ) : null}
          </div>
        </ContextMenuTrigger>

        <ContextMenuContent>
          {previewPaths.length === 1 && !previewPaths[0].toLowerCase().endsWith(".svg") && !previewPaths[0].toLowerCase().endsWith(".ico") ? (
              <ContextMenuItem onClick={() => setOcrOpen(true)}>
                <ScanText className="size-4" />{t.ocrRecognize}
              </ContextMenuItem>
          ) : null}
          {clip.has_url ? (
              <ContextMenuItem onClick={() => void handleOpenLink()}>
                {t.openLink}
              </ContextMenuItem>
          ) : null}
          <ContextMenuItem onClick={() => void handleJsonCopy()}>
            {json ? t.jsonCopy : t.copy}
          </ContextMenuItem>
          {hasText ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                    onClick={() => void withFullText((text) => {
                      setTranslateText(text);
                      setTranslateOpen(true);
                    })}
                >
                  {t.translate}
                </ContextMenuItem>
              </>
          ) : null}
          {llmEnabled && hasText ? (
              <>
                <ContextMenuItem onClick={() => void withFullText(handleExtractKeywords)}>
                  {t.extractKeywords}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => void withFullText(handleSummarize)}>
                  {t.aiSummarize}
                </ContextMenuItem>
              </>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
  );
});
