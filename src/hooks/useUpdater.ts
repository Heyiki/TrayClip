import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { checkUpdate, type UpdateInfo } from "@/lib/api";
import { useTranslation } from "@/lib/i18n";

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const RETRY_INTERVAL = 30 * 60 * 1000;
const CHECK_TIME_KEY = "trayclip-update-next-check";

export function useUpdater() {
    const { t } = useTranslation();
    const [update, setUpdate] = useState<UpdateInfo | null>(null);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const latest = useRef<UpdateInfo | null>(null);
    const pending = useRef<Promise<UpdateInfo> | null>(null);
    const nextCheck = useRef(0);
    const startupAt = useRef(Date.now() + 30_000);
    const mounted = useRef(false);
    const translations = useRef(t);
    translations.current = t;

    const check = useCallback(async (manual = true) => {
        if (manual) {
            setNotice(null);
            if (latest.current) setOpen(true);
        }
        if (!pending.current) {
            setChecking(true);
            pending.current = getVersion().then(version => checkUpdate(version, "exe"));
        }
        const request = pending.current;
        try {
            const info = await request;
            nextCheck.current = Date.now() + CHECK_INTERVAL;
            if (!mounted.current) return;
            latest.current = info.has_update ? info : null;
            setUpdate(latest.current);
            if (manual) {
                setOpen(info.has_update);
                if (!info.has_update) setNotice(translations.current.upToDate);
            }
        } catch (error) {
            nextCheck.current = Date.now() + RETRY_INTERVAL;
            if (mounted.current && manual) {
                setNotice(translations.current.checkFailed(String(error)));
            }
        } finally {
            if (pending.current === request) {
                try {
                    localStorage.setItem(CHECK_TIME_KEY, String(nextCheck.current));
                } catch {
                    // Checking still works when persistent storage is unavailable.
                }
                pending.current = null;
                if (mounted.current) setChecking(false);
            }
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        try {
            const saved = Number(localStorage.getItem(CHECK_TIME_KEY));
            if (Number.isFinite(saved) && saved > 0 && saved <= Date.now() + CHECK_INTERVAL) {
                nextCheck.current = saved;
            }
        } catch {
            // Fall back to the startup check when persistent storage is unavailable.
        }
        const checkWhenDue = () => {
            if (Date.now() >= Math.max(startupAt.current, nextCheck.current) && !pending.current) void check(false);
        };
        const startup = window.setTimeout(checkWhenDue, 30_000);
        window.addEventListener("focus", checkWhenDue);
        return () => {
            mounted.current = false;
            window.clearTimeout(startup);
            window.removeEventListener("focus", checkWhenDue);
        };
    }, [check]);

    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => setNotice(null), 5000);
        return () => window.clearTimeout(timer);
    }, [notice]);

    return { update, checking, open, setOpen, notice, dismissNotice: () => setNotice(null), check };
}
