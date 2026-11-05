import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { selectPreference } from "./preferences.mjs";

const require = createRequire(import.meta.url);
await mkdir(new URL("../qa/", import.meta.url), { recursive: true });
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
try {
    const page = await browser.newPage({ locale: "en-US", colorScheme: "light", reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://api.github.com/**", (route) => route.fulfill({ json: { tag_name: "test", assets: [] } }));
    await page.goto(process.env.WEBSITE_URL || "http://127.0.0.1:5173/");
    const language = page.getByRole("combobox", { name: "Language", exact: true });
    await language.focus();
    await language.press("ArrowDown");
    await page.getByRole("listbox").waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
    assert.equal(await language.evaluate((element) => element === document.activeElement), true, "Escape restores trigger focus");
    await selectPreference(page, "Language", "zh-CN");
    assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
    await page.reload();
    await page.getByRole("combobox", { name: "语言", exact: true }).waitFor();
    for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["light", "dark"]) {
            await selectPreference(page, "外观", theme);
            await page.frameLocator("iframe.product-demo").locator(`html[data-theme=${theme}]`).waitFor();
            await page.waitForTimeout(200);
            assert.equal(await page.locator(".preference-control").allTextContents().then((values) => values.join("")), "", "Icon triggers must not leak selected text into the header");
            for (const label of ["语言", "外观"]) {
                await page.getByRole("combobox", { name: label, exact: true }).click();
                const menu = page.getByRole("listbox");
                const box = await menu.boundingBox();
                assert.ok(box.x >= 11 && box.x + box.width <= width - 11, `${label} menu fits ${width}`);
                assert.equal(await page.getByRole("option", { selected: true }).count(), 1);
                assert.ok((await page.getByRole("option").first().boundingBox()).height >= 44);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
                if ((width === 320 && theme === "dark") || (width === 1440 && theme === "light")) {
                    await page.screenshot({ path: fileURLToPath(new URL(`../qa/preference-${label === "语言" ? "language" : "theme"}-${theme}-${width}.png`, import.meta.url)) });
                }
                await page.keyboard.press("Escape");
            }
        }
    }
    const appearance = page.getByRole("combobox", { name: "外观", exact: true });
    await appearance.focus();
    await appearance.press("ArrowDown");
    await page.getByRole("listbox").waitFor();
    await page.keyboard.press("Home");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-value") === "auto");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => localStorage.getItem("trayclip-website-theme") === "auto");
    assert.equal(await appearance.getAttribute("data-state"), "closed");
    assert.equal(await page.evaluate(() => localStorage.getItem("trayclip-website-theme")), "auto", "Keyboard selects system theme");
    assert.deepEqual(errors, []);
    console.log("PASS: custom preference menus, selected indicators, persisted language, keyboard/Escape/focus and 16 responsive light/dark menus");
} finally { await browser.close(); }
