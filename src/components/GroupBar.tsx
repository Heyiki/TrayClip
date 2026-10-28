import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ClipGroup } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface GroupBarProps {
  groups: ClipGroup[];
  selectedGroupId: number | null;
  onSelect: (groupId: number | null) => void;
  onCreate: (name: string) => void;
  onRename: (groupId: number, name: string) => void;
  onDelete: (group: ClipGroup) => void;
}

const CHIP_BASE = "inline-flex h-[26px] shrink-0 cursor-pointer items-center rounded-md text-xs font-medium transition-colors duration-150";
const CHIP_SELECTED = "bg-primary text-primary-foreground shadow-sm";
// The strip sits on bg-muted, so a muted hover would be invisible; a translucent foreground
// overlay works in both light and dark themes.
const CHIP_IDLE = "text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground";
// Keyboard focus never draws an outline here: the strip scrolls horizontally (`overflow-x: auto`
// makes overflow-y auto too), so anything painted outside a chip gets clipped into a broken
// ring, and a second ring around the solid primary chip only adds noise. The focused chip
// reuses the hover tint instead, which keeps one visual vocabulary for "you are here".
const FOCUS_SILENT = "focus-visible:outline-none";
const FOCUS_TINT = "focus-visible:outline-none focus-visible:bg-foreground/[0.06] focus-visible:text-foreground";

interface GroupNameFieldProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

/**
 * Inline name editor for a 26px chip strip. Two deliberate choices:
 *
 * 1. A raw `<input>` instead of the shared `Input`. Its base styles (h-8, a 3px focus ring,
 *    dark:bg-input/30) fight a row this short, and overriding them one by one is what made
 *    earlier versions look patched-on rather than designed.
 * 2. The field sits on `bg-card` with a 1px accent border: the strip is `bg-muted`, so the
 *    editor has to read as a surface lifted off it. A tinted transparent field loses that
 *    elevation and turns muddy next to the solid-primary selected chip.
 *
 * The invisible copy of the text sizes the grid cell, so the field grows with the name instead
 * of snapping to a fixed width (which also stops the strip from reflowing on rename).
 */
function GroupNameField({ value, placeholder, onChange, onCommit, onCancel }: GroupNameFieldProps) {
  return (
      <span className="inline-grid shrink-0 items-center">
        <span
            aria-hidden
            className="invisible col-start-1 row-start-1 max-w-[88px] overflow-hidden whitespace-pre px-2 text-xs font-medium"
        >
          {value || placeholder}
        </span>
        <input
            autoFocus
            maxLength={10}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCommit();
              if (event.key === "Escape") onCancel();
            }}
            onBlur={onCommit}
            className="col-start-1 row-start-1 h-[26px] w-full min-w-[64px] max-w-[104px] rounded-md border border-primary/50 bg-card px-2 text-center text-xs font-medium text-foreground caret-primary shadow-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-primary"
        />
      </span>
  );
}

export function GroupBar({
                           groups,
                           selectedGroupId,
                           onSelect,
                           onCreate,
                           onRename,
                           onDelete,
                         }: GroupBarProps) {
  const { t } = useTranslation();
  const [showInput, setShowInput] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const scrollRef = useRef<HTMLDivElement>(null);
  const allButtonRef = useRef<HTMLButtonElement>(null);

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (name) onCreate(name);
    setNewName("");
    setShowInput(false);
  }, [newName, onCreate]);

  const handleCommitRename = useCallback(() => {
    if (renamingId !== null) {
      const name = renameValue.trim();
      if (name) onRename(renamingId, name);
      setRenamingId(null);
    }
  }, [renamingId, renameValue, onRename]);

  const centerChip = useCallback((chip: HTMLElement) => {
    const container = scrollRef.current;
    if (!container) return;
    const target = chip.offsetLeft + chip.offsetWidth / 2 - container.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, []);

  const syncOverflow = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const start = container.scrollLeft > 1;
    const end = container.scrollLeft + container.clientWidth < container.scrollWidth - 1;
    setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    syncOverflow();
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(container);
    return () => observer.disconnect();
  }, [groups, syncOverflow]);

  // Right-clicking the last visible chip opens an editor that may stick out of the strip.
  useEffect(() => {
    if (renamingId === null) return;
    scrollRef.current?.querySelector("input")?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [renamingId]);

  // The selection survives restarts, so the strip has to bring it into view by itself:
  // otherwise a group on the right looks unselected after relaunch.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (selectedGroupId === null) {
      container.scrollTo({ left: 0, behavior: "smooth" });
      return;
    }
    const chip = container.querySelector<HTMLElement>(`[data-group-id="${selectedGroupId}"]`);
    if (chip) centerChip(chip);
  }, [centerChip, selectedGroupId]);

  // "All" leads the strip, so the arrow keys walk it in the same order the eye reads.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The rename field lives inside the strip; there the arrows belong to the caret.
    if (event.target instanceof HTMLInputElement) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const order: (number | null)[] = [null, ...groups.map((group) => group.id)];
    const current = order.indexOf(selectedGroupId);
    const next = Math.min(order.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)));
    if (next === current) return;
    event.preventDefault();
    event.stopPropagation();
    const nextId = order[next];
    onSelect(nextId);
    const chip = nextId === null
        ? null
        : scrollRef.current?.querySelector<HTMLElement>(`[data-group-id="${nextId}"] button`);
    (chip ?? allButtonRef.current)?.focus();
  };

  return (
      <div data-slot="group-bar" className="flex flex-shrink-0 items-center gap-1.5 bg-muted px-3 py-1.5">
        <div role="group" aria-label={t.groupsLabel} className="flex min-w-0 flex-1 items-center gap-1.5" onKeyDown={handleKeyDown}>
          {/* "All" is the root of the strip, so it stays put while the groups behind it scroll. */}
          <button
              ref={allButtonRef}
              type="button"
              aria-pressed={selectedGroupId === null}
              className={cn(
                  CHIP_BASE,
                  "px-2.5",
                  selectedGroupId === null ? [CHIP_SELECTED, FOCUS_SILENT] : [CHIP_IDLE, FOCUS_TINT],
              )}
              onClick={() => onSelect(null)}
          >
            {t.all}
          </button>

          <span className="h-4 w-px shrink-0 bg-border" aria-hidden />

          <div className="relative min-w-0 flex-1">
            <div
                ref={scrollRef}
                className="relative flex items-center gap-1.5 overflow-x-auto scrollbar-none"
                onScroll={syncOverflow}
            >
              {groups.map((group) =>
                  renamingId === group.id ? (
                      <GroupNameField
                          key={group.id}
                          value={renameValue}
                          onChange={setRenameValue}
                          onCommit={handleCommitRename}
                          onCancel={() => setRenamingId(null)}
                      />
                  ) : (
                      <ContextMenu key={group.id}>
                        <ContextMenuTrigger asChild>
                          <div
                              data-group-id={group.id}
                              className={cn("inline-flex h-[26px] items-center rounded-md transition-colors duration-150", selectedGroupId === group.id ? CHIP_SELECTED : CHIP_IDLE)}
                          >
                            <button
                                type="button"
                                aria-pressed={selectedGroupId === group.id}
                                className={cn(
                                    "h-full max-w-[104px] cursor-pointer truncate rounded-md px-2.5 text-xs font-medium",
                                    selectedGroupId === group.id ? FOCUS_SILENT : FOCUS_TINT,
                                )}
                                title={t.groupHint(group.name)}
                                onClick={() => onSelect(group.id)}
                            >
                              {group.name}
                            </button>
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                              onClick={() => {
                                setRenamingId(group.id);
                                setRenameValue(group.name);
                              }}
                          >
                            {t.rename}
                          </ContextMenuItem>
                          <ContextMenuItem variant="destructive" onClick={() => onDelete(group)}>
                            {t.deleteGroup}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                  )
              )}
            </div>
            {/* Edge fades are the only hint that the strip scrolls: the scrollbar is hidden. */}
            {overflow.start ? (
                <span className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-muted to-transparent" />
            ) : null}
            {overflow.end ? (
                <span className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-muted to-transparent" />
            ) : null}
          </div>
        </div>

        {/* Fixed outside the strip so it can never scroll out of reach. */}
        <div className="flex shrink-0 items-center">
          {showInput ? (
              <GroupNameField
                  value={newName}
                  placeholder={t.groupNamePlaceholder}
                  onChange={setNewName}
                  onCommit={handleCreate}
                  onCancel={() => {
                    setShowInput(false);
                    setNewName("");
                  }}
              />
          ) : (
              <Button
                  variant="ghost"
                  size="icon"
                  className="h-[26px] w-[26px] cursor-pointer rounded-md text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:bg-foreground/[0.06] focus-visible:text-foreground focus-visible:outline-none"
                  onClick={() => setShowInput(true)}
                  title={t.createGroup}
                  aria-label={t.createGroup}
              >
                <Plus className="h-3 w-3" />
              </Button>
          )}
        </div>
      </div>
  );
}
