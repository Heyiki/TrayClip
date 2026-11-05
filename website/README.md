# TrayClip Website

Independent Simplified Chinese / English product website. The desktop application's build and runtime are unchanged.
All public project, release and feedback links point to `Heyiki/TrayClip`, not the development fork.

## Local Development

From the repository root:

```sh
npm ci
npm run website:dev -- --port 5173
npm run website:test
npm run website:build
npm run website:preview -- --port 4173
```

The output is `dist-website/`. Assets use relative URLs, supporting both a domain root and the GitHub Pages `/TrayClip/` subpath.

## Deployment

1. Merge these files into the upstream `Heyiki/TrayClip` default branch.
2. In upstream Settings > Pages > Build and deployment, select GitHub Actions.
3. Run the Website workflow, or push a website change to the default branch.
4. Use the deployment URL shown by the workflow. No domain or hosting is provisioned by local development.

The workflow deliberately skips forks. For a custom domain, configure it in upstream Pages settings and configure its DNS records following GitHub's domain instructions. Do not put a fork domain in the official workflow.

## Downloads

The browser requests the latest public, stable GitHub Release without credentials.
Only installer assets whose download URL belongs to `Heyiki/TrayClip` are listed.
Missing assets, HTTP failures, API limits and a ten-second timeout preserve a release-page fallback.
The site never fabricates version numbers, compatibility requirements or installer links.
No analytics or accounts are included. Clipboard writing is limited to explicit copy actions in the sample demo.

## Language, Theme and Motion

The header's language menu offers browser default, Simplified Chinese and English.
Language and appearance use styled Radix select menus with icons, selected indicators, keyboard navigation and focus restoration.
Automatic mode uses the browser's first preferred language: Chinese locales map to Simplified Chinese and other locales fall back to English.
All website copy, status messages, accessible labels, demo data and document metadata are translated.

The appearance menu offers system default, light and dark.
A small script in the HTML head applies the initial appearance before the application loads.
Automatic modes follow browser language and system appearance changes. Manual choices use independent `trayclip-website-language` and `trayclip-website-theme` localStorage keys and synchronize across tabs. If storage is blocked, controls still work for the current visit.
The product preview follows website appearance changes. Its production title-bar theme button can change the demo independently; no duplicate theme controls surround the preview.

Scroll entrance effects use IntersectionObserver and Web Animations, play once per element and never leave content hidden by CSS.
Reduced-motion preferences skip effects and cancel running entrance animations. Native scrolling remains unchanged.

The floating capsule navigation stays above the page and shows reading progress.
A decorative Canvas background adds a sparse particle field with pointer response and scroll parallax. Touch devices use fewer particles without pointer attraction. The loop pauses when the tab is hidden; reduced motion renders a static field and removes preview parallax and navigation movement.
The field uses 88 particles on larger viewports and 32 on mobile.
No animation dependency or external particle service is used.

## Interactive Product Demo

The main preview runs in a same-origin iframe with the production `WindowBar`, `ClipList`, `ClipCard`, `GroupBar`, `GroupSelect`, Radix menus and desktop CSS. The frame isolates desktop styling, portals and document-wide keyboard handlers from the website. Its Vite-only i18n alias uses the production dictionaries without desktop storage/events. The search framing and in-memory data adapter are demo-specific; desktop settings, updates and system window actions are unavailable.

Visitors can search, select/create/rename/delete groups, move sample clips, pin/unpin, delete, double-click to copy and open the real context menus. Hover actions and two-line previews are unchanged from the production components. Reset and copy feedback stay outside the product window. Language and appearance use origin/source-checked messages without reloading the frame.
The search field also reuses `ClipTypeToken`: text (plain and rich), image and file filters combine with keywords and groups. Current examples contain text and a file path; the image filter displays the real empty state.

Only an explicit copy action calls `navigator.clipboard.writeText`. The demo never reads the clipboard, captures local content, calls AI services or persists sample records. A strict mock IPC adapter serves sample full text and rejects unavailable desktop commands. Translation retains its real dialog but reports that its service is not connected. AI is disabled. Only the sample's official repository URL can be opened. A secure context (HTTPS on Pages or localhost) and browser permission are required for copying.

## Browser Checks

With Playwright available in the Node environment, run `node website/tools/check-browser.mjs`.
Use `--built` after building to verify the production output under `/TrayClip/`, including download success/error/retry/empty/timeout states, 24 language/theme/viewport combinations, preference persistence and system changes, blocked storage, pre-app theme initialization and reduced motion.
If using an external Playwright installation, set `PLAYWRIGHT_MODULE_PATH` to its package directory.
Set `PLAYWRIGHT_CHANNEL=msedge` or `chrome` to use an installed browser instead of bundled Chromium.
With the website dev server running, `node website/tools/check-preview.mjs` checks automatic/manual preview themes, the single-demo layout and equal-height mobile actions. Set `WEBSITE_URL` to test another running instance.
`node website/tools/check-motion.mjs` checks actual canvas pixels, pointer response, floating navigation, scroll progress, preview parallax, live reduced-motion/theme changes and mobile anchor visibility.
`node website/tools/check-real-demo.mjs` verifies the actual components' single/double click distinction, hover actions, context menus, copy success/denial, pin/delete/reset, group management and language/theme synchronization across responsive layouts.
`node website/tools/check-preference-menu.mjs` checks custom menu selection, keyboard navigation, focus restoration, persistence and responsive light/dark menu bounds.

Browser checks generate disposable screenshots in `website/qa/`. That directory and the build output `dist-website/` are ignored by Git and can be removed after verification.
