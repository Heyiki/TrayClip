import { createContext, useContext, type ReactNode } from "react";
import { zh } from "../../../src/lib/locales/zh";
import { en } from "../../../src/lib/locales/en";

export type Locale = "zh-CN" | "en";
export type Translations = typeof zh;
const Context = createContext({ locale: "zh-CN" as Locale, t: zh, setLocale: (_locale: Locale) => {} });
export function DemoI18n({ locale, children }: { locale: Locale; children: ReactNode }) {
    return <Context.Provider value={{ locale, t: locale === "en" ? en : zh, setLocale: () => {} }}>{children}</Context.Provider>;
}
export function useTranslation() { return useContext(Context); }
