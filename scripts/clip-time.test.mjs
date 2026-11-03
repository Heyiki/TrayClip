import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/clip-time.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { formatClipTime } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const now = new Date(2026, 10, 2, 14, 32, 8).getTime();
const at = (elapsed) => new Date(now - elapsed).toISOString();

test("relative minute and hour boundaries in both languages", () => {
    for (const [elapsed, zh, en] of [
        [0, "刚刚", "Just now"],
        [59_999, "刚刚", "Just now"],
        [60_000, "1 分钟前", "1 min ago"],
        [300_000, "5 分钟前", "5 min ago"],
        [3_599_999, "59 分钟前", "59 min ago"],
        [3_600_000, "1 小时前", "1 hr ago"],
        [7_199_999, "1 小时前", "1 hr ago"],
        [7_200_000, "2 小时前", "2 hr ago"],
    ]) {
        assert.equal(formatClipTime(at(elapsed), "zh-CN", now).label, zh);
        assert.equal(formatClipTime(at(elapsed), "en", now).label, en);
    }
});

test("local calendar dates, yesterday across year boundary, and leap day", () => {
    const yesterday = new Date(2026, 10, 1, 14, 32).toISOString();
    assert.equal(formatClipTime(yesterday, "zh-CN", now).label, "昨天 14:32");
    assert.equal(formatClipTime(yesterday, "en", now).label, "Yesterday 14:32");
    assert.equal(formatClipTime(new Date(2026, 9, 28).toISOString(), "zh-CN", now).label, "10月28日");
    assert.equal(formatClipTime(new Date(2025, 11, 8).toISOString(), "zh-CN", now).label, "2025年12月8日");
    assert.equal(formatClipTime(new Date(2025, 11, 31, 14).toISOString(), "en", new Date(2026, 0, 1, 14).getTime()).label, "Yesterday 14:00");
    assert.equal(formatClipTime(new Date(2024, 1, 29, 14).toISOString(), "zh-CN", new Date(2024, 2, 1, 14).getTime()).label, "昨天 14:00");
    assert.equal(formatClipTime(new Date(2026, 10, 2, 0, 5).toISOString(), "en", now).label, "14 hr ago");
});

test("calendar boundary takes priority over relative minutes and hours", () => {
    const midnight = new Date(2026, 10, 3, 0, 0, 10).getTime();
    for (const [value, zh, en] of [
        [new Date(2026, 10, 2, 23, 59, 50), "昨天 23:59", "Yesterday 23:59"],
        [new Date(2026, 10, 2, 23, 30), "昨天 23:30", "Yesterday 23:30"],
        [new Date(2026, 10, 2, 21), "昨天 21:00", "Yesterday 21:00"],
    ]) {
        assert.equal(formatClipTime(value.toISOString(), "zh-CN", midnight).label, zh);
        assert.equal(formatClipTime(value.toISOString(), "en", midnight).label, en);
    }
});

test("full timestamp tooltip, future clock skew, and invalid timestamp", () => {
    const result = formatClipTime(at(0), "en", now);
    assert.ok(result.title.startsWith("First captured: "));
    assert.ok(result.title.includes("32:08"));
    assert.equal(formatClipTime(at(-60_000), "zh-CN", now).label, "14:33");
    assert.deepEqual(formatClipTime("invalid", "en", now), { label: "--", title: "invalid" });
});

test("recopy displays last use while preserving capture time in the tooltip", () => {
    const created = at(86_400_000);
    for (const locale of ["zh-CN", "en"]) {
        const result = formatClipTime(created, locale, now, at(0));
        assert.equal(result.label, locale === "zh-CN" ? "刚刚" : "Just now");
        assert.ok(result.title.includes(new Date(created).toLocaleString(locale)));
        assert.ok(result.title.includes(locale === "zh-CN" ? "最近使用:" : "Last used:"));
        assert.equal(formatClipTime(created, locale, now, null).label, formatClipTime(created, locale, now).label);
        assert.equal(formatClipTime(created, locale, now, "invalid").label, formatClipTime(created, locale, now).label);
        assert.equal(formatClipTime(created, locale, now, at(7_200_000)).label, locale === "zh-CN" ? "2 小时前" : "2 hr ago");
    }
});
