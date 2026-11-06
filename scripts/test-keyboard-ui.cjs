const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

async function main() {
    const browser = await chromium.launch({
        headless: true,
        channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    });
    try {
        for (const platform of ["Win32", "Linux x86_64", "MacIntel"]) {
            const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
            page.setDefaultTimeout(10_000);
            const errors = [];
            page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
            await page.addInitScript(platform => {
                Object.defineProperty(navigator, "platform", { value: platform });
            }, platform);
            const base = process.env.TEST_URL || "http://127.0.0.1:1421";
            await page.route(`${base}/`, async route => {
                const response = await route.fetch();
                const html = await response.text();
                const boot = `<script type="module">
                    import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
                    import { emit } from '/node_modules/@tauri-apps/api/event.js';
                    import { FALLBACK_BOOTSTRAP } from '/src/lib/constants.ts';
                    window.emitTestEvent = emit;
                    window.calls = [];
                    const clips = Array.from({ length: 12 }, (_, index) => ({
                        id: 101 + index, content_type: 'plain_text', preview: 'Clip ' + (index + 1),
                        preview_truncated: false, has_url: false, summary: 'Clip ' + (index + 1), image_path: null,
                        file_paths: [], source_app: 'Test', is_pinned: false, is_truncated: false,
                        group_id: null, created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(), last_used_at: null,
                    }));
                    mockWindows('main');
                    mockIPC((cmd, args) => {
                        window.calls.push({ cmd, args });
                        if (cmd === 'get_config') return FALLBACK_BOOTSTRAP;
                        if (cmd === 'list_groups') return [{ id: 1, name: 'Work', created_at: '', updated_at: '' }];
                        if (cmd === 'list_clips') {
                            const items = args.payload.keyword === 'empty' ? [] : args.payload.keyword ? clips.slice(9) : clips;
                            return { items, total: items.length, has_more: false };
                        }
                        if (cmd === 'plugin:app|version') return '0.3.0';
                        return null;
                    }, { shouldMockEvents: true });
                    await import('/src/main.tsx');
                </script>`;
                await route.fulfill({
                    response,
                    body: html.replace(/<script type="module" src="\/src\/main\.tsx(?:\?[^"]*)?"><\/script>/, boot),
                });
            });
            await page.goto(base);
            const search = page.locator("input").first();
            await search.waitFor();
            await page.waitForFunction(() => document.activeElement?.matches("[data-clip-list]"));
            const primary = platform === "MacIntel" ? "Meta" : "Control";
            const other = platform === "MacIntel" ? "Control" : "Meta";
            const copies = () => page.evaluate(() => window.calls.filter(c => c.cmd === "recopy_clip").map(c => c.args.clipId));
            const wake = () => page.evaluate(() => window.emitTestEvent("focus-main-list"));

            // Reopening must release a previously focused search input.
            await search.focus();
            await wake();
            await page.waitForFunction(() => document.activeElement?.matches("[data-clip-list]"));
            await page.keyboard.press("ArrowDown");
            await page.locator('[data-index="0"][data-selected]').waitFor();
            await page.keyboard.press("Enter");
            await page.waitForFunction(() => window.calls.some(c => c.cmd === "recopy_clip"));
            assert.deepEqual(await copies(), [101]);
            await page.keyboard.press("ArrowDown");
            await page.locator('[data-index="1"][data-selected]').waitFor();
            await page.keyboard.press("Enter");
            assert.deepEqual(await copies(), [101, 102]);

            for (let number = 1; number <= 9; number++) {
                await page.keyboard.press(`${primary}+${number}`);
            }
            assert.deepEqual((await copies()).slice(2), [101, 102, 103, 104, 105, 106, 107, 108, 109]);
            const beforeInvalid = await copies();
            for (const combo of [`${other}+1`, `${primary}+Shift+1`, `${primary}+Alt+1`, `${primary}+0`, "1"]) {
                await page.keyboard.press(combo);
            }
            await page.evaluate(platform => {
                document.activeElement.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "1", code: "Digit1", ctrlKey: platform !== "MacIntel",
                    metaKey: platform === "MacIntel", repeat: true, bubbles: true,
                }));
            }, platform);
            assert.deepEqual(await copies(), beforeInvalid);

            await page.keyboard.press(`${primary}+f`);
            await page.waitForFunction(() => document.activeElement?.tagName === "INPUT");
            await search.fill("filtered");
            await page.waitForFunction(() => window.calls.some(c => c.cmd === "list_clips" && c.args.payload.keyword === "filtered"));
            await page.getByText("Clip 10", { exact: true }).waitFor();
            await page.keyboard.press(`${primary}+f`);
            await page.waitForFunction(() => {
                const input = document.querySelector("[data-clip-search]");
                return input.selectionStart === 0 && input.selectionEnd === 8;
            });
            assert.deepEqual(await search.evaluate(el => [el.selectionStart, el.selectionEnd]), [0, 8]);
            const beforeFiltered = (await copies()).length;
            await page.keyboard.press(`${primary}+1`);
            await page.keyboard.press(`${primary}+3`);
            await page.keyboard.press(`${primary}+9`);
            assert.deepEqual((await copies()).slice(beforeFiltered), [110, 112]);
            await page.keyboard.press("ArrowDown");
            assert.equal(await page.locator("[data-selected]").count(), 0);
            await wake();
            await page.waitForFunction(() => document.activeElement?.matches("[data-clip-list]"));
            assert.equal(await search.inputValue(), "filtered");
            await page.keyboard.press("ArrowUp");
            await page.locator('[data-index="0"][data-selected]').waitFor();

            // A real menu and its rename editor must own their keyboard events.
            await page.getByRole("button", { name: "Work", exact: true }).click({ button: "right" });
            await page.getByRole("menu").waitFor();
            const beforeMenu = await copies();
            await page.keyboard.press(`${primary}+1`);
            await page.keyboard.press(`${primary}+f`);
            assert.deepEqual(await copies(), beforeMenu);
            assert.equal(await search.evaluate(el => el === document.activeElement), false);
            await page.getByRole("menuitem", { name: /重命名/ }).click();
            const rename = page.locator("[data-slot='group-bar'] input");
            await rename.waitFor();
            await rename.fill("Renamed");
            await page.keyboard.press(`${primary}+1`);
            await page.keyboard.press(`${primary}+f`);
            assert.deepEqual(await copies(), beforeMenu);
            assert.equal(await rename.evaluate(el => el === document.activeElement), true);
            await page.keyboard.press("Escape");

            // Modal isolation, even when a list selection exists underneath.
            // Open a real confirmation through the row's delete action.
            await page.locator("[data-clip-card]").first().hover();
            await page.locator("[data-clip-card]").first().getByRole("button", { name: /删除/ }).click();
            await page.getByRole("alertdialog").waitFor();
            const beforeDialog = await copies();
            await page.keyboard.press(`${primary}+1`);
            await page.keyboard.press(`${primary}+f`);
            await page.keyboard.press("ArrowDown");
            assert.deepEqual(await copies(), beforeDialog);
            assert.equal(await search.evaluate(el => el === document.activeElement), false);
            await page.keyboard.press("Escape");

            await page.keyboard.press(`${primary}+f`);
            await page.waitForFunction(() => document.activeElement?.matches("[data-clip-search]"));
            await search.fill("empty");
            await page.waitForFunction(() => !document.querySelector("[data-clip-card]"));
            await wake();
            await page.waitForFunction(() => document.activeElement?.matches("[data-clip-list]"));
            const beforeEmpty = await copies();
            await page.keyboard.press(`${primary}+1`);
            assert.deepEqual(await copies(), beforeEmpty);
            await page.keyboard.press(`${primary}+f`);
            await page.waitForFunction(() => document.activeElement?.matches("[data-clip-search]"));
            await search.fill("");
            await page.locator("[data-clip-card]").first().waitFor();

            await page.getByRole("button", { name: "设置", exact: true }).click();
            await page.getByRole("menuitem", { name: "设置", exact: true }).click();
            await page.locator("[data-clip-search]").waitFor({ state: "detached" });
            const beforeSettings = await copies();
            await page.keyboard.press(`${primary}+1`);
            await page.keyboard.press(`${primary}+f`);
            assert.deepEqual(await copies(), beforeSettings);
            assert.equal(await page.locator("[data-clip-search]").count(), 0);
            await page.waitForFunction(() => !document.querySelector("[role='menu']"));
            await wake();
            await page.waitForFunction(() => document.activeElement?.matches("[data-clip-list]"));
            await page.keyboard.press("ArrowDown");
            await page.locator('[data-index="0"][data-selected]').waitFor();
            if (process.env.UI_SCREENSHOT && platform === "Win32") {
                await page.screenshot({ path: process.env.UI_SCREENSHOT });
            }
            assert.deepEqual(errors, []);
            console.log(`${platform}: wake focus, arrows, Enter, digits, search, filters and isolation passed`);
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
