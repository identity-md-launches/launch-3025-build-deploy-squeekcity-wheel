/**
 * Squeekchain public API client.
 * Schemas verified against https://docs.squeekchain.com/developers/api/ and live responses
 * on 2026-11-06: GET /v1/status (schemaVersion 1) and GET /v1/events (schemaVersion 4).
 */
export const API_BASE = "https://api.squeekchain.com";

export type DataLabel = "live" | "stale" | "simulated" | "replay" | "derived" | "idle" | "unavailable" | "loading";

export interface WheelReading {
  label: DataLabel;
  /** Human sentence that says exactly what is known. */
  note: string;
  rpm: number | null;            // rpmMilli / 1000
  speedMmPerSecond: number | null;
  distanceMm: number | null;
  coreStatus: string | null;     // IDLE | ACTIVE | COUNTER_FAULT
  provenance: string | null;     // hardware | simulated | replay | derived
  freshness: string | null;      // online | stale
  observedAt: string | null;
  receivedAt: string | null;
  generatedAt: string | null;
  staleAfterSeconds: number | null;
  counterEpoch: string | null;
  moduleState: string | null;    // wheel module state (ready, ...)
  fetchedAt: string;
  /** True only for fresh, hardware-provenance, ACTIVE readings with rpm > 0. */
  bonusEligible: boolean;
  key: string | null;            // dedupe key for this reading
}

export interface Milestone { id: string; type: string; occurredAt: string; text: string; disposition: string | null }
export interface EventsResult { label: "available" | "unavailable"; reason: string | null; milestones: Milestone[]; fetchedAt: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function unavailable(note: string, fetchedAt: string): WheelReading {
  return {
    label: "unavailable", note, rpm: null, speedMmPerSecond: null, distanceMm: null, coreStatus: null, provenance: null,
    freshness: null, observedAt: null, receivedAt: null, generatedAt: null, staleAfterSeconds: null, counterEpoch: null,
    moduleState: null, fetchedAt, bonusEligible: false, key: null,
  };
}

/** Pure parser so it can be tested against recorded responses. */
export function parseStatus(json: unknown, now: Date): WheelReading {
  const fetchedAt = now.toISOString();
  if (!isObj(json) || json.schemaVersion !== 1) return unavailable("Unexpected status schema, nothing shown as live.", fetchedAt);
  const m = json.measurement;
  if (m === null) return unavailable("The wheel has not reported a measurement yet.", fetchedAt);
  if (!isObj(m)) return unavailable("Status response had no measurement object.", fetchedAt);
  const rpmMilli = num(m.rpmMilli);
  const freshness = str(m.freshness);
  const provenance = str(m.provenance);
  const coreStatus = str(m.coreStatus);
  const receivedAt = str(m.receivedAt);
  const observedAt = str(m.observedAt);
  const staleAfter = num(m.staleAfterSeconds) ?? 120;
  const wheel = Array.isArray(json.modules) ? json.modules.find((x) => isObj(x) && x.moduleType === "wheel.counter") : undefined;
  const base: WheelReading = {
    label: "live", note: "", rpm: rpmMilli === null ? null : rpmMilli / 1000,
    speedMmPerSecond: num(m.speedMmPerSecond), distanceMm: num(m.distanceMm), coreStatus, provenance, freshness,
    observedAt, receivedAt, generatedAt: str(json.generatedAt), staleAfterSeconds: staleAfter, counterEpoch: str(m.counterEpoch),
    moduleState: isObj(wheel) ? str(wheel.state) : null, fetchedAt, bonusEligible: false,
    key: observedAt ? `${str(m.counterEpoch) ?? "?"}:${observedAt}` : null,
  };
  // Freshness: trust the API's own flag, and also check the age on this device's clock.
  const ageS = receivedAt ? (now.getTime() - Date.parse(receivedAt)) / 1000 : Infinity;
  const fresh = freshness === "online" && ageS <= staleAfter;
  if (!fresh) return { ...base, label: "stale", note: `Last reading is stale (received ${receivedAt ?? "unknown"}). No bonus while stale.` };
  if (provenance === "simulated") return { ...base, label: "simulated", note: "The API marks this reading as simulated. Shown, never rewarded." };
  if (provenance === "replay") return { ...base, label: "replay", note: "The API marks this reading as a replay. Shown, never rewarded." };
  if (provenance === "derived") return { ...base, label: "derived", note: "The API marks this reading as derived. Shown, never rewarded." };
  if (provenance !== "hardware") return { ...base, label: "unavailable", note: `Unknown provenance "${provenance}". Not rewarded.` };
  if (coreStatus === "COUNTER_FAULT") return { ...base, label: "unavailable", note: "The wheel counter reports a fault. Not rewarded." };
  if (coreStatus !== "ACTIVE" || !base.rpm) return { ...base, label: "idle", note: "Fresh hardware reading: the real wheel is resting right now." };
  return { ...base, label: "live", note: "Fresh hardware reading: the real hamster is running.", bonusEligible: true };
}

const MILESTONE_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  "measurement.distance_milestone": (p) => `Real wheel passed ${km(p.thresholdDistanceMm)} lifetime distance`,
  "measurement.daily_distance_milestone": (p) => `Real wheel ran ${km(p.thresholdDistanceMm)} on ${str(p.utcDate) ?? "one day"}`,
  "measurement.speed_milestone": (p) => `Real wheel reached ${kmh(p.thresholdSpeedMmPerSecond)}`,
  "measurement.speed_record": (p) => `Real wheel set a top speed record of ${kmh(p.recordMmPerSecond)}`,
  "measurement.distance_streak": (p) => `Real wheel kept a ${String(p.days)} day running streak`,
};
function km(v: unknown) { const n = Number(v); return Number.isFinite(n) ? `${(n / 1e6).toLocaleString("en", { maximumFractionDigits: 1 })} km` : "a distance"; }
function kmh(v: unknown) { const n = Number(v); return Number.isFinite(n) ? `${(n * 0.0036).toFixed(1)} km/h` : "a speed"; }

export function parseEvents(json: unknown, now: Date): EventsResult {
  const fetchedAt = now.toISOString();
  if (!isObj(json) || json.schemaVersion !== 4) return { label: "unavailable", reason: "unexpected_schema", milestones: [], fetchedAt };
  if (json.status !== "available") return { label: "unavailable", reason: str(json.reason) ?? "unavailable", milestones: [], fetchedAt };
  const evs = Array.isArray(json.events) ? json.events : [];
  const milestones: Milestone[] = [];
  for (const e of evs) {
    if (!isObj(e) || !isObj(e.payload) || !isObj(e.source)) continue;
    const type = str(e.type), id = str(e.id), occurredAt = str(e.occurredAt);
    if (!type || !id || !occurredAt || !MILESTONE_TEXT[type]) continue;
    const disposition = str(e.source.disposition);
    if (e.source.kind !== "measurement" || disposition !== "accepted") continue; // confirmed only
    milestones.push({ id, type, occurredAt, disposition, text: MILESTONE_TEXT[type](e.payload) });
  }
  return { label: "available", reason: null, milestones, fetchedAt };
}

export async function fetchStatus(signal?: AbortSignal): Promise<WheelReading> {
  const now = new Date();
  try {
    const r = await fetch(`${API_BASE}/v1/status`, { signal, cache: "no-store" });
    if (!r.ok) return unavailable(`Status request failed with HTTP ${r.status}.`, now.toISOString());
    return parseStatus(await r.json(), new Date());
  } catch {
    return unavailable("Squeekchain API is unreachable. The city keeps running on its own wheels.", now.toISOString());
  }
}

export async function fetchMilestones(signal?: AbortSignal): Promise<EventsResult> {
  const now = new Date();
  try {
    const r = await fetch(`${API_BASE}/v1/events?category=measurement&limit=40`, { signal, cache: "no-store" });
    if (!r.ok) return { label: "unavailable", reason: `http_${r.status}`, milestones: [], fetchedAt: now.toISOString() };
    return parseEvents(await r.json(), new Date());
  } catch {
    return { label: "unavailable", reason: "network", milestones: [], fetchedAt: now.toISOString() };
  }
}

export const LABEL_TEXT: Record<DataLabel, string> = {
  live: "Live hardware", stale: "Stale", simulated: "Simulated", replay: "Replayed", derived: "Derived",
  idle: "Live, wheel idle", unavailable: "Unavailable", loading: "Checking",
};
