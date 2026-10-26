import { useCallback, type RefObject } from "react";
import { hideWindow, quitApp } from "@/lib/api";
import type { AppSettings, ConfirmState } from "@/lib/types";

interface CloseWindowLabels {
    confirmClose: string;
    hideToTray: string;
    exitApp: string;
}

/**
 * The single implementation of what closing the window means. The title bar button and the
 * `close-requested` event both call this, so `close_behavior` cannot end up meaning two
 * different things depending on how the window was closed.
 */
export function useCloseWindowAction(
    settingsRef: RefObject<AppSettings>,
    setConfirm: (state: ConfirmState | null) => void,
    t: CloseWindowLabels,
) {
    return useCallback(() => {
        const behavior = settingsRef.current.close_behavior;
        if (behavior === "hide") {
            void hideWindow();
            return;
        }
        if (behavior === "exit") {
            void quitApp();
            return;
        }
        setConfirm({
            message: t.confirmClose,
            confirmLabel: t.hideToTray,
            cancelLabel: t.exitApp,
            onConfirm: async () => { await hideWindow(); },
            onCancel: async () => { await quitApp(); },
        });
    }, [settingsRef, setConfirm, t.confirmClose, t.exitApp, t.hideToTray]);
}
