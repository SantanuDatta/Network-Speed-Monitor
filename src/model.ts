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
  const previousStatus = runtime.status;
  const openSegmentIndex = segments.findIndex((segment) => segment.endedAt === null);
  const openSegment = openSegmentIndex === -1 ? undefined : segments[openSegmentIndex];
  const segmentBeforeOpen = openSegmentIndex > 0 ? segments[openSegmentIndex - 1] : undefined;
  const changed = runtime.status !== status;
  if (changed) {
    const preserveOnlineSince =
      (status === "no_data" &&
        previousStatus === "online" &&
        reason === "Monitoring was unavailable") ||
      (status === "online" &&
        previousStatus === "no_data" &&
        openSegment?.reason === "Monitoring was unavailable" &&
        segmentBeforeOpen?.status === "online");

    if (openSegment) openSegment.endedAt = at;
    segments.push({ id: makeId(), status, startedAt: at, endedAt: null, latencyMs, ip, reason });
    if (segments.length > MAX_SEGMENTS) segments.splice(0, segments.length - MAX_SEGMENTS);
    runtime.status = status;
    if (!preserveOnlineSince) runtime.statusSince = at;
  }
  runtime.latencyMs = latencyMs;
  runtime.lastProbeAt = at;
  runtime.lastHeartbeatAt = at;
  if (ip) runtime.publicIp = ip;
  appendSample(runtime, { at, status, latencyMs });
  return changed;
}

function resetLog(segments: StatusSegment[], runtime: RuntimeState, at = Date.now()): void {
  segments.length = 0;
  runtime.statusSince = at;

  if (runtime.status !== "no_data") {
    segments.push({
      id: makeId(),
      status: runtime.status,
      startedAt: at,
      endedAt: null,
      latencyMs: runtime.latencyMs,
      ip: runtime.publicIp
    });
  }
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
