import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { allowImagePreview } from "@/lib/api";

// The asset protocol scope is process-wide and additive, so each path only has to be
// granted once. Failures are not cached: the file may appear later (a download finishing,
// a drive being reconnected) and the next render retries.
const allowedPaths = new Set<string>();
const pendingRequests = new Map<string, Promise<boolean>>();

function ensureAllowed(path: string): Promise<boolean> {
    if (allowedPaths.has(path)) return Promise.resolve(true);
    const pending = pendingRequests.get(path);
    if (pending) return pending;

    const request = allowImagePreview(path)
        .then((allowed) => {
            if (allowed) allowedPaths.add(path);
            return allowed;
        })
        .catch(() => false)
        .finally(() => {
            pendingRequests.delete(path);
        });
    pendingRequests.set(path, request);
    return request;
}

/**
 * Resolves a path to a URL the webview can load. Files inside the managed images directory
 * are already covered by the static asset scope; anything else (a picture the user copied
 * from the desktop, for example) has to be granted explicitly first.
 */
export function useImagePreview(path: string | null | undefined) {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        setReady(false);
        if (!path) return;
        let cancelled = false;
        void ensureAllowed(path).then((allowed) => {
            if (!cancelled) setReady(allowed);
        });
        return () => {
            cancelled = true;
        };
    }, [path]);

    return useMemo(() => (path && ready ? convertFileSrc(path) : null), [path, ready]);
}
