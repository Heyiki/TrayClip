import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function isJson(text: string): boolean {
    if (!text) return false;
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
    try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === "object" && parsed !== null;
    } catch {
        return false;
    }
}

/// Translation engines mangle `snake_case` identifiers, so text is normalized right before it
/// is sent: underscores become spaces, blank runs collapse, and each line is trimmed. Only the
/// request is rewritten — the clipboard record itself always keeps its original form.
/// Idempotent, so callers may normalize both the initial value and the payload.
export function normalizeForTranslation(text: string): string {
    return text
        .replace(/_/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/^ +| +$/gm, "")
        .trim();
}

export function extractUrl(text: string): string | null {
    const start = text.indexOf("https://");
    const idx = start >= 0 ? start : text.indexOf("http://");
    if (idx < 0) return null;
    const rest = text.slice(idx);
    const end = rest.search(/\s/);
    const url = end >= 0 ? rest.slice(0, end) : rest;
    const protoIdx = url.indexOf("://");
    if (protoIdx < 0) return null;
    const afterProto = url.slice(protoIdx + 3);
    if (!afterProto) return null;
    const host = afterProto.split("/")[0] || "";
    if (!host || host.startsWith(":")) return null;
    if (host === "localhost" || host.startsWith("localhost:")) return url;
    if (host.split(":")[0].split(".").every((p) => /^\d+$/.test(p) && Number(p) <= 255)) return url;
    if (host.includes(".")) return url;
    return null;
}
