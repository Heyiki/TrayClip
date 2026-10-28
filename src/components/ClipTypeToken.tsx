import { Filter, X } from "lucide-react";
import type { ClipTypeFilter } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ClipTypeTokenProps {
    value: ClipTypeFilter;
    /** Label shown inside the token once a type is active; empty for "all". */
    label: string;
    onChange: (value: ClipTypeFilter) => void;
    /** Called after the menu closes (selection or cancel) so typing can continue right away. */
    onClosed?: () => void;
}

/**
 * The type filter lives inside the search field as a prefix token: a bare icon while it
 * matches everything, so the default state costs the search box only about 18px. The clear
 * button is a sibling of the menu trigger, not a child, because a nested button would open
 * the menu instead of resetting the filter.
 */
export function ClipTypeToken({ value, label, onChange, onClosed }: ClipTypeTokenProps) {
    const { t } = useTranslation();
    const active = value !== "all";

    return (
        <span className={cn("inline-flex shrink-0 items-center rounded", active && "bg-primary/10 text-primary")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
                type="button"
                title={t.filterType}
                aria-label={t.filterType}
                className={cn(
                    "inline-flex h-5 items-center gap-1 rounded transition-colors",
                    active
                        ? "pl-1 text-[11px] font-medium"
                        : "px-0.5 text-muted-foreground/60 hover:text-foreground",
                )}
            >
              <Filter className="h-3.5 w-3.5" />
                {active ? <span className="max-w-[40px] truncate">{label}</span> : null}
            </button>
          </DropdownMenuTrigger>
            {/* Focus belongs in the search box afterwards, not on the trigger: choosing a type is
              always followed by typing a keyword, never by reopening this menu. */}
            <DropdownMenuContent
                align="start"
                className="w-36"
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    onClosed?.();
                }}
            >
            <DropdownMenuLabel className="text-[10px] tracking-wide text-muted-foreground/60">
              {t.filterType}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as ClipTypeFilter)}>
              <DropdownMenuRadioItem value="all" className="text-xs">{t.all}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="text" className="text-xs">{t.filterText}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="image" className="text-xs">{t.contentType.image}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="file" className="text-xs">{t.filterFile}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

            {active ? (
                <button
                    type="button"
                    title={t.clearTypeFilter}
                    aria-label={t.clearTypeFilter}
                    className="mr-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-primary/70 transition-colors hover:bg-primary/15 hover:text-primary"
                    onClick={() => onChange("all")}
                >
                    <X className="h-2.5 w-2.5" />
                </button>
            ) : null}
      </span>
    );
}
