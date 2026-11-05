import { useEffect, useState } from "react";
import { messages, type Locale } from "./i18n";

type Language = "auto" | Locale;
type Theme = "auto" | "light" | "dark";
const languageKey = "trayclip-website-language";
const themeKey = "trayclip-website-theme";

function read(key: string) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* Preferences still work for this visit. */ }
}
function languagePreference(): Language {
    const value = read(languageKey);
    return value === "zh-CN" || value === "en" ? value : "auto";
}
function themePreference(): Theme {
    const value = read(themeKey);
    return value === "light" || value === "dark" ? value : "auto";
}
function browserLanguage(): Locale {
    return /^zh\b/i.test(navigator.languages?.[0] || navigator.language || "") ? "zh-CN" : "en";
}

export function usePreferences() {
    const [language, setLanguage] = useState<Language>(languagePreference);
    const [theme, setTheme] = useState<Theme>(themePreference);
    const [automaticLanguage, setAutomaticLanguage] = useState<Locale>(browserLanguage);
    const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
    const locale = language === "auto" ? automaticLanguage : language;
    const resolvedTheme = theme === "auto" ? (systemDark ? "dark" : "light") : theme;

    useEffect(() => {
        const media = matchMedia("(prefers-color-scheme: dark)");
        const updateTheme = () => setSystemDark(media.matches);
        const updateLanguage = () => setAutomaticLanguage(browserLanguage());
        const syncStorage = (event: StorageEvent) => {
            if (event.key === null || event.key === languageKey) setLanguage(languagePreference());
            if (event.key === null || event.key === themeKey) setTheme(themePreference());
        };
        media.addEventListener("change", updateTheme);
        window.addEventListener("languagechange", updateLanguage);
        window.addEventListener("storage", syncStorage);
        updateTheme();
        updateLanguage();
        return () => {
            media.removeEventListener("change", updateTheme);
            window.removeEventListener("languagechange", updateLanguage);
            window.removeEventListener("storage", syncStorage);
        };
    }, []);
    useEffect(() => {
        document.documentElement.dataset.theme = resolvedTheme;
        document.documentElement.style.colorScheme = resolvedTheme;
        document.documentElement.style.backgroundColor = resolvedTheme === "dark" ? "#191a1d" : "#ffffff";
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#191a1d" : "#ffffff");
    }, [resolvedTheme]);
    useEffect(() => {
        const t = messages[locale];
        document.documentElement.lang = locale;
        document.title = t.title;
        document.querySelector('meta[name="description"]')?.setAttribute("content", t.description);
        document.querySelector('meta[property="og:title"]')?.setAttribute("content", t.title);
        document.querySelector('meta[property="og:description"]')?.setAttribute("content", t.description);
    }, [locale]);
    return {
        language, theme, locale, resolvedTheme, t: messages[locale],
        changeLanguage: (value: Language) => { save(languageKey, value); setLanguage(value); },
        changeTheme: (value: Theme) => { save(themeKey, value); setTheme(value); },
    };
}
