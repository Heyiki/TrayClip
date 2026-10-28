import { CloudDownload, Languages, LoaderCircle, Moon, Settings, Sun, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { TabKey } from "@/lib/types";
import { useTranslation } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WindowBarProps {
    theme: "light" | "dark";
    onTabChange: (tab: TabKey) => void;
    onThemeToggle: () => void;
    onLanguageToggle: () => void;
    onClose: () => void;
    onCheckUpdate: () => void;
    updateAvailable: boolean;
    updateChecking: boolean;
    onDragStart?: () => void;
    onDragEnd?: () => void;
}

export function WindowBar({
                              theme,
                              onTabChange,
                              onThemeToggle,
                              onLanguageToggle,
                              onClose,
                              onCheckUpdate,
                              updateAvailable,
                              updateChecking,
                              onDragStart,
                              onDragEnd,
                          }: WindowBarProps) {
    const { t } = useTranslation();

    return (
        <header
            className="flex h-8 flex-shrink-0 items-center justify-between border-b border-border/50 bg-muted pl-3.5 pr-1.5 select-none"
            onMouseDown={(e) => {
                if (e.button === 0) {
                    onDragStart?.();
                    getCurrentWindow().startDragging();
                    setTimeout(() => onDragEnd?.(), 500);
                }
            }}
        >
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span
            className="cursor-pointer text-xs font-semibold tracking-wide text-primary transition-colors hover:text-primary/80 whitespace-nowrap"
            onClick={() => onTabChange("clips")}
            onMouseDown={(e) => e.stopPropagation()}
        >
          {t.brand}
        </span>
            </div>

            <div
                className="flex flex-shrink-0 items-center"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label={updateAvailable ? t.viewUpdate : t.checkUpdate}
                    title={updateAvailable ? t.viewUpdate : updateChecking ? t.checking : t.checkUpdate}
                    disabled={updateChecking}
                    onClick={onCheckUpdate}
                >
                    {updateChecking ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                    {updateAvailable ? <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-red-500" /> : null}
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label={t.toggleLang}
                    title={t.toggleLang}
                    onClick={onLanguageToggle}
                >
                    <Languages className="h-3.5 w-3.5" />
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label={t.toggleTheme}
                    title={t.toggleTheme}
                    onClick={onThemeToggle}
                >
                    {theme === "light" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" aria-label={t.settings}>
                            <Settings className="h-3.5 w-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-28">
                        <DropdownMenuItem onClick={() => onTabChange("clips")}>
                            {t.home}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onTabChange("settings")}>
                            {t.settings}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onTabChange("about")}>
                            {t.about}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={t.closeWindow}
                    onClick={() => onClose()}
                >
                    <X className="h-3.5 w-3.5" />
                </Button>
            </div>
        </header>
    );
}
