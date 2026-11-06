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
  /** Why the latest status request failed, null once one succeeds. */
  checkError: string | null;
  checkFailedAt: string | null;
}

export interface Milestone { id: string; type: string; occurredAt: string; text: string; disposition: string | null }
export interface EventsResult { label: "available" | "unavailable"; reason: string | null; milestones: Milestone[]; fetchedAt: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function unavailable(note: string, fetchedAt: string, requestFailed = false): WheelReading {
  return {
    label: "unavailable", note, rpm: null, speedMmPerSecond: null, distanceMm: null, coreStatus: null, provenance: null,
    freshness: null, observedAt: null, receivedAt: null, generatedAt: null, staleAfterSeconds: null, counterEpoch: null,
    moduleState: null, fetchedAt, bonusEligible: false, key: null,
    checkError: requestFailed ? note : null, checkFailedAt: requestFailed ? fetchedAt : null,
  };
}

const DEFAULT_STALE_AFTER_S = 120;
const isExpired = (receivedAt: string | null, staleAfter: number, now: Date) =>
  !((now.getTime() - Date.parse(receivedAt ?? "")) / 1000 <= staleAfter);
const staleNote = (receivedAt: string | null) => `Last reading is stale (received ${receivedAt ?? "unknown"}). No bonus while stale.`;

/** A reading stops being fresh at receivedAt + staleAfterSeconds, whether or not another request ever completes. */
export function ageReading(r: WheelReading, now: Date): WheelReading {
  if (r.label === "stale" || !r.receivedAt || !isExpired(r.receivedAt, r.staleAfterSeconds ?? DEFAULT_STALE_AFTER_S, now)) return r;
  return { ...r, label: "stale", note: staleNote(r.receivedAt), bonusEligible: false };
}

/** A failed request says nothing about the wheel: keep the last reading and its timestamps, and record the failure. */
export function mergeReading(prev: WheelReading | null, next: WheelReading): WheelReading {
  return next.checkError && prev?.receivedAt ? { ...prev, checkError: next.checkError, checkFailedAt: next.checkFailedAt } : next;
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
  const staleAfter = num(m.staleAfterSeconds) ?? DEFAULT_STALE_AFTER_S;
  const wheel = Array.isArray(json.modules) ? json.modules.find((x) => isObj(x) && x.moduleType === "wheel.counter") : undefined;
  const base: WheelReading = {
    label: "live", note: "", rpm: rpmMilli === null ? null : rpmMilli / 1000,
    speedMmPerSecond: num(m.speedMmPerSecond), distanceMm: num(m.distanceMm), coreStatus, provenance, freshness,
    observedAt, receivedAt, generatedAt: str(json.generatedAt), staleAfterSeconds: staleAfter, counterEpoch: str(m.counterEpoch),
    moduleState: isObj(wheel) ? str(wheel.state) : null, fetchedAt, bonusEligible: false,
    key: observedAt ? `${str(m.counterEpoch) ?? "?"}:${observedAt}` : null, checkError: null, checkFailedAt: null,
  };
  // Freshness: trust the API's own flag, and also check the age on this device's clock.
  const fresh = freshness === "online" && !isExpired(receivedAt, staleAfter, now);
  if (!fresh) return { ...base, label: "stale", note: staleNote(receivedAt) };
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

/** Shorter than the 15 s poll, so a hung request ends before the next one starts. */
export const REQUEST_TIMEOUT_MS = 10000;

/** Every API request ends: with JSON, an HTTP status, or a timeout or network failure. */
async function getJson(path: string): Promise<{ json: unknown } | { failure: "timeout" | "network" | number }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(`${API_BASE}${path}`, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) return { failure: r.status };
    return { json: await r.json() };
  } catch {
    return { failure: ctl.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchStatus(): Promise<WheelReading> {
  const got = await getJson("/v1/status");
  const now = new Date();
  if ("json" in got) return parseStatus(got.json, now);
  const note = got.failure === "timeout" ? `Status request timed out after ${REQUEST_TIMEOUT_MS / 1000} s. The city keeps running on its own wheels.`
    : got.failure === "network" ? "Squeekchain API is unreachable. The city keeps running on its own wheels."
    : `Status request failed with HTTP ${got.failure}.`;
  return unavailable(note, now.toISOString(), true);
}

export async function fetchMilestones(): Promise<EventsResult> {
  const got = await getJson("/v1/events?category=measurement&limit=40");
  const now = new Date();
  if ("json" in got) return parseEvents(got.json, now);
  const reason = typeof got.failure === "number" ? `http_${got.failure}` : got.failure;
  return { label: "unavailable", reason, milestones: [], fetchedAt: now.toISOString() };
}

export const LABEL_TEXT: Record<DataLabel, string> = {
  live: "Live hardware", stale: "Stale", simulated: "Simulated", replay: "Replayed", derived: "Derived",
  idle: "Live, wheel idle", unavailable: "Unavailable", loading: "Checking",
};
