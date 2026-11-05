import { useEffect } from "react";

export function useScrollReveal() {
    useEffect(() => {
        if (!("IntersectionObserver" in window)) return;
        const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
        const animations = new Set<Animation>();
        const seen = new WeakSet<Element>();
        const observer = new IntersectionObserver((entries) => {
            for (const { target, isIntersecting } of entries) {
                if (!isIntersecting) continue;
                observer.unobserve(target);
                seen.add(target);
                if (reducedMotion.matches || !target.animate) continue;
                const animation = target.animate(
                    [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "translateY(0)" }],
                    { duration: 560, delay: Number((target as HTMLElement).dataset.revealDelay || 0), easing: "cubic-bezier(.2,.65,.3,1)", fill: "backwards" },
                );
                animations.add(animation);
                animation.finished.then(() => animations.delete(animation)).catch(() => animations.delete(animation));
            }
        }, { threshold: 0.08 });
        const observe = () => {
            for (const element of document.querySelectorAll("[data-reveal]")) {
                if (!seen.has(element)) observer.observe(element);
            }
        };
        const updateMotion = () => {
            if (reducedMotion.matches) {
                for (const animation of animations) animation.cancel();
                animations.clear();
                observer.disconnect();
            } else observe();
        };
        updateMotion();
        reducedMotion.addEventListener("change", updateMotion);
        return () => {
            observer.disconnect();
            reducedMotion.removeEventListener("change", updateMotion);
            for (const animation of animations) animation.cancel();
        };
    }, []);
}
