import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CityState, DistrictId } from "./sim/types";
import { DISTRICTS } from "./sim/world";
import {
  building, clock, creditMilestone, creditWheelReading, dayOf, FESTIVAL_COST, GAME_MIN_PER_SEC, godFestival, godRain, godSun, godTrees, log, newCity, step, TREE_COST,
} from "./sim/engine";
import { districtCenter, project, render, type Camera, type Hit } from "./render/render";
import { fetchMilestones, fetchStatus, LABEL_TEXT, type EventsResult, type WheelReading } from "./api/squeek";
import { deleteCity, loadCity, saveCity } from "./save";
import { BuildingPanel, Chronicle, Citizens, DistrictPanel, HamsterPanel, Overview, SqueekPanel } from "./ui/Panels";
import { WalletControl } from "./ui/WalletControl";

const PX = 2; // one art pixel = 2 CSS pixels
/** Frame the whole city: the map is 832 x 416 art pixels at zoom 1. */
function cityCam(): Camera {
  const el = document.querySelector(".canvas-wrap");
  const W = (el?.clientWidth ?? window.innerWidth) / PX, H = (el?.clientHeight ?? window.innerHeight * 0.6) / PX;
  return { x: 0, y: 13 * 16 - 10, zoom: Math.max(0.45, Math.min(1.4, Math.min(W / 760, H / 440))) };
}
type Tab = "map" | "citizens" | "chronicle" | "squeek";

export default function App() {
  const [city, setCity] = useState<CityState | null>(null);
  const cityRef = useRef<CityState | null>(null);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [view, setView] = useState<DistrictId | null>(null);
  const [sel, setSel] = useState<{ building: string | null; hamster: string | null }>({ building: null, hamster: null });
  const [tab, setTab] = useState<Tab>("map");
  const [sheetOpen, setSheetOpen] = useState(true);
  const [reading, setReading] = useState<WheelReading | null>(null);
  const [events, setEvents] = useState<EventsResult | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ ...districtCenter("corp"), zoom: 1 });
  const camTarget = useRef<Camera | null>(null);
  const hits = useRef<Hit[]>([]);
  const size = useRef({ W: 300, H: 200 });
  const rain = useMemo(() => Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random() })), []);
  const viewRef = useRef(view); viewRef.current = view;
  const selRef = useRef(sel); selRef.current = sel;

  const showToast = useCallback((t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? null : x)), 3200); }, []);

  /* load or found the city */
  useEffect(() => {
    loadCity().catch(() => null).then((saved) => {
      const s = saved ?? newCity();
      if (saved) log(s, "city", "Welcome back. The city was restored from this browser's local save.");
      cityRef.current = s; setCity(s);
      cam.current = cityCam();
    });
  }, []);

  /* simulation clock + render loop */
  useEffect(() => {
    if (!city) return;
    let raf = 0, last = performance.now(), acc = 0, uiAcc = 0;
    const loop = (now: number) => {
      const s = cityRef.current!;
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      acc += dt * GAME_MIN_PER_SEC * s.speed;
      const whole = Math.floor(acc);
      if (whole > 0) { step(s, whole); acc -= whole; }
      // camera easing toward a district
      if (camTarget.current) {
        const c = cam.current, t = camTarget.current, k = 1 - Math.pow(0.002, dt);
        c.x += (t.x - c.x) * k; c.y += (t.y - c.y) * k; c.zoom += (t.zoom - c.zoom) * k;
        if (Math.abs(t.x - c.x) < 0.5 && Math.abs(t.zoom - c.zoom) < 0.01) camTarget.current = null;
      }
      const cv = canvasRef.current;
      if (cv) {
        const g = cv.getContext("2d")!;
        const out = render(g, size.current.W, size.current.H, s, cam.current, now, viewRef.current, selRef.current, rain);
        hits.current = out.hits;
      }
      uiAcc += dt;
      if (uiAcc > 0.25) { uiAcc = 0; bump(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [city, bump, rain]);

  /* canvas sizing */
  useEffect(() => {
    const el = wrapRef.current, cv = canvasRef.current;
    if (!el || !cv) return;
    const ro = new ResizeObserver(() => {
      const W = Math.ceil(el.clientWidth / PX), H = Math.ceil(el.clientHeight / PX);
      cv.width = W; cv.height = H; size.current = { W, H };
      cv.style.width = `${W * PX}px`; cv.style.height = `${H * PX}px`;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [city]);

  /* autosave to IndexedDB */
  useEffect(() => {
    if (!city) return;
    const save = () => saveCity(cityRef.current!).then(() => setSavedAt(new Date().toLocaleTimeString())).catch(() => setSavedAt("failed"));
    const id = window.setInterval(save, 15000);
    const onHide = () => { if (document.visibilityState === "hidden") save(); };
    document.addEventListener("visibilitychange", onHide);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onHide); };
  }, [city]);

  /* real Squeekchain wheel */
  useEffect(() => {
    if (!city) return;
    let alive = true;
    const poll = async () => {
      const r = await fetchStatus();
      if (!alive) return;
      setReading(r);
      const s = cityRef.current!;
      if (r.bonusEligible && r.key && r.rpm) {
        const amt = creditWheelReading(s, r.key, r.rpm, new Date());
        if (amt > 0) showToast(`Power surge: the real wheel is running at ${r.rpm.toFixed(0)} RPM, +${amt} WE`);
      }
    };
    const pollEvents = async () => {
      const e = await fetchMilestones();
      if (!alive) return;
      setEvents(e);
      const s = cityRef.current!;
      for (const m of [...e.milestones].reverse()) {
        const amt = creditMilestone(s, m.id, m.text, m.occurredAt);
        if (amt > 0) showToast(`Milestone: ${m.text}, +${amt} WE`);
      }
    };
    poll(); pollEvents();
    const a = window.setInterval(poll, 15000), b = window.setInterval(pollEvents, 60000);
    return () => { alive = false; window.clearInterval(a); window.clearInterval(b); };
  }, [city, showToast]);

  const enter = useCallback((d: DistrictId) => {
    const c = districtCenter(d);
    camTarget.current = { x: c.x, y: c.y, zoom: window.innerWidth < 700 ? 1.5 : 1.8 };
    setView(d); setSel({ building: null, hamster: null }); setTab("map"); setSheetOpen(true);
  }, []);
  const backToCity = useCallback(() => {
    camTarget.current = cityCam();
    setView(null); setSel({ building: null, hamster: null }); setTab("map");
  }, []);
  const nav = useMemo(() => ({
    selectHamster: (id: string) => { setSel({ building: null, hamster: id }); setTab("map"); setSheetOpen(true); },
    selectBuilding: (id: string) => {
      const b = building(cityRef.current!, id);
      if (b && viewRef.current !== b.district) enter(b.district);
      setSel({ building: id, hamster: null }); setTab("map"); setSheetOpen(true);
    },
    enter, toast: showToast, bump,
  }), [enter, showToast, bump]);

  /* pointer: drag to pan, wheel/pinch to zoom, tap to pick */
  const drag = useRef<{ x: number; y: number; moved: boolean; pts: Map<number, { x: number; y: number }>; pinch: number | null }>({ x: 0, y: 0, moved: false, pts: new Map(), pinch: null });
  const zoomBy = (f: number) => { camTarget.current = null; cam.current.zoom = Math.max(0.6, Math.min(3.2, cam.current.zoom * f)); };
  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const d = drag.current; d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pts.size === 1) { d.x = e.clientX; d.y = e.clientY; d.moved = false; }
    if (d.pts.size === 2) { const [p, q] = [...d.pts.values()]; d.pinch = Math.hypot(p.x - q.x, p.y - q.y); d.moved = true; }
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current; if (!d.pts.has(e.pointerId)) return;
    d.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d.pts.size === 2 && d.pinch) {
      const [p, q] = [...d.pts.values()]; const dist = Math.hypot(p.x - q.x, p.y - q.y);
      zoomBy(dist / d.pinch); d.pinch = dist; return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) { camTarget.current = null; cam.current.x -= dx / PX / cam.current.zoom; cam.current.y -= dy / PX / cam.current.zoom; d.x = e.clientX; d.y = e.clientY; }
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = drag.current; d.pts.delete(e.pointerId); if (d.pts.size < 2) d.pinch = null;
    if (d.moved || d.pts.size > 0) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / PX, y = (e.clientY - r.top) / PX;
    const s = cityRef.current!;
    const under = hits.current.filter((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1).sort((a, b) => b.depth - a.depth);
    const ham = under.find((h) => h.kind === "hamster");
    const bld = under.find((h) => h.kind === "building");
    if (!viewRef.current) {
      const target = ham ? (building(s, s.hamsters.find((h) => h.id === ham.id)?.at ?? null)?.district ?? null) : bld ? building(s, bld.id)!.district : null;
      if (ham) { nav.selectHamster(ham.id); if (target) enter(target); setSel({ building: null, hamster: ham.id }); return; }
      if (target) { enter(target); if (bld) setSel({ building: bld.id, hamster: null }); }
      return;
    }
    if (ham) nav.selectHamster(ham.id);
    else if (bld) nav.selectBuilding(bld.id);
  }

  if (!city) return <div className="loading" role="status">Opening SqueekCity…</div>;
  const s = cityRef.current!;
  const hour = (s.time % 1440) / 60;
  const selH = sel.hamster ? s.hamsters.find((h) => h.id === sel.hamster) : undefined;
  const selB = sel.building ? building(s, sel.building) : undefined;
  const W = size.current.W, H = size.current.H;
  const weatherText = s.weather === "rain" ? "Rain" : s.weather === "sunny" ? "Sunny" : "Cloudy";
  const surge = s.time < s.surgeUntil;
  const festival = s.time < s.festivalUntil;

  const god = (fn: () => { ok: boolean; reason?: string } | void, ok: string) => {
    const r = fn(); if (r && !r.ok) showToast(r.reason ?? "Not possible right now"); else showToast(ok); bump();
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="./favicon.svg" width={28} height={28} alt="" />
          <h1>SqueekCity</h1>
        </div>
        <div className="stats" aria-live="off">
          <span className={`stat ${surge ? "surge" : ""}`} title="Wheel Energy stored">
            <span className="mono">{Math.floor(s.energy).toLocaleString("en")}</span> WE
          </span>
          <span className="stat"><span className="mono"><span className="hide-xs">Day {dayOf(s.time)} </span>{clock(s.time)}</span></span>
          <span className="stat hide-sm">{weatherText}{festival ? " · Festival" : ""}</span>
          <span className={`stat hide-sm badge-${reading?.label ?? "loading"}`} title={reading?.note}>Wheel: {LABEL_TEXT[reading?.label ?? "loading"]}</span>
        </div>
        <div className="top-right"><WalletControl /></div>
      </header>

      <main className="stage">
        <div className="canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="world"
            role="img"
            aria-label={`Isometric map of SqueekCity, ${hour < 6 || hour >= 20 ? "night" : "day"}, ${weatherText.toLowerCase()}. Use the district buttons or the panel to explore.`}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
          />
          {!view && (Object.keys(DISTRICTS) as DistrictId[]).map((d) => {
            const c = districtCenter(d);
            const p = project(cam.current, W, H, 0, 0); const ox = p.x + c.x * cam.current.zoom, oy = p.y + c.y * cam.current.zoom - 40 * cam.current.zoom;
            const half = (`Enter ${DISTRICTS[d].name}`.length * 8 + 28) / 2; // keep the whole pin on screen
            const left = Math.max(half + 8, Math.min(W * PX - half - 8, ox * PX)), top = Math.max(52, Math.min(H * PX - 8, oy * PX));
            return (
              <button key={d} className="pin" style={{ left, top }} onClick={() => enter(d)}>
                Enter {DISTRICTS[d].name}
              </button>
            );
          })}
          {view && <button className="btn back" onClick={backToCity}>← Back to City</button>}
          <div className="zoom">
            <button className="btn icon" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
            <button className="btn icon" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
          </div>
          {toast && <div className="toast" role="status">{toast}</div>}
        </div>

        <nav className="god" aria-label="God mode">
          <button className="btn" aria-pressed={s.weather === "sunny" && s.weatherForced} onClick={() => god(() => godSun(s), "Sunshine for six hours: hamsters head outdoors.")}>Sun</button>
          <button className="btn" aria-pressed={s.weather === "rain" && s.weatherForced} onClick={() => god(() => godRain(s), "Rain for four hours: umbrellas out, others shelter.")}>Rain</button>
          <button className="btn" disabled={festival} onClick={() => god(() => godFestival(s), "Festival in Clover Park for three hours.")}>Festival · {FESTIVAL_COST}</button>
          <button className="btn" onClick={() => god(() => godTrees(s), "Three new trees planted.")}>Plant trees · {TREE_COST}</button>
          <span className="sep" />
          <button className="btn" aria-pressed={s.speed === 0} onClick={() => { s.speed = s.speed === 0 ? 1 : 0; bump(); }}>{s.speed === 0 ? "Resume" : "Pause"}</button>
          <button className="btn" aria-pressed={s.speed === 1} onClick={() => { s.speed = 1; bump(); }}>1x</button>
          <button className="btn" aria-pressed={s.speed === 2} onClick={() => { s.speed = 2; bump(); }}>2x</button>
        </nav>

        <aside className={`panel ${sheetOpen ? "open" : "closed"}`} aria-label="City details">
          <div className="tabbar">
            <div className="tabs" role="tablist">
              {([["map", view ? DISTRICTS[view].name : "City"], ["citizens", "Citizens"], ["chronicle", "Chronicle"], ["squeek", "Real wheel"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setSheetOpen(true); }}>{label}</button>
              ))}
            </div>
            <button className="sheet-toggle" aria-expanded={sheetOpen} aria-label={sheetOpen ? "Collapse panel" : "Expand panel"} onClick={() => setSheetOpen((o) => !o)}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: sheetOpen ? "none" : "rotate(180deg)" }}><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            </button>
          </div>
          {sheetOpen && (
            <div className="panel-body" role="tabpanel">
              {tab === "map" && (selH ? (
                <>
                  <button className="link back-link" onClick={() => setSel({ building: null, hamster: null })}>← {view ? DISTRICTS[view].name : "City"}</button>
                  <HamsterPanel s={s} h={selH} nav={nav} />
                </>
              ) : selB ? (
                <>
                  <button className="link back-link" onClick={() => setSel({ building: null, hamster: null })}>← {DISTRICTS[selB.district].name}</button>
                  <BuildingPanel s={s} b={selB} nav={nav} />
                </>
              ) : view ? <DistrictPanel s={s} d={view} nav={nav} /> : <Overview s={s} nav={nav} />)}
              {tab === "citizens" && <Citizens s={s} nav={nav} />}
              {tab === "chronicle" && <Chronicle s={s} />}
              {tab === "squeek" && <SqueekPanel s={s} reading={reading} events={events} />}
              <footer className="save">
                <p className="muted small">Saved only in this browser (IndexedDB). It does not sync across devices or browsers.{savedAt ? ` Last save ${savedAt}.` : ""}</p>
                <div className="row-btns">
                  <button className="btn" onClick={() => saveCity(s).then(() => { setSavedAt(new Date().toLocaleTimeString()); showToast("Saved in this browser."); })}>Save now</button>
                  <button className="btn" onClick={async () => {
                    if (!window.confirm("Start a new city? This deletes the save stored in this browser.")) return;
                    await deleteCity(); const n = newCity(); cityRef.current = n; setCity(n); backToCity(); showToast("A new SqueekCity was founded.");
                  }}>New city</button>
                </div>
                <p className="muted small">IMD job efe690bc-8404-4b07-9ec6-44c3d6022c53 · Built for Squeekchain Genesis Code.</p>
              </footer>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
