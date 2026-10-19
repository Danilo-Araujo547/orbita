import { useEffect, useRef } from "react";

interface Star { x: number; y: number; r: number; p: number; f: number; dx: number; dy: number; vx: number; vy: number }
interface Dot { x: number; y: number; ox: number; oy: number; vx: number; vy: number; r: number; c: string }
interface Layer { a: number; d: number; s: Star[] }
interface Pt { x: number; y: number }
interface Particle { u: number; dir: number; speed: number; pos: Pt }
interface Comet { x: number; y: number; vx: number; vy: number; age: number; trail: Pt[] }

const COLLISION = 26;

function coordinates(u: number, w: number, h: number): Pt {
  const k = u * u * (3 - 2 * u);
  const angle = ((146.6 - 113.2 * k) * Math.PI) / 180;
  return { x: w * 0.5 + w * 0.7 * Math.cos(angle), y: h * 1.22 - h * 0.4 * Math.sin(angle) };
}

export default function LoginScene() {
  const skyRef = useRef<HTMLCanvasElement>(null);
  const lightRef = useRef<HTMLCanvasElement>(null);
  const cometRef = useRef<HTMLCanvasElement>(null);
  const flareRef = useRef<HTMLDivElement>(null);
  const orbRefs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const sky = skyRef.current, cc = cometRef.current, flare = flareRef.current, lc = lightRef.current;
    if (!sky || !cc || !flare || !lc) return;
    const sx = sky.getContext("2d"), cx = cc.getContext("2d"), lx = lc.getContext("2d");
    if (!sx || !cx || !lx) return;
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = mq.matches;
    let W = 0, H = 0, mx = 0, my = 0, tx = 0, ty = 0;
    let layers: Layer[] = [];
    let raf = 0, lastFrame: number | null = null, lastLaunch = -10000;
    let disposed = false;

    const particles: Particle[] = [
      { u: 0.12, dir: 1, speed: 0.043, pos: { x: 0, y: 0 } },
      { u: 0.37, dir: -1, speed: 0.045, pos: { x: 0, y: 0 } },
      { u: 0.63, dir: 1, speed: 0.0473, pos: { x: 0, y: 0 } },
      { u: 0.88, dir: -1, speed: 0.043, pos: { x: 0, y: 0 } },
    ];
    const comets: Comet[] = [];
    const contacts = new Set<string>();

    // Os cometas deslocam estrelas (tema escuro) e partículas (tema claro).
    const cometForce = (dot: { vx: number; vy: number }, x: number, y: number, step: number, radius = 118, strength = 1.6) => {
      for (const c of comets) {
        const ddx = x - c.x, ddy = y - c.y, d = Math.hypot(ddx, ddy);
        if (d > 0.001 && d < radius) {
          const fall = (1 - d / radius) ** 2;
          dot.vx += (ddx / d) * strength * fall * step;
          dot.vy += (ddy / d) * strength * fall * step;
        }
      }
    };

    const placeOrbs = () => {
      particles.forEach((p, i) => {
        p.pos = coordinates(p.u, window.innerWidth, window.innerHeight);
        const el = orbRefs.current[i];
        if (el) el.style.transform = `translate(${p.pos.x}px,${p.pos.y}px)`;
      });
    };

    const init = () => {
      W = sky.width = window.innerWidth;
      H = sky.height = window.innerHeight;
      const defs = [
        { n: 0.00012, r: [0.4, 0.8], a: 0.5, d: 6 },
        { n: 0.00006, r: [0.6, 1.1], a: 0.7, d: 14 },
        { n: 0.00002, r: [0.9, 1.5], a: 0.95, d: 26 },
      ];
      layers = defs.map((l) => ({
        a: l.a,
        d: l.d,
        s: Array.from({ length: Math.round(W * H * l.n) }, () => ({
          x: Math.random() * W * 1.1,
          y: Math.random() * H * 1.1,
          r: l.r[0] + Math.random() * (l.r[1] - l.r[0]),
          p: Math.random() * 6.28,
          f: 0.004 + Math.random() * 0.012,
          dx: 0, dy: 0, vx: 0, vy: 0,
        })),
      }));
      placeOrbs();
      if (reduced) drawSky(false);
    };

    const onMove = (e: PointerEvent) => {
      tx = e.clientX / W - 0.5;
      ty = e.clientY / H - 0.5;
    };

    const drawSky = (animate: boolean) => {
      mx += (tx - mx) * 0.04;
      my += (ty - my) * 0.04;
      sx.clearRect(0, 0, W, H);
      const col = getComputedStyle(root).getPropertyValue("--lg-star").trim() || "220,232,255";
      const light = root.dataset.theme === "light";
      for (const l of layers) {
        for (const s of l.s) {
          if (animate) s.p += s.f;
          const tw = 0.6 + 0.4 * Math.sin(s.p);
          const bx = s.x - mx * l.d - W * 0.05;
          const by = s.y - my * l.d - H * 0.05;
          if (!light && animate) {
            cometForce(s, bx + s.dx, by + s.dy, 1, 124, 1.95);
            s.vx -= s.dx * 0.018; s.vy -= s.dy * 0.018;
            s.vx *= 0.885; s.vy *= 0.885;
            s.dx += s.vx; s.dy += s.vy;
          } else { s.dx *= 0.94; s.dy *= 0.94; s.vx *= 0.85; s.vy *= 0.85; }
          const px = bx + s.dx;
          const py = by + s.dy;
          sx.fillStyle = `rgba(${col},${l.a * tw * (light ? 0.4 : 1)})`;
          sx.beginPath();
          sx.arc(px, py, s.r, 0, 6.283);
          sx.fill();
        }
      }
    };

    // ---- Partículas interativas (apenas tema claro) ----
    const lcolors = ["rgba(45,97,158,.48)", "rgba(68,134,187,.42)", "rgba(25,146,178,.43)", "rgba(95,126,177,.38)"];
    const pointer = { x: 0, y: 0, active: false };
    let lw = 0, lh = 0, dots: Dot[] = [], prevT = 0, lraf = 0;
    const lightActive = () => root.dataset.theme === "light" && !reduced;
    // Horizonte: elipse 140vw x 80vh centrada em (50vw,122vh); sem partículas dentro dela.
    const outsideHorizon = (x: number, y: number) => {
      const ex = (x - lw * 0.5) / (lw * 0.7);
      const ey = (y - lh * 1.22) / (lh * 0.4);
      return ex * ex + ey * ey > 1.015;
    };
    const renderLight = () => {
      lx.clearRect(0, 0, lw, lh);
      if (!lightActive()) return;
      for (const d of dots) {
        if (!outsideHorizon(d.x, d.y)) continue;
        lx.beginPath(); lx.fillStyle = d.c; lx.arc(d.x, d.y, d.r, 0, Math.PI * 2); lx.fill();
      }
    };
    const resizeLight = () => {
      lw = window.innerWidth; lh = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      lc.width = Math.round(lw * dpr); lc.height = Math.round(lh * dpr);
      lx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(440, Math.floor((lw * lh) / 3800));
      dots = Array.from({ length: count }, () => {
        let px = 0, py = 0;
        do { px = Math.random() * lw; py = Math.random() * lh; } while (!outsideHorizon(px, py));
        return { x: px, y: py, ox: px, oy: py, vx: 0, vy: 0, r: 0.55 + Math.random() * 0.85, c: lcolors[Math.floor(Math.random() * lcolors.length)] };
      });
      renderLight();
    };
    const onLightMove = (e: PointerEvent) => {
      if (!lightActive() || e.pointerType === "touch") return;
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
    };
    const onPointerOut = (e: PointerEvent) => { if (!e.relatedTarget) pointer.active = false; };
    const onBlur = () => { pointer.active = false; };
    const observer = new MutationObserver(() => {
      pointer.active = false;
      if (!lightActive()) lx.clearRect(0, 0, lw, lh);
      else if (reduced) renderLight();
    });
    const lightTick = (t: number) => {
      if (disposed) return;
      const step = prevT ? Math.min((t - prevT) / 16.67, 2) : 1;
      prevT = t;
      if (lightActive()) {
        for (const d of dots) {
          if (pointer.active) {
            const ddx = d.x - pointer.x, ddy = d.y - pointer.y;
            const dist = Math.hypot(ddx, ddy);
            if (dist < 145 && dist > 0.001) {
              const force = (1 - dist / 145) * 1.25 * step;
              d.vx += (ddx / dist) * force; d.vy += (ddy / dist) * force;
            }
          }
          cometForce(d, d.x, d.y, step, 132, 2.2);
          d.vx += (d.ox - d.x) * 0.012 * step;
          d.vy += (d.oy - d.y) * 0.012 * step;
          const drag = Math.pow(0.89, step);
          d.vx *= drag; d.vy *= drag;
          const nx = d.x + d.vx * step, ny = d.y + d.vy * step;
          if (outsideHorizon(nx, ny)) { d.x = nx; d.y = ny; }
          else { d.vx *= -0.2; d.vy *= -0.2; }
        }
        renderLight();
      }
      lraf = requestAnimationFrame(lightTick);
    };

    const flashAt = (x: number, y: number) => {
      flare.style.left = `${x}px`;
      flare.style.top = `${y}px`;
      if (typeof flare.animate !== "function") return;
      flare.getAnimations().forEach((a) => a.cancel());
      flare.animate(
        [
          { opacity: 0, transform: "scale(.5)" },
          { opacity: 0.3, transform: "scale(.8)", offset: 0.3 },
          { opacity: 0.12, transform: "scale(1.08)", offset: 0.65 },
          { opacity: 0, transform: "scale(1.35)" },
        ],
        { duration: 950, easing: "ease-out" },
      );
    };

    const launchComet = (source: Particle, other: Particle, w: number, h: number) => {
      const start = { ...source.pos };
      const centerX = w * 0.5, centerY = h * 1.22;
      let vx = (start.x - centerX) * 0.53 + (start.x < w / 2 ? -90 : 90);
      let vy = (start.y - centerY) * 0.82 - 90;
      const mag = Math.hypot(vx, vy) || 1;
      const speed = Math.max(390, Math.min(660, w * 0.52));
      vx = (vx / mag) * speed;
      vy = (vy / mag) * speed;
      comets.push({ x: start.x, y: start.y, vx, vy, age: 0, trail: [start] });
      flashAt((start.x + other.pos.x) / 2, (start.y + other.pos.y) / 2);
      source.u = source.dir > 0 ? 0.04 : 0.96;
      source.pos = coordinates(source.u, w, h);
    };

    const drawComets = (dt: number, w: number, h: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cc.width !== Math.round(w * dpr) || cc.height !== Math.round(h * dpr)) {
        cc.width = Math.round(w * dpr);
        cc.height = Math.round(h * dpr);
        cc.style.width = `${w}px`;
        cc.style.height = `${h}px`;
      }
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, w, h);
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.age += dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.trail.unshift({ x: c.x, y: c.y });
        if (c.trail.length > 29) c.trail.pop();
        if ((c.x < -140 || c.x > w + 140 || c.y < -140 || c.y > h + 140) && c.age > 0.5) {
          comets.splice(i, 1);
          continue;
        }
        const alpha = Math.min(1, c.age * 5);
        for (let j = c.trail.length - 1; j > 0; j--) {
          const f = 1 - j / c.trail.length;
          cx.beginPath();
          cx.moveTo(c.trail[j].x, c.trail[j].y);
          cx.lineTo(c.trail[j - 1].x, c.trail[j - 1].y);
          cx.strokeStyle = `rgba(94,168,255,${(f * f * 0.43 * alpha).toFixed(3)})`;
          cx.lineWidth = 0.5 + f * 5;
          cx.lineCap = "round";
          cx.stroke();
        }
        const glow = cx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 24);
        glow.addColorStop(0, `rgba(191,225,255,${0.64 * alpha})`);
        glow.addColorStop(0.18, `rgba(94,168,255,${0.3 * alpha})`);
        glow.addColorStop(1, "rgba(94,168,255,0)");
        cx.fillStyle = glow;
        cx.beginPath();
        cx.arc(c.x, c.y, 24, 0, Math.PI * 2);
        cx.fill();
        cx.fillStyle = `rgba(210,236,255,${0.88 * alpha})`;
        cx.beginPath();
        cx.arc(c.x, c.y, 3.3, 0, Math.PI * 2);
        cx.fill();
      }
    };

    const tick = (t: number) => {
      if (disposed || reduced) return;
      const dt = lastFrame === null ? 0 : Math.min((t - lastFrame) / 1000, 0.05);
      lastFrame = t;
      const w = window.innerWidth, h = window.innerHeight;
      drawSky(true);
      particles.forEach((p) => {
        p.u += p.dir * p.speed * dt;
        if (p.u <= 0) { p.u = -p.u; p.dir = 1; }
        if (p.u >= 1) { p.u = 2 - p.u; p.dir = -1; }
        p.pos = coordinates(p.u, w, h);
      });
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j], key = `${i}-${j}`;
          const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
          if (d < COLLISION) {
            if (
              !contacts.has(key) &&
              t - lastLaunch > 1500 &&
              (a.u - b.u) * (a.dir * a.speed - b.dir * b.speed) < 0
            ) {
              launchComet(a, b, w, h);
              lastLaunch = t;
              b.dir *= -1;
            }
            contacts.add(key);
          } else if (d > COLLISION + 12) {
            contacts.delete(key);
          }
        }
      }
      particles.forEach((p, i) => {
        const el = orbRefs.current[i];
        if (el) el.style.transform = `translate(${p.pos.x}px,${p.pos.y}px)`;
      });
      drawComets(dt, w, h);
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      lastFrame = null;
      if (!reduced) raf = requestAnimationFrame(tick);
    };
    const onMotion = (e: MediaQueryListEvent) => {
      reduced = e.matches;
      if (reduced) {
        cx.clearRect(0, 0, cc.width, cc.height);
        comets.length = 0;
        drawSky(false);
      }
      start();
    };

    init();
    resizeLight();
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("resize", resizeLight, { passive: true });
    window.addEventListener("pointermove", onLightMove, { passive: true });
    document.addEventListener("pointerout", onPointerOut);
    window.addEventListener("blur", onBlur);
    lraf = requestAnimationFrame(lightTick);
    window.addEventListener("resize", init);
    window.addEventListener("pointermove", onMove);
    mq.addEventListener("change", onMotion);
    start();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(lraf);
      observer.disconnect();
      window.removeEventListener("resize", resizeLight);
      window.removeEventListener("pointermove", onLightMove);
      document.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", init);
      window.removeEventListener("pointermove", onMove);
      mq.removeEventListener("change", onMotion);
    };
  }, []);

  return (
    <div className="lg-scene" aria-hidden="true">
      <canvas ref={skyRef} className="lg-sky" />
      <canvas ref={lightRef} className="lg-light" aria-hidden="true" />
      <canvas ref={cometRef} className="lg-comets" />
      <div className="lg-horizon" />
      {[0, 1, 2, 3].map((i) => (
        <i
          key={i}
          className="lg-orb"
          ref={(el) => {
            orbRefs.current[i] = el;
          }}
        />
      ))}
      <div ref={flareRef} className="lg-flare" />
    </div>
  );
}
