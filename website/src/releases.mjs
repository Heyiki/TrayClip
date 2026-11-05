export const REPOSITORY = "https://github.com/Heyiki/TrayClip";
export const RELEASES = `${REPOSITORY}/releases/latest`;
export const RELEASE_API = "https://api.github.com/repos/Heyiki/TrayClip/releases/latest";

const formats = [
    { extension: ".exe", platform: "Windows", label: "安装程序" },
    { extension: ".msi", platform: "Windows", label: "MSI" },
    { extension: ".dmg", platform: "macOS", label: "DMG" },
    { extension: ".appimage", platform: "Linux", label: "AppImage" },
    { extension: ".deb", platform: "Linux", label: "DEB" },
    { extension: ".rpm", platform: "Linux", label: "RPM" },
];

export function parseRelease(data) {
    if (!data || typeof data.tag_name !== "string" || !data.tag_name.trim() || data.draft || data.prerelease) {
        throw new Error("Invalid public release");
    }
    const assets = (Array.isArray(data.assets) ? data.assets : []).flatMap((asset) => {
        if (!asset || typeof asset.name !== "string" || typeof asset.browser_download_url !== "string") return [];
        const format = formats.find(({ extension }) => asset.name.toLowerCase().endsWith(extension));
        if (!format) return [];
        let url;
        try { url = new URL(asset.browser_download_url); } catch { return []; }
        if (url.origin !== "https://github.com" || url.username || url.password ||
            !url.pathname.startsWith("/Heyiki/TrayClip/releases/download/")) return [];
        const name = asset.name.toLowerCase();
        const architecture = /universal/.test(name) ? "Universal"
            : /aarch64|arm64/.test(name) ? (format.platform === "macOS" ? "Apple Silicon" : "ARM64")
                : /x86_64|x64|amd64/.test(name) ? (format.platform === "macOS" ? "Intel" : "x64")
                    : /i[3-6]86|ia32/.test(name) ? "x86" : "架构见文件名";
        return [{
            name: asset.name, url: url.href, platform: format.platform, format: format.label,
            architecture, size: typeof asset.size === "number" && asset.size > 0
                ? `${(asset.size / 1024 / 1024).toFixed(1)} MB` : "",
        }];
    });
    const date = typeof data.published_at === "string" ? new Date(data.published_at) : null;
    return {
        version: data.tag_name,
        date: date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "",
        assets,
    };
}

export async function fetchRelease({ signal, fetcher = fetch } = {}) {
    const response = await fetcher(RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" }, signal,
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    return parseRelease(await response.json());
}
