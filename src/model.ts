const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  intervalSeconds: 1,
  endpoint: "https://www.google.com/generate_204",
  theme: "system",
  soundOnline: true,
  soundOffline: true,
  dateFormat: "locale",
  precision: 2
};

const MAX_SEGMENTS = 6500;
const MAX_SAMPLES = 300;

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultRuntime(now = Date.now()): RuntimeState {
  return {
    status: "no_data",
    statusSince: now,
    latencyMs: null,
    publicIp: null,
    lastProbeAt: null,
    lastHeartbeatAt: null,
    samples: []
  };
}

function appendSample(runtime: RuntimeState, sample: RealtimeSample): void {
  runtime.samples.push(sample);
  if (runtime.samples.length > MAX_SAMPLES)
    runtime.samples.splice(0, runtime.samples.length - MAX_SAMPLES);
}

function transition(
  segments: StatusSegment[],
  runtime: RuntimeState,
  status: ConnectionStatus,
  at: number,
  latencyMs: number | null,
  ip: string | null,
  reason?: string
): boolean {
  const changed = runtime.status !== status;
  if (changed) {
    const open = segments.find((segment) => segment.endedAt === null);
    if (open) open.endedAt = at;
    segments.push({ id: makeId(), status, startedAt: at, endedAt: null, latencyMs, ip, reason });
    if (segments.length > MAX_SEGMENTS) segments.splice(0, segments.length - MAX_SEGMENTS);
    runtime.status = status;
    runtime.statusSince = at;
  }
  runtime.latencyMs = latencyMs;
  runtime.lastProbeAt = at;
  runtime.lastHeartbeatAt = at;
  if (ip) runtime.publicIp = ip;
  appendSample(runtime, { at, status, latencyMs });
  return changed;
}

function intervalBounds(key: "today" | "week" | "month" | "all", now: number): [number, number] {
  if (key === "all") return [0, now];
  const date = new Date(now);
  if (key === "today") date.setHours(0, 0, 0, 0);
  if (key === "week") date.setDate(date.getDate() - 7);
  if (key === "month") date.setDate(date.getDate() - 30);
  return [date.getTime(), now];
}

function calculateStats(segments: StatusSegment[], from: number, to: number): AggregateStats {
  let monitoredMs = 0;
  let downtimeMs = 0;
  let disconnects = 0;
  for (const segment of segments) {
    const start = Math.max(from, segment.startedAt);
    const end = Math.min(to, segment.endedAt ?? to);
    if (end <= start || segment.status === "no_data") continue;
    const duration = end - start;
    monitoredMs += duration;
    if (segment.status === "offline" || segment.status === "connection_issue") {
      downtimeMs += duration;
      if (segment.startedAt >= from && segment.startedAt < to) disconnects++;
    }
  }
  return {
    disconnects,
    monitoredMs,
    downtimeMs,
    availability: monitoredMs ? ((monitoredMs - downtimeMs) / monitoredMs) * 100 : null
  };
}
