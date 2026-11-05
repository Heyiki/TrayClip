import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
    ArrowDown, ArrowDownToLine, ArrowRight, ChevronDown, Clipboard,
    Code2, Globe, Laptop, Languages, Menu, Monitor, Moon, RefreshCw, ShieldCheck, Sun, X,
} from "lucide-react";
import logo from "../../public/logo.png";
import { fetchRelease, RELEASES, REPOSITORY } from "./releases.mjs";
import { type Messages } from "./i18n";
import { usePreferences } from "./usePreferences";
import { useScrollReveal } from "./useScrollReveal";
import { AmbientParticles } from "./AmbientParticles";
import { usePageMotion } from "./usePageMotion";
import { ProductDemo } from "./ProductDemo";
import { PreferenceSelect } from "./PreferenceSelect";
import "./style.css";

type Release = Awaited<ReturnType<typeof fetchRelease>>;
const platforms = ["Windows", "macOS", "Linux"] as const;

function ExternalLink({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>;
}

function Downloads({ t }: { t: Messages }) {
    const [release, setRelease] = useState<Release | null>(null);
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        const timer = window.setTimeout(() => controller.abort(), 10000);
        setState("loading");
        setRelease(null);
        fetchRelease({ signal: controller.signal }).then((result) => {
            if (active) { setRelease(result); setState("ready"); }
        }).catch(() => { if (active) setState("error"); })
            .finally(() => window.clearTimeout(timer));
        return () => { active = false; controller.abort(); window.clearTimeout(timer); };
    }, [attempt]);
    return <section id="download" className="download-section">
        <div className="container">
            <div className="section-heading download-heading" data-reveal>
                <div><p className="eyebrow">{t.downloadEyebrow}</p><h2>{t.downloadHeading}</h2></div>
                <ExternalLink href={RELEASES} className="text-link">{t.allReleases} <ArrowRight size={16} /></ExternalLink>
            </div>
            <div className="release-status" role="status" aria-live="polite">
                {state === "loading" && <><RefreshCw size={15} className="spin" /> {t.loading}</>}
                {state === "ready" && <><span className="status-dot" /><span>{release?.version}{release?.date && ` · ${t.published} ${release.date}`} · {t.releaseSource}</span></>}
                {state === "error" && <>{t.releaseError}
                    <button className="retry" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={14} />{t.retry}</button></>}
            </div>
            <div className="download-grid">
                {platforms.map((platform, index) => {
                    const assets = release?.assets.filter((asset) => asset.platform === platform) ?? [];
                    const Icon = platform === "Windows" ? Monitor : platform === "macOS" ? Laptop : Clipboard;
                    return <article className="download-item" key={platform} data-reveal data-reveal-delay={index * 70}>
                        <div className="platform-name"><Icon size={25} strokeWidth={1.5} /><div><h3>{platform}</h3><p>{t.platformCopy[index]}</p></div></div>
                        <div className="asset-list">
                            {assets.map((asset) => <ExternalLink key={asset.url} href={asset.url} className="asset-link">
                                <span>{asset.architecture === "架构见文件名" ? t.architectureUnknown : asset.architecture} · {asset.format === "安装程序" ? t.installer : asset.format}<small>{asset.name}{asset.size && ` · ${asset.size}`}</small></span><ArrowDownToLine size={17} />
                            </ExternalLink>)}
                            {!assets.length && <ExternalLink href={RELEASES} className="fallback-link">
                                {state === "ready" ? t.viewInstallers : t.githubDownload}<ArrowRight size={16} />
                            </ExternalLink>}
                        </div>
                    </article>;
                })}
            </div>
            {state === "ready" && !release?.assets.length && <p className="download-note">{t.noInstallers}</p>}
            <p className="download-note"><ShieldCheck size={15} /> {t.downloadNote}</p>
        </div>
    </section>;
}

function App() {
    const [menuOpen, setMenuOpen] = useState(false);
    const { t, locale, language, theme, resolvedTheme, changeLanguage, changeTheme } = usePreferences();
    const darkPreview = resolvedTheme === "dark";
    const { headerRef, previewRef } = usePageMotion();
    useScrollReveal();
    useEffect(() => {
        if (!menuOpen) return;
        const close = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setMenuOpen(false);
                document.querySelector<HTMLButtonElement>(".menu-toggle")?.focus();
            }
        };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [menuOpen]);
    return <>
        <AmbientParticles />
        <a className="skip-link" href="#main">{t.skip}</a>
        <header className="site-header" ref={headerRef}>
            <div className="container header-inner">
                <a className="brand" href="#" aria-label={t.home}><img src={logo} width="32" height="32" alt="" />TrayClip</a>
                <nav id="navigation" className={menuOpen ? "navigation is-open" : "navigation"} aria-label={t.navigation} onClick={() => setMenuOpen(false)}>
                    <a href="#features">{t.features}</a><a href="#preview">{t.preview}</a><a href="#faq">{t.faq}</a>
                    <ExternalLink href={REPOSITORY} className="github-nav"><Code2 size={17} />GitHub<ArrowRight size={14} /></ExternalLink>
                    <a className="nav-download" href="#download"><ArrowDownToLine size={15} />{t.download}</a>
                </nav>
                <div className="header-tools">
                    <PreferenceSelect label={t.language} value={language} onChange={changeLanguage} icon={Languages}
                                      options={[{ value: "auto", label: t.languageAuto, icon: Globe }, { value: "zh-CN", label: "简体中文", icon: Languages }, { value: "en", label: "English", icon: Languages }]} />
                    <PreferenceSelect label={t.appearance} value={theme} onChange={changeTheme} icon={resolvedTheme === "dark" ? Moon : Sun}
                                      options={[{ value: "auto", label: t.themeAuto, icon: Monitor }, { value: "light", label: t.light, icon: Sun }, { value: "dark", label: t.dark, icon: Moon }]} />
                    <button className="menu-toggle" title={menuOpen ? t.closeMenu : t.openMenu} aria-label={menuOpen ? t.closeMenu : t.openMenu} aria-expanded={menuOpen} aria-controls="navigation" onClick={() => setMenuOpen(!menuOpen)}>
                        {menuOpen ? <X size={22} /> : <Menu size={22} />}
                    </button>
                </div>
                <span className="reading-progress" aria-hidden="true" />
            </div>
        </header>
        <main id="main">
            <section className="hero">
                <div className="container hero-content">
                    <p className="eyebrow hero-eyebrow">{t.heroEyebrow}</p>
                    <h1><img src={logo} width="64" height="64" alt="" />TrayClip</h1>
                    <p className="hero-headline">{t.headline}</p>
                    <p className="hero-description">{t.heroDescription[0]}{" "}<br className="desktop-break" />{t.heroDescription[1]}</p>
                    <div className="hero-actions">
                        <a href="#download" className="button primary"><ArrowDownToLine size={18} />{t.downloadApp}<ArrowRight size={17} /></a>
                        <ExternalLink href={REPOSITORY} className="button secondary"><Code2 size={18} />{t.source}</ExternalLink>
                    </div>
                    <p className="hero-meta"><span>Windows · macOS · Linux</span><span>{t.heroMeta}</span></p>
                </div>
                <div id="preview" className="hero-product">
                    <div className="container product-toolbar"><span>{t.caption}</span></div>
                    <figure className={`preview-image ${darkPreview ? "dark" : ""}`} ref={previewRef}>
                        <ProductDemo t={t} locale={locale} dark={darkPreview} />
                        <figcaption>{t.screenshot}</figcaption>
                    </figure>
                    <div className="container product-bottom"><span><ShieldCheck size={16} />{t.local}</span><span>{t.shortcut}<kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>V</kbd></span></div>
                </div>
            </section>
            <section id="features" className="features-section container">
                <div className="section-heading" data-reveal><div><p className="eyebrow">{t.featuresEyebrow}</p><h2>{t.featuresHeading}</h2></div><p>{t.featuresCopy[0]}<br />{t.featuresCopy[1]}</p></div>
                <div className="feature-list">{t.featureItems.map(({ name, text }, index) =>
                    <article className="feature" key={index} data-reveal><span className="feature-number">{String(index + 1).padStart(2, "0")}</span><h3>{name}</h3><p>{text}</p></article>
                )}</div>
            </section>
            <Downloads t={t} />
            <section id="faq" className="faq-section container">
                <div data-reveal><p className="eyebrow">{t.faqEyebrow}</p><h2>{t.faqHeading}</h2><ExternalLink href={`${REPOSITORY}/issues`} className="text-link">{t.ask} <ArrowRight size={16} /></ExternalLink></div>
                <div className="faq-list" data-reveal>{t.faqItems.map(([question, answer], index) => <details key={index}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div>
            </section>
        </main>
        <footer className="container site-footer"><a href="#" className="brand"><img src={logo} width="26" height="26" alt="" />TrayClip</a><span>{t.footer}</span><div><ExternalLink href={`${REPOSITORY}/blob/HEAD/LICENSE`}>MIT License</ExternalLink><ExternalLink href={RELEASES}>Releases</ExternalLink><a href="#main" aria-label={t.backTop} title={t.backTop}><ArrowDown size={17} className="back-top" /></a></div></footer>
    </>;
}

createRoot(document.getElementById("root")!).render(<App />);
