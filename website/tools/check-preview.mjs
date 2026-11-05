import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { selectPreference } from "./preferences.mjs";

const require = createRequire(import.meta.url);
await mkdir(new URL("../qa/", import.meta.url), { recursive: true });
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
    const context = await browser.newContext({ locale: "en-US", colorScheme: "dark", reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(process.env.WEBSITE_URL || "http://127.0.0.1:5173");
    const demo = page.locator(".product-demo");
    await demo.waitFor();
    assert.equal(await demo.count(), 1, "Only one product demo is displayed");
    assert.equal(await demo.getAttribute("data-theme"), "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.querySelector(".product-demo").dataset.theme === "light");
    assert.equal(await page.locator(".theme-switch").count(), 0, "No duplicate preview theme controls");
    const frame = page.frameLocator("iframe.product-demo");
    await frame.getByRole("button", { name: "Toggle theme", exact: true }).click();
    await frame.locator("html[data-theme=dark]").waitFor();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light", "Demo toggle does not change the website");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await frame.locator("html[data-theme=light]").waitFor();
    for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const actions = await page.locator(".hero-actions .button").evaluateAll((buttons) =>
            buttons.map((button) => ({ height: button.getBoundingClientRect().height, text: button.textContent })));
        assert.equal(actions[0].height, actions[1].height, `CTA heights match at ${width}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await selectPreference(page, "Language", "zh-CN");
    await selectPreference(page, "外观", "light");
    await demo.waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: fileURLToPath(new URL("../qa/redesign-first-screen.png", import.meta.url)) });
    console.log("PASS: no duplicate theme controls, internal demo toggle, website theme sync, equal-height mobile CTAs");
    await context.close();
} finally {
    await browser.close();
}
