import test from "node:test";
import assert from "node:assert/strict";
import { parseRelease, fetchRelease, RELEASE_API } from "../src/releases.mjs";

const asset = (name, url = `https://github.com/Heyiki/TrayClip/releases/download/v1/${name}`) =>
    ({ name, browser_download_url: url, size: 10485760 });

test("uses actual release metadata, formats and architectures", () => {
    const release = parseRelease({
        tag_name: "v1.2.3", published_at: "2026-11-04T10:00:00Z",
        assets: [asset("TrayClip_x64.exe"), asset("TrayClip_aarch64.dmg"), asset("TrayClip_x64.dmg"),
            asset("TrayClip_amd64.deb"), asset("TrayClip_aarch64.AppImage"), asset("TrayClip_x86_64.rpm"),
            asset("TrayClip_universal.dmg"), asset("TrayClip_i686.msi"), asset("TrayClip.dmg")],
    });
    assert.equal(release.version, "v1.2.3");
    assert.equal(release.date, "2026-11-04");
    assert.deepEqual(release.assets.map((a) => a.architecture),
        ["x64", "Apple Silicon", "Intel", "x64", "ARM64", "x64", "Universal", "x86", "架构见文件名"]);
    assert.equal(release.assets[0].size, "10.0 MB");
});

test("rejects foreign, malformed, credential-bearing and non-installer assets", () => {
    const release = parseRelease({ tag_name: "v1", assets: [
            null, {}, asset("file.exe", "javascript:alert(1)"), asset("file.exe", "https://evil.example/file.exe"),
            asset("file.exe", "https://github.com/Other/TrayClip/releases/download/v1/file.exe"),
            asset("file.exe", "https://user@github.com/Heyiki/TrayClip/releases/download/v1/file.exe"),
            asset("file.exe", "/relative"), asset("file.exe.sig"), asset("source.zip"),
        ] });
    assert.deepEqual(release.assets, []);
});

test("handles missing assets and invalid dates without inventing metadata", () => {
    const release = parseRelease({ tag_name: "v1", published_at: "bad" });
    assert.deepEqual(release, { version: "v1", date: "", assets: [] });
    for (const value of [null, {}, { tag_name: "" }, { tag_name: "v1", draft: true }, { tag_name: "v1", prerelease: true }]) {
        assert.throws(() => parseRelease(value));
    }
});

test("fetches upstream with cancellation and reports HTTP failures", async () => {
    const controller = new AbortController();
    await fetchRelease({ signal: controller.signal, fetcher: async (url, options) => {
            assert.equal(url, RELEASE_API);
            assert.equal(options.signal, controller.signal);
            return { ok: true, json: async () => ({ tag_name: "v1", assets: [] }) };
        } });
    await assert.rejects(fetchRelease({ fetcher: async () => ({ ok: false, status: 403 }) }), /403/);
    await assert.rejects(fetchRelease({ fetcher: async () => { throw new Error("offline"); } }), /offline/);
});
