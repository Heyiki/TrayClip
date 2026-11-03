export function formatClipTime(value: string, locale: string, now: number, lastUsedAt?: string | null) {
    const captured = new Date(value);
    const used = lastUsedAt ? new Date(lastUsedAt) : null;
    const date = used && Number.isFinite(used.getTime()) && used.getTime() > captured.getTime() ? used : captured;
    if (!Number.isFinite(date.getTime())) return { label: "--", title: value };

    const chinese = locale === "zh-CN";
    const title = `${chinese ? "首次采集" : "First captured"}: ${captured.toLocaleString(locale)}${
        used && Number.isFinite(used.getTime())
            ? `\n${chinese ? "最近使用" : "Last used"}: ${used.toLocaleString(locale)}`
            : ""
    }`;
    const elapsed = now - date.getTime();
    const today = new Date(now);
    const sameDay = date.toDateString() === today.toDateString();
    if (sameDay && elapsed >= 0 && elapsed < 60_000) {
        return { label: chinese ? "刚刚" : "Just now", title };
    }
    if (sameDay && elapsed >= 60_000 && elapsed < 3_600_000) {
        const minutes = Math.floor(elapsed / 60_000);
        return { label: chinese ? `${minutes} 分钟前` : `${minutes} min ago`, title };
    }
    if (sameDay && elapsed >= 3_600_000) {
        const hours = Math.floor(elapsed / 3_600_000);
        return { label: chinese ? `${hours} 小时前` : `${hours} hr ago`, title };
    }

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const time = () => date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (sameDay) return { label: time(), title };
    if (date.toDateString() === yesterday.toDateString()) {
        return { label: `${chinese ? "昨天" : "Yesterday"} ${time()}`, title };
    }
    return {
        label: date.toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
            ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
        }),
        title,
    };
}
