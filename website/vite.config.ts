import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    base: "./",
    plugins: [react(), tailwindcss()],
    resolve: {
        alias: [
            { find: "@/lib/i18n", replacement: fileURLToPath(new URL("./src/demo/i18n.tsx", import.meta.url)) },
            { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
        ],
    },
    build: {
        outDir: "../dist-website",
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL("./index.html", import.meta.url)),
                demo: fileURLToPath(new URL("./demo.html", import.meta.url)),
            },
        },
    },
});
