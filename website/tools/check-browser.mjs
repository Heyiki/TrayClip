import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";
import assert from "node:assert/strict";
import { RELEASE_API, REPOSITORY } from "../src/releases.mjs";
import { selectPreference } from "./preferences.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
let origin = process.env.WEBSITE_URL || "http://127.0.0.1:5173";
let server;
if (process.argv.includes("--built")) {
    const root = fileURLToPath(new URL("../../dist-website/", import.meta.url));
    server = createServer(async (request, response) => {
        const pathname = new URL(request.url, "http://localhost").pathname;
        const relative = pathname.slice("/TrayClip/".length) || "index.html";
        const file = resolve(root, relative);
        if (!pathname.startsWith("/TrayClip/") || !file.startsWith(resolve(root) + sep)) {
            response.writeHead(404).end(); return;
        }
        try {
            const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2" };
            response.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
            response.end(await readFile(file));
        } catch { response.writeHead(404).end(); }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${server.address().port}/TrayClip/`;
}
await mkdir(new URL("../qa/", import.meta.url), { recursive: true });
try {
    {
        const page = await browser.newPage({ locale: "zh-CN", reducedMotion: "reduce" });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const release = {
            tag_name: "v9.8.7", published_at: "2026-11-04T10:00:00Z",
            assets: ["TrayClip_x64.exe", "TrayClip_aarch64.dmg", "TrayClip_x64.dmg", "TrayClip_amd64.AppImage"].map((name) => ({
                name, browser_download_url: `${REPOSITORY}/releases/download/v9.8.7/${name}`, size: 12000000,
            })),
        };
        await page.route(RELEASE_API, (route) => route.fulfill({ json: release }));
        for (const [width, height] of [[1440, 1000], [1280, 720], [768, 1024], [390, 844], [320, 740]]) {
            await page.setViewportSize({ width, height });
            await page.goto(origin);
            await page.getByRole("status").filter({ hasText: "v9.8.7" }).waitFor();
            await page.evaluate(() => document.fonts.ready);
            await page.locator("img").evaluateAll(async (images) => {
                await Promise.all(images.map((image) => { image.loading = "eager"; return image.decode(); }));
            });
            const installation = page.locator("details").filter({ hasText: "macOS 提示无法验证开发者，如何安装？" });
            await installation.locator("summary").click({ timeout: 5000 });
            assert.equal(await installation.locator("code").innerText(),
                'xattr -r -d com.apple.quarantine "/Applications/TrayClip.app"\nopen "/Applications/TrayClip.app"');
            assert.ok((await installation.innerText()).includes("隐私与安全性"));
            const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            if (overflowing) console.log(await page.locator("body *").evaluateAll((elements) => elements.filter((element) => {
                const box = element.getBoundingClientRect(); return box.width > 0 && box.right > innerWidth + 1;
            }).map((element) => ({ tag: element.tagName, class: element.getAttribute("class"), right: element.getBoundingClientRect().right })).slice(0, 12)));
            assert.equal(overflowing, false, `Overflow at ${width}`);
            assert.equal(await page.locator(".asset-link").count(), 4);
            assert.equal(await page.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
            const repositoryLinks = await page.locator('a[href^="https://github.com/"]')
                .evaluateAll((links) => links.map((link) => link.href));
            assert.ok(repositoryLinks.length > 0);
            assert.ok(repositoryLinks.every((url) => url === REPOSITORY || url.startsWith(`${REPOSITORY}/`)));
            await page.screenshot({ path: new URL(`../qa/home-${width}.png`, import.meta.url).pathname.slice(1), fullPage: true });
            await installation.locator("summary").click();
        }
        await page.getByRole("button", { name: "打开导航" }).click();
        await page.locator("#navigation").getByRole("link", { name: "下载", exact: true }).click();
        assert.equal(await page.getByRole("button", { name: "打开导航" }).getAttribute("aria-expanded"), "false");
        await selectPreference(page, "外观", "dark");
        await page.locator(".preview-image.dark .product-demo").waitFor();
        assert.equal(await page.locator(".product-demo").getAttribute("data-theme"), "dark");
        const demo = page.frameLocator("iframe.product-demo");
        await demo.getByRole("searchbox").fill("Chrome");
        assert.equal(await demo.locator("[data-clip-card]").count(), 1);
        await page.getByRole("button", { name: "恢复示例", exact: true }).click();
        await demo.getByRole("button", { name: "灵感", exact: true }).click();
        assert.equal(await demo.locator("[data-clip-card]").count(), 1);
        await demo.locator("[data-clip-card]").hover();
        await demo.getByRole("button", { name: "置顶", exact: true }).click();
        await demo.getByRole("button", { name: "取消置顶", exact: true }).waitFor();
        await demo.getByRole("button", { name: "删除", exact: true }).click();
        assert.equal(await demo.locator("[data-clip-card]").count(), 0);
        await page.getByRole("button", { name: "恢复示例", exact: true }).click();
        await demo.getByText("6 条记录", { exact: true }).waitFor();
        await page.getByText("剪贴板内容会上传吗？", { exact: true }).click();
        assert.equal(await page.locator("details[open]").count(), 1);
        await page.unroute(RELEASE_API);
        await page.route(RELEASE_API, (route) => route.fulfill({ status: 403, json: {} }));
        await page.reload();
        await page.getByRole("button", { name: "重试", exact: true }).waitFor();
        assert.equal(await page.locator(".asset-link").count(), 0);
        assert.equal(await page.locator(".fallback-link").count(), 3);
        await page.unroute(RELEASE_API);
        await page.route(RELEASE_API, (route) => route.fulfill({ json: release }));
        await page.getByRole("button", { name: "重试", exact: true }).click();
        await page.locator(".asset-link").first().waitFor();
        assert.equal(await page.locator(".asset-link").count(), 4);
        await page.unroute(RELEASE_API);
        await page.route(RELEASE_API, (route) => route.fulfill({ json: { tag_name: "v1", assets: [] } }));
        await page.reload();
        await page.getByText("当前版本没有可识别的安装包", { exact: false }).waitFor();
        assert.equal(await page.locator(".fallback-link").count(), 3);
        await page.unroute(RELEASE_API);
        await page.route(RELEASE_API, () => {});
        await page.reload();
        await page.getByRole("button", { name: "重试", exact: true }).waitFor({ timeout: 15000 });
        assert.deepEqual(errors, []);
        console.log("PASS: 5 viewports, assets, mobile navigation, theme preview, FAQ, API success/error/retry/empty/timeout; no page errors");
        await page.close();

        for (const locale of ["zh-CN", "en-US"]) {
            for (const colorScheme of ["light", "dark"]) {
                const context = await browser.newContext({ locale, colorScheme, reducedMotion: "reduce" });
                await context.route(RELEASE_API, (route) => route.fulfill({ json: release }));
                const view = await context.newPage();
                view.on("pageerror", (error) => errors.push(error.message));
                for (const width of [320, 390, 768, 820, 1024, 1440]) {
                    await view.setViewportSize({ width, height: 900 });
                    await view.goto(origin);
                    await view.locator(".asset-link").first().waitFor();
                    const installation = view.locator("details").filter({
                        hasText: locale === "zh-CN" ? "macOS 提示无法验证开发者，如何安装？" : "How do I install on macOS if the developer cannot be verified?",
                    });
                    await installation.locator("summary").click();
                    assert.equal(await installation.locator("code").innerText(),
                        'xattr -r -d com.apple.quarantine "/Applications/TrayClip.app"\nopen "/Applications/TrayClip.app"');
                    assert.ok((await installation.innerText()).includes(locale === "zh-CN" ? "会损害你的电脑" : "will damage your computer"));
                    assert.equal(await view.locator("html").getAttribute("lang"), locale === "zh-CN" ? "zh-CN" : "en");
                    assert.equal(await view.locator("html").getAttribute("data-theme"), colorScheme);
                    assert.equal(await view.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${locale}/${colorScheme}/${width} overflow`);
                    assert.equal(await view.getByRole("combobox").count(), 2);
                    assert.equal(await view.locator(".hero-content").evaluate((element) => /[\u3400-\u9fff]/.test(element.textContent)), locale === "zh-CN");
                    const headerItems = await view.locator(".header-inner>.brand,.header-inner>.navigation,.header-tools").evaluateAll((elements) =>
                        elements.filter((element) => getComputedStyle(element).display !== "none").map((element) => {
                            const box = element.getBoundingClientRect();
                            return { left: box.left, right: box.right };
                        }));
                    for (let index = 1; index < headerItems.length; index++) {
                        assert.ok(headerItems[index].left >= headerItems[index - 1].right - 1, `Header overlap at ${locale}/${width}`);
                    }
                    if (width === 320 || width === 1440) {
                        await view.locator("img").evaluateAll(async (images) => {
                            await Promise.all(images.map((image) => { image.loading = "eager"; return image.decode(); }));
                        });
                        await view.screenshot({ path: fileURLToPath(new URL(`../qa/${locale}-${colorScheme}-${width}.png`, import.meta.url)), fullPage: true });
                    }
                }
                await context.close();
            }
        }
        console.log("PASS: 24 bilingual/theme/viewport combinations, translated English content and nonoverlapping header controls");

        const context = await browser.newContext({ locale: "en-US", colorScheme: "dark", reducedMotion: "reduce", viewport: { width: 1440, height: 1000 } });
        await context.route(RELEASE_API, (route) => route.fulfill({ json: release }));
        const prefs = await context.newPage();
        prefs.on("pageerror", (error) => errors.push(error.message));
        await prefs.goto(origin);
        await selectPreference(prefs, "Language", "zh-CN");
        await selectPreference(prefs, "外观", "light");
        await prefs.reload();
        await prefs.getByRole("combobox", { name: "语言", exact: true }).waitFor();
        assert.equal(await prefs.locator("html").getAttribute("lang"), "zh-CN");
        assert.equal(await prefs.locator("html").getAttribute("data-theme"), "light");
        await prefs.emulateMedia({ colorScheme: "light" });
        await prefs.emulateMedia({ colorScheme: "dark" });
        assert.equal(await prefs.locator("html").getAttribute("data-theme"), "light");
        await selectPreference(prefs, "外观", "auto");
        await prefs.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        await prefs.emulateMedia({ colorScheme: "light" });
        await prefs.waitForFunction(() => document.documentElement.dataset.theme === "light");
        await selectPreference(prefs, "语言", "auto");
        await prefs.waitForFunction(() => document.documentElement.lang === "en");
        await prefs.evaluate(() => {
            Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["zh-TW", "en"] });
            window.dispatchEvent(new Event("languagechange"));
        });
        await prefs.waitForFunction(() => document.documentElement.lang === "zh-CN");
        await selectPreference(prefs, "语言", "en");
        await prefs.evaluate(() => window.dispatchEvent(new Event("languagechange")));
        assert.equal(await prefs.locator("html").getAttribute("lang"), "en");
        assert.ok((await prefs.title()).includes("lightweight"));
        assert.ok((await prefs.locator('meta[name="description"]').getAttribute("content")).includes("open-source"));

        const secondTab = await context.newPage();
        await secondTab.goto(origin);
        await selectPreference(secondTab, "Language", "zh-CN");
        await prefs.waitForFunction(() => document.documentElement.lang === "zh-CN");
        await selectPreference(secondTab, "外观", "dark");
        await prefs.waitForFunction(() => document.documentElement.dataset.theme === "dark");
        await context.close();
        console.log("PASS: automatic preferences, manual persistence, live system/browser changes, translated metadata and cross-tab sync");

        for (const savedTheme of [null, "light", "invalid"]) {
            const bootContext = await browser.newContext({ colorScheme: "dark", locale: "en-US" });
            await bootContext.addInitScript((value) => { if (value) localStorage.setItem("trayclip-website-theme", value); }, savedTheme);
            await bootContext.route(/\/assets\/(?:index|main)-[^/]+\.js$/, (route) => route.abort());
            const boot = await bootContext.newPage();
            await boot.goto(origin);
            assert.equal(await boot.locator("html").getAttribute("data-theme"), savedTheme === "light" ? "light" : "dark");
            assert.equal(await boot.evaluate(() => getComputedStyle(document.documentElement).colorScheme), savedTheme === "light" ? "light" : "dark");
            await bootContext.close();
        }
        const blocked = await browser.newContext({ locale: "fr-FR", colorScheme: "dark" });
        await blocked.addInitScript(() => {
            Storage.prototype.getItem = () => { throw new DOMException("Denied", "SecurityError"); };
            Storage.prototype.setItem = () => { throw new DOMException("Denied", "SecurityError"); };
        });
        await blocked.route(RELEASE_API, (route) => route.fulfill({ json: release }));
        const blockedPage = await blocked.newPage();
        blockedPage.on("pageerror", (error) => errors.push(error.message));
        await blockedPage.goto(origin);
        await selectPreference(blockedPage, "Language", "zh-CN");
        await selectPreference(blockedPage, "外观", "light");
        await blockedPage.waitForFunction(() => document.documentElement.dataset.theme === "light");
        await blocked.close();
        console.log("PASS: pre-JavaScript dark/light bootstrap, invalid preferences, unsupported-language fallback and blocked storage");

        const motionContext = await browser.newContext({ locale: "en-US", reducedMotion: "no-preference", viewport: { width: 1440, height: 900 } });
        await motionContext.route(RELEASE_API, (route) => route.fulfill({ json: release }));
        await motionContext.addInitScript(() => {
            const animate = Element.prototype.animate;
            Element.prototype.animate = function (...args) {
                this.dataset.animationCount = String(Number(this.dataset.animationCount || 0) + 1);
                return animate.apply(this, args);
            };
        });
        const motion = await motionContext.newPage();
        await motion.goto(origin);
        await motion.locator(".feature").first().scrollIntoViewIfNeeded();
        await motion.waitForFunction(() => [...document.querySelectorAll(".feature")].some((element) => element.dataset.animationCount === "1"));
        await motion.emulateMedia({ reducedMotion: "reduce" });
        await motion.waitForFunction(() => document.getAnimations().length === 0);
        assert.equal(await motion.locator(".feature").first().evaluate((element) => getComputedStyle(element).opacity), "1");
        await motion.emulateMedia({ reducedMotion: "no-preference" });
        await motion.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        await motion.locator(".feature").first().scrollIntoViewIfNeeded();
        assert.equal(await motion.locator(".feature").first().getAttribute("data-animation-count"), "1");
        await motionContext.close();
        assert.deepEqual(errors, []);
        console.log("PASS: one-time scroll entrance, cancellation when reduced motion is enabled; no page errors");
    }
} finally {
    await browser.close();
    server?.close();
}
