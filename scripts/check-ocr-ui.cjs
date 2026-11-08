const assert = require("node:assert/strict");
const { mkdir } = require("node:fs/promises");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
    const fixtureUrl = new URL("/scripts/ocr/ui.html", process.env.TEST_URL || "http://127.0.0.1:1421").href;
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    });
    try {
        await mkdir("docs/ui-qa", { recursive: true });
        const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
        await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width: 320, height: 500 });
        await page.goto(`${fixtureUrl}?slow`);
        await page.getByRole("button", { name: "下载并识别" }).click();
        await page.getByRole("button", { name: "取消下载", exact: true }).waitFor();
        await page.screenshot({ path: "docs/ui-qa/ocr-cancel-320.png" });
        await page.getByRole("button", { name: "取消下载", exact: true }).click();
        await page.getByRole("button", { name: "浏览器下载", exact: true }).waitFor({ timeout: 1000 });
        assert.equal(await page.getByRole("alert").count(), 0);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Closed", exact: true }).click();
        await page.getByRole("button", { name: "导入引擎包", exact: true }).click();
        await page.getByRole("textbox").waitFor();
        assert.equal(await page.getByRole("alert").count(), 0);
        await page.goto(`${fixtureUrl}?slow`);
        await page.getByRole("button", { name: "下载并识别" }).click();
        await page.locator("progress").waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Closed", exact: true }).click();
        await page.locator("progress").waitFor({ timeout: 1000 });
        assert.equal(await page.locator("#root").getAttribute("data-install-calls"), "1");
        await page.getByRole("textbox").waitFor();
        assert.equal(await page.getByRole("alert").count(), 0);
        await page.goto(`${fixtureUrl}?slow&fail`);
        await page.getByRole("button", { name: "下载并识别" }).click();
        await page.locator("progress").waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Closed", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Network unavailable" }).waitFor();
        await page.getByRole("button", { name: "下载并识别" }).click();
        await page.getByRole("textbox").waitFor();
        assert.equal(await page.locator("#root").getAttribute("data-install-calls"), "2");
        await page.goto(`${fixtureUrl}?slow`);
        await page.getByRole("button", { name: "下载并识别" }).click();
        await page.locator("progress").waitFor();
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.getElementById("root").dataset.installFinished === "true");
        await page.getByRole("button", { name: "Closed", exact: true }).click();
        await page.getByRole("textbox").waitFor();
        assert.equal(await page.locator("#root").getAttribute("data-install-calls"), "1");
        await page.goto(`${fixtureUrl}?fail`);
        await page.setViewportSize({ width: 320, height: 500 });
        await page.getByRole("button", { name: "导入引擎包" }).waitFor();
        const browserDownload = page.getByRole("button", { name: "浏览器下载", exact: true });
        await browserDownload.click({ timeout: 3000 });
        assert.equal(await page.locator("#root").getAttribute("data-opened-url"),
            "https://github.com/Heyiki/TrayClip/releases/download/v0.3.2/trayclip-ocr-0.1.0-x86_64-pc-windows-msvc.zip");
        assert.equal(await page.getByRole("textbox").count(), 0, "Opening a browser must not start installation");
        const consentBox = await page.getByRole("dialog").boundingBox();
        assert.ok(consentBox.x >= 0 && consentBox.x + consentBox.width <= 320);
        assert.ok(consentBox.y >= 0 && consentBox.y + consentBox.height <= 500);
        await page.screenshot({ path: "docs/ui-qa/ocr-install-320.png" });
        await page.setViewportSize({ width: 400, height: 500 });
        await page.getByRole("button", { name: "下载并识别" }).click();
        await page.getByRole("alert").waitFor();
        await browserDownload.click();
        await page.getByRole("button", { name: "下载并识别" }).click();
        await page.getByText("正在下载 OCR 模型...", { exact: true }).waitFor();
        assert.equal(await page.locator("progress").count(), 0);
        await page.getByText("正在校验并安装...", { exact: true }).waitFor();
        assert.equal(await page.getByRole("button", { name: "取消下载", exact: true }).count(), 0);
        await page.getByText("正在识别...", { exact: true }).waitFor();
        const editor = page.getByRole("textbox");
        await editor.waitFor();
        assert.equal(await editor.inputValue(), "TrayClip 图片识别\nHello OCR");
        await editor.fill("Edited OCR text");
        await page.getByRole("button", { name: "复制", exact: true }).click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "Edited OCR text");
        for (const width of [320, 400]) {
            await page.setViewportSize({ width, height: 500 });
            const box = await page.getByRole("dialog").boundingBox();
            assert.ok(box.x >= 0 && box.x + box.width <= width);
            assert.ok(box.y >= 0 && box.y + box.height <= 500);
        }
        await page.screenshot({ path: "docs/ui-qa/ocr-result.png" });
        await page.goto(`${fixtureUrl}?offline&models`);
        await page.getByRole("button", { name: "导入引擎包" }).click();
        await page.getByRole("textbox").waitFor();
        await page.goto(`${fixtureUrl}?cancel`);
        await page.getByRole("button", { name: "导入引擎包" }).click();
        await page.getByRole("button", { name: "下载并识别" }).waitFor();
        await page.goto(`${fixtureUrl}?unavailable`);
        await page.getByRole("alert").waitFor();
        assert.equal(await page.getByRole("button", { name: "下载并识别" }).count(), 0);
        assert.equal(await browserDownload.count(), 0);
        await page.goto(`${fixtureUrl}?engine`);
        await page.getByRole("button", { name: "下载并识别" }).waitFor();
        assert.equal(await browserDownload.count(), 0, "Installed engines do not need a browser download");
        await page.goto(`${fixtureUrl}?browserfail&locale=en`);
        await page.getByRole("button", { name: "Download in browser", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Browser unavailable" }).waitFor();
        await page.getByRole("button", { name: "Import engine", exact: true }).waitFor();
        await page.goto(`${fixtureUrl}?ready&empty&locale=en&theme=dark`);
        await page.getByRole("textbox").waitFor();
        assert.equal(await page.getByRole("textbox").inputValue(), "");
        assert.equal(await page.getByRole("button", { name: "Copy", exact: true }).isDisabled(), true);
        await page.keyboard.press("Escape");
        await page.getByText("Closed", { exact: true }).waitFor();
        assert.deepEqual(errors, []);
        console.log("PASS: cancel/reopen/import, close/reopen resumes one installation, background completion, resumed failure/retry, pinned browser download, browser failure, consent, install stages, offline import/cancel, model reuse, missing manifest, editing/copy, empty result, Escape and 320/400px layout");
    } finally {
        await browser.close();
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
