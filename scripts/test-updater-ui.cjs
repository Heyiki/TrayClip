const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    });
    try {
        const base = process.env.TEST_URL || "http://127.0.0.1:1421";
        const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
        page.setDefaultTimeout(10_000);
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.clock.install();
        await page.route(`${base}/`, async route => {
            const response = await route.fetch();
            const html = await response.text();
            const boot = `<script type="module">
        import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
        import { FALLBACK_BOOTSTRAP } from '/src/lib/constants.ts';
        window.testUpdate = { has_update: false, latest_version: '0.2.13', body: '', download_url: 'https://github.com/Heyiki/TrayClip/releases' };
        window.calls = [];
        mockWindows('main');
        mockIPC((cmd, args) => {
          window.calls.push({ cmd, args });
          if (cmd === 'get_config') return FALLBACK_BOOTSTRAP;
          if (cmd === 'list_groups') return [];
          if (cmd === 'list_clips') return FALLBACK_BOOTSTRAP.clips;
          if (cmd === 'plugin:app|version') return '0.2.13';
          if (cmd === 'check_update') {
            if (window.checkError) throw new Error(window.checkError);
            if (window.delayCheck) return new Promise(resolve => { window.finishCheck = () => resolve(window.testUpdate); });
            return window.testUpdate;
          }
          return null;
        }, { shouldMockEvents: true });
        await import('/src/main.tsx');
      </script>`;
            const entry = /<script type="module" src="\/src\/main\.tsx(?:\?[^"]*)?"><\/script>/;
            assert.ok(entry.test(html));
            await route.fulfill({ response, body: html.replace(entry, boot) });
        });
        await page.goto(base);
        console.log("Loaded application");
        const check = page.getByRole("button", { name: "检查更新", exact: true });
        await check.waitFor();
        await page.clock.fastForward(29_000);
        assert.equal(await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length), 0);
        await page.clock.fastForward(2000);
        await page.waitForFunction(() => window.calls.some(c => c.cmd === "check_update"));
        await check.click();
        await page.getByRole("status").filter({ hasText: "已是最新版本" }).waitFor();
        await page.evaluate(() => { window.checkError = "Network unavailable"; });
        await check.click();
        await page.locator('[role="status"]').filter({ hasText: "检查失败" }).waitFor();
        console.log("Manual feedback passed");
        await page.evaluate(() => {
            window.checkError = null;
            window.testUpdate = {
                ...window.testUpdate, has_update: true, latest_version: "0.2.14",
                body: "Release notes\n".repeat(100) + "x".repeat(500),
            };
        });
        // Time passing alone does not retry; window focus triggers the due check.
        const beforeRetry = await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length);
        await page.clock.fastForward(31 * 60 * 1000);
        assert.equal(await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length), beforeRetry);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        const view = page.getByRole("button", { name: "查看更新", exact: true });
        await view.waitFor();
        console.log("Silent discovery passed");
        assert.equal(await view.locator(".bg-red-500").count(), 1);
        assert.equal(await page.locator('[role="dialog"][data-state="open"]').count(), 0);
        await page.evaluate(() => {
            window.testUpdate = { ...window.testUpdate, latest_version: "0.2.15" };
            window.delayCheck = true;
        });
        const callsBefore = await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length);
        await view.click();
        await page.getByRole("status").filter({ hasText: "检查中" }).waitFor();
        assert.equal(await page.locator('button[aria-label="查看更新"]').isDisabled(), true);
        await page.evaluate(() => { window.delayCheck = false; window.finishCheck(); });
        await page.getByRole("heading", { name: "发现新版本 v0.2.15", exact: true }).waitFor();
        console.log("Release refresh passed");
        assert.equal(await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length), callsBefore + 1);
        const link = page.getByRole("link", { name: "前往下载", exact: true });
        assert.equal(await link.getAttribute("href"), "https://github.com/Heyiki/TrayClip/releases");
        const box = await link.boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 400 && box.y + box.height <= 500);
        if (process.env.UI_SCREENSHOT) await page.screenshot({ path: process.env.UI_SCREENSHOT });
        await page.getByRole("button", { name: "稍后", exact: true }).click();
        await page.evaluate(() => { window.checkError = "Offline"; });
        await view.click();
        await page.locator('[role="status"]').filter({ hasText: "检查失败" }).waitFor();
        await page.getByRole("heading", { name: "发现新版本 v0.2.15", exact: true }).waitFor();
        await page.getByRole("button", { name: "稍后", exact: true }).click();
        // Successful checks keep refreshing even after an update has been discovered.
        await page.evaluate(() => {
            window.checkError = null;
            window.testUpdate = { ...window.testUpdate, latest_version: "0.2.16" };
        });
        await page.clock.fastForward(31 * 60 * 1000);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await page.evaluate(() => Promise.resolve());
        await page.clock.runFor(300);
        assert.equal(await page.locator('[role="dialog"][data-state="open"]').count(), 0);
        const beforeInterval = await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length);
        await page.clock.fastForward(5 * 60 * 60 * 1000);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        assert.equal(await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length), beforeInterval);
        await page.clock.fastForward(61 * 60 * 1000);
        assert.equal(await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length), beforeInterval);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await page.waitForFunction(before => window.calls.filter(c => c.cmd === "check_update").length > before, beforeInterval);
        assert.ok(await page.evaluate(before => window.calls.filter(c => c.cmd === "check_update").length > before, beforeInterval));
        await view.click();
        await page.getByRole("heading", { name: "发现新版本 v0.2.16", exact: true }).waitFor();
        await page.getByRole("button", { name: "稍后", exact: true }).click();
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await page.getByRole("menuitem", { name: "关于", exact: true }).click();
        await page.getByRole("heading", { name: "关于 TrayClip", exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: /检查更新|查看更新/ }).count(), 1);
        const calls = await page.evaluate(() => window.calls);
        assert.ok(calls.filter(c => c.cmd === "check_update").every(c => c.args.currentVersion === "0.2.13" && c.args.installerType === "exe"));
        assert.equal(calls.some(c => /download_update|check_for_update|get_update_state|updater_frontend_ready/.test(c.cmd)), false);
        // Reload shares localStorage, but not the hook's in-memory throttle.
        await page.reload();
        await check.waitFor();
        await page.clock.fastForward(31_000);
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        assert.equal(await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length), 0);
        await check.click();
        await page.getByRole("status").filter({ hasText: "已是最新版本" }).waitFor();
        assert.equal(await page.evaluate(() => window.calls.filter(c => c.cmd === "check_update").length), 1);
        assert.deepEqual(errors, []);
        console.log("Update UI passed: startup delay, focus-driven checks, no periodic requests, persisted throttle, manual bypass, feedback, red dot, release refresh, external download and About entry removal.");
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
