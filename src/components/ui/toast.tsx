import { Info, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
    const { t } = useTranslation();
    if (!message) return null;
    return (
        <div className="fixed inset-x-3 bottom-3 z-[60] flex items-start gap-2 rounded-md border border-background/20 bg-foreground px-3 py-2.5 text-xs text-background shadow-lg shadow-black/25">
            <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span role="status" aria-live="polite" className="min-w-0 flex-1 break-words font-medium leading-5 [overflow-wrap:anywhere]">{message}</span>
            <button type="button" onClick={onDismiss} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm opacity-75 hover:bg-background/15 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background" aria-label={t.updateBackground} title={t.updateBackground}>
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
