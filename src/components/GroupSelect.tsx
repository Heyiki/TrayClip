import { useState } from "react";
import { Check, Tag } from "lucide-react";
import type { ClipGroup } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface GroupSelectProps {
  groups: ClipGroup[];
  currentGroupId: number | null;
  onSelect: (groupId: number | null) => void;
}

export function GroupSelect({ groups, currentGroupId, onSelect }: GroupSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");

  const currentGroup = currentGroupId != null ? groups.find((g) => g.id === currentGroupId) : null;
  const filtered = groups.filter((g) => g.name.toLowerCase().includes(keyword.toLowerCase()));

  return (
      <>
        <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded text-muted-foreground hover:bg-background hover:text-foreground"
            title={currentGroup ? currentGroup.name : t.searchGroup}
            aria-label={t.searchGroup}
            onClick={() => setOpen(true)}
        >
          <Tag className="size-3.5" />
        </Button>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[50%] rounded-t-xl p-0 [&>button]:hidden">
            <div className="flex justify-center pt-2 pb-0">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
            </div>
            <div className="px-4 pt-0.5 pb-1">
              <Input
                  autoFocus
                  placeholder={t.searchGroup}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="h-6 rounded-lg border-0 bg-muted dark:bg-muted text-xs placeholder:text-muted-foreground/50"
              />
            </div>
            <ScrollArea className="mt-0.5 max-h-[240px] px-2 pb-3">
              <div className="flex flex-col gap-0.5">
                <button
                    className={cn(
                        "flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-xs transition-colors",
                        currentGroupId == null
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-foreground/70 hover:bg-muted/70"
                    )}
                    onClick={() => { onSelect(null); setOpen(false); setKeyword(""); }}
                >
                  <span className="flex-1 truncate">{t.ungrouped}</span>
                  {currentGroupId == null && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
                {filtered.map((group) => (
                    <button
                        key={group.id}
                        className={cn(
                            "flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-xs transition-colors",
                            currentGroupId === group.id
                                ? "bg-primary/10 font-medium text-primary"
                                : "text-foreground/70 hover:bg-muted/70"
                        )}
                        onClick={() => { onSelect(group.id); setOpen(false); setKeyword(""); }}
                    >
                      <span className="flex-1 truncate">{group.name}</span>
                      {currentGroupId === group.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                ))}
                {filtered.length === 0 && groups.length > 0 ? (
                    <p className="py-6 text-center text-[11px] text-muted-foreground/50">{t.noMatchGroup}</p>
                ) : null}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </>
  );
}
