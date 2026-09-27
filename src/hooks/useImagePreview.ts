import { useMemo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

export function useImagePreview(path: string | null | undefined) {
    return useMemo(() => (path ? convertFileSrc(path) : null), [path]);
}
