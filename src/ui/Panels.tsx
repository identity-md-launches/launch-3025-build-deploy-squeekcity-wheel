import { useState } from "react";
import type { Building, CityState, DistrictId, Hamster } from "../sim/types";
import { DISTRICTS } from "../sim/world";
import {
  applyUpgrade, building, capacity, clock, dayOf, housingCapacity, MAX_POP, nextReq, performance, upgradeCost, wheelEfficiency, teamBonus,
  BONUS_PER_HOUR_CAP, BONUS_PER_READING_CAP, MILESTONE_BONUS,
} from "../sim/engine";
import { actionsFor, UPGRADE_EFFECT } from "../sim/actions";
import { LABEL_TEXT, type EventsResult, type WheelReading } from "../api/squeek";

export const LIVE_STUDIO_URL = "https://sepolia.squeekchain.com/";
const fmt = (n: number) => Math.floor(n).toLocaleString("en");
const first = (h: Hamster) => h.name.split(" ")[0];

const ACT_TEXT: Record<string, string> = {
  sleeping: "Sleeping", home: "Relaxing at home", eating: "Eating", walking: "Walking", working: "Running a wheel", shopping: "Shopping",
  park: "At the park", socializing: "Socialising", sheltering: "Sheltering from rain", festival: "At the festival", arcade: "At the arcade",
  studio: "Watching Squeek Live", garden: "Gardening", visiting: "Visiting friends",
};
export function doing(s: CityState, h: Hamster): string {
  if (h.activity === "walking") { const t = building(s, h.target); return `Walking to ${t?.name ?? "somewhere"}`; }
  const at = building(s, h.at);
  return `${ACT_TEXT[h.activity] ?? h.activity}${at ? ` · ${at.name}` : ""}`;
}

function Bar({ label, value, max = 100, tone }: { label: string; value: number; max?: number; tone?: "good" | "warn" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <div className="bar-top"><span>{label}</span><span className="mono">{fmt(value)}{max !== 100 ? ` / ${fmt(max)}` : ""}</span></div>
      <div className="bar-track" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
        <div className={`bar-fill ${tone ?? ""}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

interface Nav { selectHamster: (id: string) => void; selectBuilding: (id: string) => void; enter: (d: DistrictId) => void; toast: (t: string) => void; bump: () => void }

/* ---------- City overview ---------- */
export function Overview({ s, nav }: { s: CityState; nav: Nav }) {
  return (
    <div className="stack">
      <h2>Choose a district</h2>
      {(Object.keys(DISTRICTS) as DistrictId[]).map((d) => {
        const ids = new Set(s.buildings.filter((b) => b.district === d).map((b) => b.id));
        const here = s.hamsters.filter((h) => (h.at && ids.has(h.at)) || (h.target && ids.has(h.target) && h.activity === "walking")).length;
        return (
          <button key={d} className="card-btn" onClick={() => nav.enter(d)}>
            <span className="card-title">{DISTRICTS[d].name}</span>
            <span className="muted small">{DISTRICTS[d].blurb} · {here} hamster{here === 1 ? "" : "s"} here now</span>
          </button>
        );
      })}
      <EconomySummary s={s} />
    </div>
  );
}

function EconomySummary({ s }: { s: CityState }) {
  const mood = s.hamsters.reduce((a, h) => a + h.mood, 0) / s.hamsters.length;
  return (
    <div className="stack-tight">
      <h3>City economy</h3>
      <Bar label="Wheel Energy stored" value={s.energy} max={capacity(s)} tone={s.energy < 300 ? "warn" : "good"} />
      <dl className="kv">
        <dt>Generation</dt><dd className="mono">{fmt(s.rateGen * 60)} WE/h</dd>
        <dt>Consumption</dt><dd className="mono">{fmt(s.rateUse * 60)} WE/h</dd>
        <dt>Today</dt><dd className="mono">+{fmt(s.generatedToday)} / −{fmt(s.consumedToday)}</dd>
        <dt>Real wheel bonus</dt><dd className="mono">{fmt(s.apiBonusTotal)} WE</dd>
        <dt>Population</dt><dd className="mono">{s.hamsters.length} of {Math.min(MAX_POP, housingCapacity(s))} homes, max {MAX_POP}</dd>
        <dt>Average mood</dt><dd className="mono">{Math.round(mood)}</dd>
        <dt>Trees</dt><dd className="mono">{s.trees.length}</dd>
      </dl>
      {s.brownout && <p className="warn small">Brownout: storage is empty, lights are dimmed and moods drop until wheels refill it.</p>}
      <p className="muted small">WE is a fictional in-game resource. It is not SQK and has no value outside this city.</p>
    </div>
  );
}

/* ---------- District ---------- */
export function DistrictPanel({ s, d, nav }: { s: CityState; d: DistrictId; nav: Nav }) {
  const blds = s.buildings.filter((b) => b.district === d);
  const ids = new Set(blds.map((b) => b.id));
  const people = s.hamsters.filter((h) => h.at && ids.has(h.at));
  return (
    <div className="stack">
      <div>
        <h2>{DISTRICTS[d].name}</h2>
        <p className="muted small">{DISTRICTS[d].blurb}. Tap a building on the map or below.</p>
      </div>
      {d === "corp" && <CorpSummary s={s} />}
      <div className="list">
        {blds.map((b) => {
          const occ = s.hamsters.filter((h) => h.at === b.id && h.activity !== "walking").length;
          return (
            <button key={b.id} className="list-row" onClick={() => nav.selectBuilding(b.id)}>
              <span>{b.name}</span>
              <span className="muted small mono">{b.kind === "lot" ? "Empty lot" : `Lv ${b.level}`} · {occ} inside</span>
            </button>
          );
        })}
      </div>
      <h3>Here now</h3>
      {people.length ? (
        <div className="list">
          {people.map((h) => (
            <button key={h.id} className="list-row" onClick={() => nav.selectHamster(h.id)}>
              <span><span className="dot" style={{ background: h.fur }} />{h.name}</span>
              <span className="muted small">{ACT_TEXT[h.activity]}</span>
            </button>
          ))}
        </div>
      ) : <p className="muted small">Nobody is in this district right now.</p>}
      {d === "corp" && <Leaderboard s={s} nav={nav} compact />}
    </div>
  );
}

function CorpSummary({ s }: { s: CityState }) {
  const working = s.hamsters.filter((h) => h.activity === "working").length;
  const workers = s.hamsters.filter((h) => h.job).length;
  return (
    <dl className="kv">
      <dt>On shift</dt><dd className="mono">{working} of {workers} workers</dd>
      <dt>Team efficiency</dt><dd className="mono">×{teamBonus(s).toFixed(2)}</dd>
      <dt>Hall A / B wheels</dt><dd className="mono">×{wheelEfficiency(s, "hallA").toFixed(2)} / ×{wheelEfficiency(s, "hallB").toFixed(2)}</dd>
      <dt>Output now</dt><dd className="mono">{fmt(s.rateGen * 60)} WE/h</dd>
    </dl>
  );
}

/* ---------- Building ---------- */
export function BuildingPanel({ s, b, nav }: { s: CityState; b: Building; nav: Nav }) {
  const [msg, setMsg] = useState<string | null>(null);
  const occ = s.hamsters.filter((h) => h.at === b.id && h.activity !== "walking");
  const coming = s.hamsters.filter((h) => h.target === b.id && h.activity === "walking");
  const residents = s.hamsters.filter((h) => h.homeId === b.id);
  const cost = upgradeCost(b);
  const maxed = b.level >= b.maxLevel;
  return (
    <div className="stack">
      <div>
        <h2>{b.name}</h2>
        <p className="muted small">{DISTRICTS[b.district].name} · {b.kind === "lot" ? "Empty lot" : `Level ${b.level} of ${b.maxLevel}`}</p>
      </div>
      {b.kind === "studio" && (
        <a className="btn btn-accent btn-block" href={LIVE_STUDIO_URL} target="_blank" rel="noopener noreferrer">Open Squeek Live Studio</a>
      )}
      {b.kind === "battery" && <Bar label="Stored Wheel Energy" value={s.energy} max={capacity(s)} tone="good" />}
      {b.kind === "hq" && <Seats s={s} />}
      {actionsFor(b).map((a) => (
        <div key={a.label} className="action">
          <button className="btn btn-block" disabled={s.energy < a.cost} onClick={() => { const r = a.run(s); setMsg(r); nav.bump(); }}>
            {a.label} · {a.cost} WE
          </button>
          <p className="muted small">{a.help}</p>
        </div>
      ))}
      <div className="action">
        <button className="btn btn-block btn-accent" disabled={maxed || s.energy < cost} onClick={() => {
          const r = applyUpgrade(s, b.id); setMsg(r.ok ? (b.kind === "house" && b.level === 1 ? `${b.name} is built.` : `Upgraded to level ${b.level}.`) : r.reason ?? null); nav.bump();
        }}>
          {maxed ? "Fully upgraded" : b.kind === "lot" ? `Build a home · ${fmt(cost)} WE` : `Upgrade to level ${b.level + 1} · ${fmt(cost)} WE`}
        </button>
        <p className="muted small">{UPGRADE_EFFECT[b.kind]}{!maxed && s.energy < cost ? ` Needs ${fmt(cost - s.energy)} more WE.` : ""}</p>
      </div>
      {msg && <p className="note small" role="status">{msg}</p>}
      {b.kind === "house" && (
        <>
          <h3>Residents</h3>
          <div className="list">{residents.map((h) => <HamRow key={h.id} s={s} h={h} nav={nav} />)}</div>
        </>
      )}
      <h3>Inside now</h3>
      {occ.length ? <div className="list">{occ.map((h) => <HamRow key={h.id} s={s} h={h} nav={nav} />)}</div> : <p className="muted small">Empty right now.</p>}
      {coming.length > 0 && <p className="muted small">On the way: {coming.map(first).join(", ")}</p>}
    </div>
  );
}

function Seats({ s }: { s: CityState }) {
  const ranks = ["Team Leader", "Manager", "Director", "CEO"] as const;
  const hq = building(s, "hq")!;
  const seats = { "Team Leader": 2 + hq.level - 1, Manager: 1 + (hq.level >= 3 ? 1 : 0), Director: 1, CEO: 1 };
  return (
    <dl className="kv">
      {ranks.map((r) => (
        <div key={r} className="kv-row"><dt>{r}</dt><dd className="mono">{s.hamsters.filter((h) => h.job?.rank === r).length} / {seats[r]} seats</dd></div>
      ))}
    </dl>
  );
}

function HamRow({ s, h, nav }: { s: CityState; h: Hamster; nav: Nav }) {
  return (
    <button className="list-row" onClick={() => nav.selectHamster(h.id)}>
      <span><span className="dot" style={{ background: h.fur }} />{h.name}</span>
      <span className="muted small">{doing(s, h).split(" · ")[0]}</span>
    </button>
  );
}

/* ---------- Hamster profile ---------- */
export function HamsterPanel({ s, h, nav }: { s: CityState; h: Hamster; nav: Nav }) {
  const home = building(s, h.homeId);
  const j = h.job;
  const req = j ? nextReq(s, h) : null;
  const friends = Object.entries(h.relationships).filter(([id]) => !h.family.includes(id)).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const perShift = j && j.minutesToday > 0 ? (j.dailyWE / j.minutesToday) * 60 : 0;
  return (
    <div className="stack">
      <div className="profile-head">
        <span className="avatar" style={{ background: h.fur }} aria-hidden="true" />
        <div>
          <h2>{h.name}</h2>
          <p className="muted small">{h.age < 1 ? "Pup" : `${h.age} years`} · {h.personality} · {j ? `${j.rank}, Wheel Corporation` : h.age < 1 ? "Too young to work" : "Retired"}</p>
        </div>
      </div>
      <p className="note small">{doing(s, h)} · “{h.thought}”</p>
      <div className="grid2">
        <Bar label="Mood" value={h.mood} tone={h.mood < 40 ? "warn" : "good"} />
        <Bar label="Fullness" value={100 - h.hunger} tone={h.hunger > 65 ? "warn" : "good"} />
        <Bar label="Stamina" value={h.stamina} tone={h.stamina < 25 ? "warn" : "good"} />
        <Bar label="Social" value={h.social} />
      </div>
      <dl className="kv">
        <dt>Home</dt><dd>{home ? <button className="link" onClick={() => nav.selectBuilding(home.id)}>{home.name}</button> : "Moving in"}</dd>
        <dt>Family</dt><dd>{h.family.length ? h.family.map((id) => { const f = s.hamsters.find((o) => o.id === id); return f ? <button key={id} className="link" onClick={() => nav.selectHamster(id)}>{first(f)}</button> : null; }) : "None in town"}</dd>
        <dt>Close friends</dt><dd>{friends.map(([id, v]) => { const f = s.hamsters.find((o) => o.id === id); return f ? <button key={id} className="link" onClick={() => nav.selectHamster(id)}>{first(f)} ({Math.round(v)})</button> : null; })}</dd>
        <dt>Schedule</dt><dd className="mono">Wakes {h.wakeHour}:00{j ? `, works ${h.workStart}:00–${h.workEnd}:00` : ""}, sleeps {h.sleepHour}:00</dd>
        <dt>Umbrella</dt><dd>{h.hasUmbrella ? "Owns one" : "None yet (Pip's Market sells them)"}</dd>
      </dl>
      {j && req && (
        <>
          <h3>Career</h3>
          <dl className="kv">
            <dt>Wheel Energy today</dt><dd className="mono">{fmt(j.dailyWE)} WE</dd>
            <dt>Lifetime</dt><dd className="mono">{fmt(j.lifetimeWE)} WE</dd>
            <dt>Productivity</dt><dd className="mono">{fmt(perShift)} WE/h on shift</dd>
            <dt>Skills</dt><dd className="mono">Speed {j.speed.toFixed(1)} · Endurance {j.endurance.toFixed(1)}</dd>
            <dt>Wheel</dt><dd>{building(s, j.hall)?.name}, slot {j.wheelSlot + 1}</dd>
          </dl>
          {req.next ? (
            <div className="stack-tight">
              <p className="small">Next: <strong>{req.next}</strong>{req.seatsLeft === 0 ? " · no open seat, waiting for a vacancy or an HQ upgrade" : ` · ${req.seatsLeft} seat${req.seatsLeft > 1 ? "s" : ""} open`}</p>
              <Bar label="Experience" value={Math.min(j.xp, req.xp)} max={req.xp} />
              {req.perf > 0 && <Bar label="3-day average output (WE/day)" value={Math.min(performance(h), req.perf)} max={req.perf} />}
              <p className="muted small">Reviews happen at 20:00 every day.</p>
            </div>
          ) : <p className="small">Top of the ladder: CEO of the Wheel Corporation.</p>}
          <h3>Work history</h3>
          {j.history.length ? (
            <table className="table">
              <thead><tr><th scope="col">Day</th><th scope="col">WE</th><th scope="col">Minutes</th></tr></thead>
              <tbody>{j.history.slice(-7).reverse().map((d) => <tr key={d.day}><td>{d.day}</td><td className="mono">{fmt(d.we)}</td><td className="mono">{d.minutes}</td></tr>)}</tbody>
            </table>
          ) : <p className="muted small">The first day's record appears at midnight.</p>}
          {j.promotions.length > 0 && <p className="small">Promotions: {j.promotions.map((p) => `${p.rank} (day ${p.day})`).join(", ")}</p>}
        </>
      )}
    </div>
  );
}

/* ---------- Leaderboard ---------- */
export function Leaderboard({ s, nav, compact }: { s: CityState; nav: Nav; compact?: boolean }) {
  const [by, setBy] = useState<"today" | "lifetime" | "xp">("today");
  const rows = s.hamsters.filter((h) => h.job).sort((a, b) => {
    const k = (h: Hamster) => by === "today" ? h.job!.dailyWE : by === "lifetime" ? h.job!.lifetimeWE : h.job!.xp;
    return k(b) - k(a);
  });
  return (
    <div className="stack-tight">
      <h3>Employee leaderboard</h3>
      <div className="seg" role="group" aria-label="Sort leaderboard">
        {(["today", "lifetime", "xp"] as const).map((k) => (
          <button key={k} aria-pressed={by === k} onClick={() => setBy(k)}>{k === "today" ? "Today" : k === "lifetime" ? "Lifetime" : "XP"}</button>
        ))}
      </div>
      <table className="table">
        <thead><tr><th scope="col">#</th><th scope="col">Hamster</th><th scope="col">Title</th><th scope="col">{by === "xp" ? "XP" : "WE"}</th></tr></thead>
        <tbody>
          {rows.slice(0, compact ? 6 : 99).map((h, i) => (
            <tr key={h.id}>
              <td className="mono">{i + 1}</td>
              <td><button className="link" onClick={() => nav.selectHamster(h.id)}>{first(h)}</button></td>
              <td className="small">{h.job!.rank}</td>
              <td className="mono">{fmt(by === "today" ? h.job!.dailyWE : by === "lifetime" ? h.job!.lifetimeWE : h.job!.xp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Citizens ---------- */
export function Citizens({ s, nav }: { s: CityState; nav: Nav }) {
  return (
    <div className="stack">
      <h2>Citizens · {s.hamsters.length}</h2>
      <div className="list">
        {s.hamsters.map((h) => (
          <button key={h.id} className="list-row" onClick={() => nav.selectHamster(h.id)}>
            <span><span className="dot" style={{ background: h.fur }} />{h.name}</span>
            <span className="muted small">{doing(s, h).split(" · ")[0]}</span>
          </button>
        ))}
      </div>
      <Leaderboard s={s} nav={nav} />
    </div>
  );
}

/* ---------- Chronicle ---------- */
export function Chronicle({ s }: { s: CityState }) {
  return (
    <div className="stack">
      <h2>City Chronicle</h2>
      <ol className="chron">
        {s.chronicle.slice(0, 80).map((c, i) => (
          <li key={i} className={`chron-${c.kind}`}>
            <span className="muted small mono">Day {dayOf(c.t)} {clock(c.t)}{c.real ? ` · real ${new Date(c.real).toLocaleString()}` : ""}</span>
            <span>{c.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Squeekchain ---------- */
export function SqueekPanel({ s, reading, events }: { s: CityState; reading: WheelReading | null; events: EventsResult | null }) {
  const label = reading?.label ?? "loading";
  return (
    <div className="stack">
      <h2>Real Squeekchain wheel</h2>
      <p className="small"><span className={`badge badge-${label}`}>{LABEL_TEXT[label]}</span> {reading?.note ?? "Reading api.squeekchain.com/v1/status…"}</p>
      {reading && reading.label !== "unavailable" && (
        <dl className="kv">
          <dt>RPM</dt><dd className="mono">{reading.rpm === null ? "Unknown" : reading.rpm.toFixed(1)}</dd>
          <dt>Speed</dt><dd className="mono">{reading.speedMmPerSecond === null ? "Unknown" : `${(reading.speedMmPerSecond * 0.0036).toFixed(2)} km/h`}</dd>
          <dt>Distance today</dt><dd className="mono">{reading.distanceMm === null ? "Unknown" : `${(reading.distanceMm / 1e6).toFixed(2)} km`}</dd>
          <dt>Wheel status</dt><dd className="mono">{reading.coreStatus ?? "Unknown"}{reading.moduleState ? ` · module ${reading.moduleState}` : ""}</dd>
          <dt>Provenance</dt><dd className="mono">{reading.provenance ?? "Unknown"}</dd>
          <dt>Freshness</dt><dd className="mono">{reading.freshness ?? "Unknown"} (stale after {reading.staleAfterSeconds ?? "?"} s)</dd>
          <dt>Observed</dt><dd className="mono">{reading.observedAt ? new Date(reading.observedAt).toLocaleTimeString() : "Unknown"}</dd>
          <dt>Received</dt><dd className="mono">{reading.receivedAt ? new Date(reading.receivedAt).toLocaleTimeString() : "Unknown"}</dd>
        </dl>
      )}
      {reading && <p className="muted small">Checked {new Date(reading.fetchedAt).toLocaleTimeString()} · every 15 seconds.</p>}
      <div className="stack-tight">
        <h3>How the bonus works</h3>
        <p className="small">Only a fresh, hardware-provenance reading with the wheel ACTIVE adds Wheel Energy: RPM × 0.3, at most {BONUS_PER_READING_CAP} WE per reading and {BONUS_PER_HOUR_CAP} WE per real hour. Each reading counts once. Confirmed milestones from /v1/events add {MILESTONE_BONUS} WE once, if they happen after this city was founded.</p>
        <p className="small">Bonus earned so far: <span className="mono">{fmt(s.apiBonusTotal)} WE</span> · this hour <span className="mono">{fmt(s.apiBonusHour.amount)}/{BONUS_PER_HOUR_CAP}</span></p>
      </div>
      <h3>Confirmed wheel milestones</h3>
      {!events ? <p className="muted small">Reading /v1/events…</p> : events.label === "unavailable" ? (
        <p className="small"><span className="badge badge-unavailable">Unavailable</span> Event feed unavailable ({events.reason}). Shown as unknown, not as zero.</p>
      ) : events.milestones.length ? (
        <ol className="chron">
          {events.milestones.slice(0, 8).map((m) => (
            <li key={m.id}><span className="muted small mono">{new Date(m.occurredAt).toLocaleString()} · {s.rewardedEventIds.includes(m.id) ? "rewarded" : "recorded"}</span><span>{m.text}</span></li>
          ))}
        </ol>
      ) : <p className="muted small">The feed is available but has no accepted wheel milestones.</p>}
    </div>
  );
}
