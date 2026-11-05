import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { RELEASE_API } from "../src/releases.mjs";
import { selectPreference } from "./preferences.mjs";

const require = createRequire(import.meta.url);
await mkdir(new URL("../qa/", import.meta.url), { recursive: true });
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
    const page = await browser.newPage({ locale: "en-US", colorScheme: "light", viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(RELEASE_API, (route) => route.fulfill({ json: { tag_name: "v-test", assets: [] } }));
    await page.addInitScript(() => {
        window.particleFrames = 0;
        const clear = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (...args) {
            window.particleFrames++;
            window.particlePoints = [];
            return clear.apply(this, args);
        };
        const arc = CanvasRenderingContext2D.prototype.arc;
        CanvasRenderingContext2D.prototype.arc = function (...args) {
            window.particlePoints.push(args.slice(0, 2));
            return arc.apply(this, args);
        };
    });
    await page.goto(process.env.WEBSITE_URL || "http://127.0.0.1:5173");
    await page.waitForFunction(() => window.particleFrames > 3);
    const canvas = page.locator(".ambient-particles");
    assert.equal(await canvas.getAttribute("aria-hidden"), "true");
    assert.equal(await canvas.evaluate((element) => getComputedStyle(element).pointerEvents), "none");
    const pixels = await canvas.evaluate((element) => {
        const data = element.getContext("2d").getImageData(0, 0, element.width, element.height).data;
        return data.reduce((count, alpha, index) => count + (index % 4 === 3 && alpha > 0 ? 1 : 0), 0);
    });
    assert.ok(pixels > 100, "Particle canvas is nonblank");
    assert.equal(await page.evaluate(() => window.particlePoints.length), 88, "Desktop particle density increased");
    const original = await page.evaluate(() => ({ point: window.particlePoints[0], frames: window.particleFrames }));
    await page.mouse.move(original.point[0] + 100, original.point[1]);
    await page.waitForFunction((frames) => window.particleFrames >= frames + 5, original.frames);
    const moved = await page.evaluate(() => window.particlePoints[0]);
    assert.ok(Math.abs(moved[0] - original.point[0]) > 2, "Particles respond to the pointer");
    const top = await page.locator(".site-header").evaluate((element) => element.getBoundingClientRect().top);
    const previewBefore = await page.locator(".preview-image").evaluate((element) => element.style.getPropertyValue("--preview-offset"));
    await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
    await page.waitForFunction(() => document.querySelector(".site-header").dataset.scrolled === "true");
    const header = await page.locator(".site-header").evaluate((element) => ({
        position: getComputedStyle(element).position,
        progress: Number(element.style.getPropertyValue("--reading-progress")),
    }));
    assert.equal(header.position, "fixed");
    assert.ok(header.progress > 0);
    await page.waitForFunction((previous) => document.querySelector(".preview-image").style.getPropertyValue("--preview-offset") !== previous, previewBefore);
    await page.waitForTimeout(300);
    await page.screenshot({ path: fileURLToPath(new URL("../qa/motion-scrolled-1440.png", import.meta.url)) });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => document.querySelector(".preview-image").style.getPropertyValue("--preview-offset") === "0px");
    const frozen = await canvas.evaluate((element) => element.toDataURL());
    await page.waitForTimeout(150);
    assert.equal(await canvas.evaluate((element) => element.toDataURL()), frozen, "Reduced motion stops the particle loop");
    assert.equal(await page.locator(".site-header").evaluate((element) => element.getBoundingClientRect().top), top);
    await selectPreference(page, "Appearance", "dark");
    await page.waitForTimeout(100);
    assert.notEqual(await canvas.evaluate((element) => element.toDataURL()), frozen, "Static particles repaint for dark theme");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const resumed = await page.evaluate(() => window.particleFrames);
    await page.waitForFunction((frames) => window.particleFrames > frames + 3, resumed);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.locator(".product-demo").waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const [theme, width] of [["dark", 1440], ["light", 390]]) {
        await selectPreference(page, "Appearance", theme);
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(100);
        await page.screenshot({ path: fileURLToPath(new URL(`../qa/motion-${theme}-${width}.png`, import.meta.url)) });
    }
    assert.equal(await page.evaluate(() => window.particlePoints.length), 32, "Mobile particle count stays limited");
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.screenshot({ path: fileURLToPath(new URL("../qa/motion-mobile-menu.png", import.meta.url)) });
    await page.locator("#navigation").getByRole("link", { name: "Download", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#download").getBoundingClientRect().top < 110);
    assert.ok(await page.locator("#download").evaluate((element) => element.getBoundingClientRect().top) > 70, "Anchor heading stays below the floating header");
    assert.deepEqual(errors, []);
    console.log("PASS: nonblank moving canvas, pointer response, fixed capsule, scroll progress/parallax, live reduced motion/theme, resumed animation and unobscured mobile anchor");
} finally {
    await browser.close();
}
