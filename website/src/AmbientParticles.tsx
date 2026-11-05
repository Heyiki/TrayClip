import { useEffect, useRef } from "react";

export function AmbientParticles() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
        const finePointer = matchMedia("(pointer: fine)");
        const particles = Array.from({ length: 88 }, (_, index) => ({
            x: ((index * 73 + 19) % 101) / 101,
            y: ((index * 47 + 11) % 103) / 103,
            phase: index * 2.4,
            radius: 1 + (index % 3) * 0.45,
        }));
        let width = 0;
        let height = 0;
        let frame = 0;
        let elapsed = 0;
        let previousTime = 0;
        let color = "";
        let scroll = window.scrollY;
        const pointer = { x: 0, y: 0, active: false };
        const follow = { x: 0, y: 0 };

        const draw = () => {
            context.clearRect(0, 0, width, height);
            context.fillStyle = color;
            context.strokeStyle = color;
            const count = width < 600 ? 32 : particles.length;
            const points = particles.slice(0, count).map((particle) => {
                const moving = !reducedMotion.matches;
                const x = particle.x * width + (moving ? Math.sin(elapsed * 0.16 + particle.phase) * 22 + follow.x * 14 : 0);
                const drift = moving ? elapsed * (3 + particle.radius) - scroll * (0.035 + particle.radius * 0.012) : 0;
                const y = ((particle.y * height + drift) % (height + 40) + height + 40) % (height + 40) - 20 + (moving ? follow.y * 12 : 0);
                const distance = pointer.active && moving ? Math.hypot(x - pointer.x, y - pointer.y) : Infinity;
                const attraction = Math.max(0, 1 - distance / 180) * 0.12;
                const point = { x: x + (pointer.x - x) * attraction, y: y + (pointer.y - y) * attraction, distance };
                context.globalAlpha = 0.22 + (particle.radius - 1) * 0.14 + attraction;
                context.beginPath();
                context.arc(point.x, point.y, particle.radius, 0, Math.PI * 2);
                context.fill();
                return point;
            });
            // Connections appear only near the pointer, leaving the reading area quiet.
            for (let index = 0; index < points.length; index++) {
                if (points[index].distance > 180) continue;
                for (let next = index + 1; next < points.length; next++) {
                    const distance = Math.hypot(points[index].x - points[next].x, points[index].y - points[next].y);
                    if (distance > 110 || points[next].distance > 180) continue;
                    context.globalAlpha = (1 - distance / 110) * 0.18;
                    context.beginPath();
                    context.moveTo(points[index].x, points[index].y);
                    context.lineTo(points[next].x, points[next].y);
                    context.stroke();
                }
            }
            context.globalAlpha = 1;
        };
        const tick = (time: number) => {
            const delta = previousTime ? Math.min(time - previousTime, 50) : 16;
            previousTime = time;
            elapsed += delta / 1000;
            const smoothing = 1 - Math.exp(-delta / 140);
            follow.x += ((pointer.active ? pointer.x / width - 0.5 : 0) - follow.x) * smoothing;
            follow.y += ((pointer.active ? pointer.y / height - 0.5 : 0) - follow.y) * smoothing;
            scroll += (window.scrollY - scroll) * smoothing;
            draw();
            frame = requestAnimationFrame(tick);
        };
        const restart = () => {
            cancelAnimationFrame(frame);
            previousTime = 0;
            color = getComputedStyle(canvas).color;
            draw();
            if (!reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(tick);
        };
        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            const ratio = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            restart();
        };
        const move = (event: PointerEvent) => {
            if (!finePointer.matches || event.pointerType === "touch") return;
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            pointer.active = true;
        };
        const leave = () => { pointer.active = false; };
        const themeObserver = new MutationObserver(restart);
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
        resize();
        window.addEventListener("resize", resize);
        window.addEventListener("pointermove", move, { passive: true });
        document.documentElement.addEventListener("pointerleave", leave);
        window.addEventListener("blur", leave);
        document.addEventListener("visibilitychange", restart);
        reducedMotion.addEventListener("change", restart);
        return () => {
            cancelAnimationFrame(frame);
            themeObserver.disconnect();
            window.removeEventListener("resize", resize);
            window.removeEventListener("pointermove", move);
            document.documentElement.removeEventListener("pointerleave", leave);
            window.removeEventListener("blur", leave);
            document.removeEventListener("visibilitychange", restart);
            reducedMotion.removeEventListener("change", restart);
        };
    }, []);
    return <canvas ref={canvasRef} className="ambient-particles" aria-hidden="true" />;
}
