import { useEffect, useRef } from "react";

export function usePageMotion() {
    const headerRef = useRef<HTMLElement>(null);
    const previewRef = useRef<HTMLElement>(null);
    useEffect(() => {
        const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
        let frame = 0;
        const update = () => {
            frame = 0;
            const header = headerRef.current;
            const preview = previewRef.current;
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            if (header) {
                header.dataset.scrolled = String(window.scrollY > 32);
                header.style.setProperty("--reading-progress", String(maxScroll > 0 ? Math.min(1, window.scrollY / maxScroll) : 0));
            }
            if (preview) {
                const bounds = preview.getBoundingClientRect();
                const offset = reducedMotion.matches ? 0 : Math.max(-12, Math.min(12, (window.innerHeight / 2 - bounds.top - bounds.height / 2) * 0.045));
                preview.style.setProperty("--preview-offset", `${offset}px`);
            }
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
        const resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(document.body);
        update();
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        reducedMotion.addEventListener("change", schedule);
        return () => {
            cancelAnimationFrame(frame);
            resizeObserver.disconnect();
            window.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            reducedMotion.removeEventListener("change", schedule);
        };
    }, []);
    return { headerRef, previewRef };
}
