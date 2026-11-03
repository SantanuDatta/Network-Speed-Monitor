const DASHBOARD_VIEWS = ["realtime", "log", "stats", "settings"] as const;
type DashboardView = (typeof DASHBOARD_VIEWS)[number];
type LogFilter = "all" | "problems" | "offline";
// The part of the stored data a snapshot carries.
type SnapshotScope = { segmentsSince: number; includeStats: boolean };

const SLOW_CHECK_MS = 200;
const CHART_WIDTH = 800;
const CHART_HEIGHT = 220;
const LOG_PAGE_DAYS = 7;
const CALENDAR_DAYS = 30;
const DAY_IN_MS = 24 * 60 * 60_000;
const FULL_SCOPE: SnapshotScope = { segmentsSince: 0, includeStats: true };

const VIEW_TITLES: Record<DashboardView, string> = {
  realtime: "Realtime",
  log: "Connection log",
  stats: "Statistics",
  settings: "Settings"
};

const LOG_STATUS_LABELS: Record<ConnectionStatus, string> = {
  online: "Online",
  connection_issue: "Connection issue",
  offline: "Offline",
  no_data: "Not monitored"
};

let snapshot: ExtensionSnapshot | undefined;
let snapshotScope: SnapshotScope = FULL_SCOPE;
// The settings the background page last reported, to fall back to when a save fails.
let confirmedSettings: Settings | undefined;
let view: DashboardView = "realtime";
let refreshTimer: number | undefined;
let isRefreshing = false;
let refreshQueued = false;
let actionErrorTimer: number | undefined;
let endpointSaveInFlight: string | undefined;
let lastDashPingAt: number | null = null;
let chartRangeSeconds = 300;
let chartHoverRatio: number | null = null;
// Geometry of the last drawn chart, so hovering can move the tooltip without redrawing.
let chartView:
  | { samples: RealtimeSample[]; now: number; rangeMs: number; intervalMs: number; maxMs: number }
  | undefined;
let slowListKey = "";
let logFilter: LogFilter = "all";
let logDays = LOG_PAGE_DAYS;
let logKey = "";
let historyKey = "";
let statsTableMarkup = "";
let calendarDays: Array<{ from: number; stats: AggregateStats }> = [];
let statsCells: UptimeCell[] = [];
let savedTimer: number | undefined;
// Settings saved but not yet confirmed by the background page. Later saves build on
// them, and refreshes keep them, so quick changes don't undo each other.
let pendingSettings: Settings | undefined;
let settingsGeneration = 0;

function formatDay(value: number, settings: Settings): string {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((today.getTime() - day.getTime()) / DAY_IN_MS);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (settings.dateFormat === "iso") return formatIsoDate(value);
  return date.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function formatShortDate(value: number, settings: Settings): string {
  if (settings.dateFormat === "iso") return formatIsoDate(value).slice(5);
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function availabilityTone(availability: number | null): string {
  if (availability === null) return "";
  if (availability < 95) return "is-bad";
  return availability < 99.5 ? "is-warn" : "";
}

function formatAvailabilityValue(value: number | null, settings: Settings): string {
  return value === null ? "—" : `${value.toFixed(settings.precision)}%`;
}

function download(name: string, type: string, data: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Firefox reads the blob after click() returns; revoking at once can cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function placeTip(tip: HTMLElement, host: HTMLElement, center: number): void {
  // Keep tooltips inside their container so they never widen the page.
  const half = tip.offsetWidth / 2 + 4;
  tip.style.left = `${Math.min(Math.max(center, half), host.clientWidth - half)}px`;
  tip.classList.add("is-visible");
}

function hideTip(tip: HTMLElement): void {
  tip.classList.remove("is-visible");
  tip.style.left = "50%";
}

function calendarStart(now: number): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (CALENDAR_DAYS - 1));
  return start.getTime();
}

// What each page needs from the background. Realtime and Settings only read the
// live state, so polling there skips the stored history and the statistics.
function scopeFor(page: DashboardView, now: number): SnapshotScope {
  if (page === "log") return { segmentsSince: 0, includeStats: false };
  if (page === "stats") return { segmentsSince: calendarStart(now), includeStats: true };
  return { segmentsSince: now, includeStats: false };
}

function scopeCovers(scope: SnapshotScope, page: DashboardView, now: number): boolean {
  const needed = scopeFor(page, now);
  return (
    scope.segmentsSince <= needed.segmentsSince && (scope.includeStats || !needed.includeStats)
  );
}

// Every snapshot from the background goes through here, so settings that are still
// being saved stay on screen and pages know how much history the snapshot holds.
function applySnapshot(next: ExtensionSnapshot, scope = FULL_SCOPE): void {
  confirmedSettings = next.settings;
  snapshotScope = scope;
  snapshot = pendingSettings ? { ...next, settings: pendingSettings } : next;
}

function showError(message: string, source: "refresh" | "action"): void {
  const error = byId("dash-error")!;
  error.textContent = message;
  error.dataset.source = source;
  error.hidden = false;
  window.clearTimeout(actionErrorTimer);
  if (source === "action") actionErrorTimer = window.setTimeout(() => (error.hidden = true), 6_000);
}

// Runs a button's background request and reports a failure instead of dropping it.
async function runAction(failure: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    showError(failure, "action");
  }
}

function segmentedControl(name: keyof Settings, options: Array<[string, string]>): string {
  return `<div class="dash-segmented" role="radiogroup" data-setting="${name}">${options
    .map(
      ([value, label]) =>
        `<button type="button" role="radio" data-value="${value}">${label}</button>`
    )
    .join("")}</div>`;
}

function settingsSwitch(name: keyof Settings, label: string): string {
  return `<button type="button" class="dash-switch" role="switch" data-setting="${name}" aria-label="${label}"></button>`;
}

function renderShell(): string {
  const version = browser.runtime.getManifest().version;
  return `
  <div class="dash-layout">
    <aside class="dash-sidebar">
      <div class="dash-brand">
        <img class="logo-mark" src="assets/icons/icon-black.svg" width="30" height="30" alt="" />
        <div><strong>Network Speed Monitor</strong><span class="version-pill">v${escapeHtml(version)}</span></div>
      </div>
      <nav class="dash-nav" aria-label="Dashboard pages">
        <button type="button" data-view="realtime">${heroIcon("signal")}<span>Realtime</span></button>
        <button type="button" data-view="log">${heroIcon("document-text")}<span>Connection log</span></button>
        <button type="button" data-view="stats">${heroIcon("chart-pie")}<span>Statistics</span></button>
        <button type="button" data-view="settings">${heroIcon("cog-6-tooth")}<span>Settings</span></button>
      </nav>
      <div class="dash-side-status">
        <div class="dash-side-row"><span id="side-badge" class="status-badge"><i id="side-dot"></i><span id="side-label"></span></span><span id="side-latency" class="tabular"></span></div>
        <small id="side-detail"></small>
      </div>
    </aside>

    <main class="dash-main">
      <p class="dash-error" id="dash-error" role="alert" hidden></p>
      <section class="dash-page" data-page="realtime" hidden>
        <div class="dash-head">
          <div><h1>Realtime</h1><p id="rt-subtitle"></p></div>
          <div class="dash-actions">
            <button id="rt-probe" type="button" class="dash-button">${heroIcon("arrow-path")}<span>Check now</span></button>
            <button id="rt-power" type="button" class="dash-button dash-power">${heroIcon("power")}<span id="rt-power-label"></span></button>
          </div>
        </div>
        <div class="rt-hero">
          <div>
            <span id="rt-badge" class="status-badge"><i id="rt-dot"></i><span id="rt-label"></span></span>
            <div class="rt-value"><strong id="rt-value" class="tabular"></strong><span id="rt-unit"></span></div>
          </div>
          <div class="rt-kpi"><span>Average</span><strong id="rt-average" class="tabular"></strong></div>
          <div class="rt-kpi"><span class="dash-hint" tabindex="0" data-hint="How much latency changes from one check to the next. Lower is steadier.">Jitter ${heroIcon("information-circle")}</span><strong id="rt-jitter" class="tabular"></strong></div>
          <div class="rt-kpi"><span>Failed checks</span><strong id="rt-failed" class="tabular"></strong></div>
        </div>

        <div class="rt-columns">
        <div class="rt-chart-column">
        <div class="dash-section-title">
          <h2>Latency <span>· ms</span></h2>
          <div class="dash-chips" id="rt-range">
            <button type="button" data-range="60">1 min</button>
            <button type="button" data-range="300">5 min</button>
          </div>
        </div>
        <div class="rt-chart" id="rt-chart">
          <div class="rt-axis-y" id="rt-axis-y"></div>
          <div class="dash-tip tabular" id="rt-tip"></div>
          <svg id="rt-chart-svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" preserveAspectRatio="none" role="img" aria-label="Latency chart">
            <defs>
              <linearGradient id="rt-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stop-color="currentColor" stop-opacity="0.22" />
                <stop offset="1" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <g id="rt-grid"></g>
            <g id="rt-bands"></g>
            <line id="rt-guide" class="rt-guide" y1="0" y2="${CHART_HEIGHT}" />
            <path id="rt-area" fill="url(#rt-fill)" />
            <path id="rt-line" class="rt-line" />
            <circle id="rt-hover-dot" class="rt-hover-dot" r="3.5" />
          </svg>
          <div class="rt-axis-x"><span id="rt-axis-start"></span><span>now</span></div>
        </div>

        </div>
        <div class="rt-list-column">
        <div class="dash-section-title"><h2>Slow and failed checks</h2><span id="rt-list-range"></span></div>
        <div class="dash-list rt-list" id="rt-list"></div>
        </div>
        </div>
      </section>

      <section class="dash-page" data-page="log" hidden>
        <div class="dash-head">
          <div><h1>Connection log</h1><p>Every status change, stored on this device</p></div>
          <div class="dash-actions">
            <button id="log-csv" type="button" class="dash-button">${heroIcon("arrow-down-tray")}<span>Export CSV</span></button>
            <button id="log-pdf" type="button" class="dash-button">${heroIcon("document-text")}<span>Export report</span></button>
            <button id="log-clear" type="button" class="dash-button dash-danger">${heroIcon("trash")}<span>Clear log</span></button>
          </div>
        </div>
        <div class="log-toolbar">
          <div class="dash-chips" id="log-filter">
            <button type="button" data-filter="all">All<span class="count" id="log-count-all"></span></button>
            <button type="button" data-filter="problems">Problems<span class="count" id="log-count-problems"></span></button>
            <button type="button" data-filter="offline">Offline<span class="count" id="log-count-offline"></span></button>
          </div>
          <span class="dash-muted">Longer bars mean longer events</span>
        </div>
        <div class="dash-list log-list" id="log-list"></div>
        <div class="log-more" id="log-more"></div>
      </section>

      <section class="dash-page" data-page="stats" hidden>
        <div class="dash-head"><div><h1>Statistics</h1><p>Measured on this device only</p></div></div>
        <table class="stats-table tabular">
          <thead><tr><th></th><th>Today</th><th>Last 7 days</th><th>Last 30 days</th><th>All time</th></tr></thead>
          <tbody id="stats-body"></tbody>
        </table>

        <div class="dash-section-title"><h2>Last 30 days</h2><span>Daily availability</span></div>
        <div class="stats-calendar" id="stats-calendar"><div class="dash-tip tabular" id="calendar-tip"></div>${"<span></span>".repeat(CALENDAR_DAYS)}</div>
        <div class="stats-calendar-axis tabular" id="stats-calendar-axis"></div>
        <div class="stats-legend">
          <span><i class="is-ok"></i>99.5% or more</span><span><i class="is-warn"></i>95–99.5%</span><span><i class="is-bad"></i>Below 95%</span><span><i></i>Not monitored</span>
        </div>

        <div class="dash-section-title"><h2>Last 24 hours</h2><span>Half-hour blocks</span></div>
        <div class="stats-strip" id="stats-strip"><div class="dash-tip tabular" id="strip-tip"></div>${"<span></span>".repeat(UPTIME_CELL_COUNT)}</div>
      </section>

      <section class="dash-page" data-page="settings" hidden>
        <div class="dash-head"><div><h1>Settings</h1><p>Changes save automatically</p></div><p class="settings-status" id="settings-status" role="status"></p></div>
        <div class="settings-group">
          <div><h2>Monitoring</h2><p>How the connection is checked.</p></div>
          <div>
            <div class="settings-row"><div><strong>Monitoring</strong><small>Run checks in the background.</small></div>${settingsSwitch("enabled", "Monitoring")}</div>
            <div class="settings-row"><div><strong>Check every</strong><small>Shorter intervals catch brief drops.</small></div>${segmentedControl(
              "intervalSeconds",
              [
                ["1", "1s"],
                ["2", "2s"],
                ["3", "3s"],
                ["5", "5s"]
              ]
            )}</div>
            <div class="settings-row settings-row-top">
              <div><strong>Check URL</strong><small>Must use HTTPS. Firefox asks for access to the host.</small></div>
              <div class="settings-url">
                <input id="settings-endpoint" type="url" spellcheck="false" aria-describedby="settings-endpoint-error" />
                <small id="settings-endpoint-error" class="settings-error"></small>
              </div>
            </div>
          </div>
        </div>
        <div class="settings-group">
          <div><h2>Appearance</h2><p>How data is shown.</p></div>
          <div>
            <div class="settings-row"><div><strong>Theme</strong></div>${segmentedControl("theme", [
              ["system", "System"],
              ["light", "Light"],
              ["dark", "Dark"]
            ])}</div>
            <div class="settings-row"><div><strong>Date format</strong><small>Used in the log and exports.</small></div>${segmentedControl(
              "dateFormat",
              [
                ["locale", "Local"],
                ["iso", "ISO 8601"]
              ]
            )}</div>
            <div class="settings-row"><div><strong>Availability precision</strong><small>99.98% or 99.9812345%.</small></div>${segmentedControl(
              "precision",
              [
                ["2", "Regular"],
                ["7", "Expert"]
              ]
            )}</div>
          </div>
        </div>
        <div class="settings-group">
          <div><h2>Alerts</h2><p>A short tone when the connection changes.</p></div>
          <div>
            <div class="settings-row"><div><strong>Connection restored</strong><small>When checks succeed again.</small></div><div class="settings-inline"><button type="button" class="dash-button dash-icon-button" data-sound-test="online" title="Preview the connection restored sound" aria-label="Preview the connection restored sound">${heroIcon("speaker-wave")}</button>${settingsSwitch("soundOnline", "Connection restored sound")}</div></div>
            <div class="settings-row"><div><strong>Connection lost</strong><small>When a check fails.</small></div><div class="settings-inline"><button type="button" class="dash-button dash-icon-button" data-sound-test="offline" title="Preview the connection lost sound" aria-label="Preview the connection lost sound">${heroIcon("speaker-wave")}</button>${settingsSwitch("soundOffline", "Connection lost sound")}</div></div>
          </div>
        </div>
      </section>
    </main>
  </div>`;
}

function pingDots(current: ExtensionSnapshot, state: DisplayState): void {
  const probeAt = current.runtime.lastProbeAt;
  if (probeAt === lastDashPingAt) return;
  lastDashPingAt = probeAt;
  if (state !== "online" && state !== "connection_issue") return;
  for (const dot of [byId("side-dot"), byId("rt-dot")]) {
    if (!dot) continue;
    dot.classList.remove("ping");
    void dot.offsetWidth;
    dot.classList.add("ping");
  }
}

function updateSidebar(current: ExtensionSnapshot, state: DisplayState, now: number): void {
  byId("side-badge")!.dataset.state = state;
  byId("side-label")!.textContent = STATUS_LABELS[state];
  const latency = current.runtime.latencyMs;
  byId("side-latency")!.textContent = state === "online" && latency !== null ? `${latency} ms` : "";
  const host = new URL(current.settings.endpoint).host;
  const since = formatCompactDuration(now - current.runtime.statusSince);
  byId("side-detail")!.textContent =
    state === "online"
      ? `${host} · up ${since}`
      : state === "paused"
        ? "Monitoring paused"
        : state === "no_data"
          ? `Checking ${host}`
          : `${STATUS_LABELS[state]} for ${since}`;
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    const selected = button.dataset.view === view;
    button.classList.toggle("is-selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function updateRealtime(current: ExtensionSnapshot, state: DisplayState, now: number): void {
  const { runtime, settings } = current;
  const host = new URL(settings.endpoint).host;
  const interval = settings.intervalSeconds;
  byId("rt-subtitle")!.textContent = settings.enabled
    ? `Checking ${host} every ${interval === 1 ? "second" : `${interval} seconds`}`
    : "Monitoring is paused";
  byId("rt-power-label")!.textContent = settings.enabled ? "Stop monitoring" : "Start monitoring";
  byId("rt-power")!.classList.toggle("is-paused", !settings.enabled);

  byId("rt-badge")!.dataset.state = state;
  byId("rt-label")!.textContent = STATUS_LABELS[state];
  const value = byId("rt-value")!;
  value.dataset.state = state;
  const since = formatCompactDuration(now - runtime.statusSince);
  if (state === "connection_issue" || state === "offline") {
    value.textContent = since;
    byId("rt-unit")!.textContent = state === "offline" ? "down" : "failing";
  } else {
    value.textContent = runtime.latencyMs === null ? "—" : String(runtime.latencyMs);
    byId("rt-unit")!.textContent =
      runtime.latencyMs === null ? "" : state === "paused" ? "ms · last reading" : "ms";
  }

  // Ranges are real time spans, so they stay correct at every check interval.
  const rangeMs = chartRangeSeconds * 1_000;
  const samples = runtime.samples.filter((sample) => sample.at > now - rangeMs);
  const latencies = samples
    .map((sample) => sample.latencyMs)
    .filter((latency): latency is number => latency !== null);
  const failed = samples.filter((sample) => isFailureStatus(sample.status)).length;
  const average = latencies.length
    ? latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length
    : null;
  const jitter =
    latencies.length > 1
      ? latencies
          .slice(1)
          .reduce((sum, latency, index) => sum + Math.abs(latency - latencies[index]), 0) /
        (latencies.length - 1)
      : null;
  setMarkup(
    byId("rt-average")!,
    average === null ? "—" : `${Math.round(average)} <small>ms</small>`
  );
  setMarkup(byId("rt-jitter")!, jitter === null ? "—" : `${Math.round(jitter)} <small>ms</small>`);
  const checks = samples.filter((sample) => sample.status !== "no_data").length;
  setMarkup(byId("rt-failed")!, `${failed} <small>of ${checks}</small>`);
  document.querySelectorAll<HTMLButtonElement>("#rt-range [data-range]").forEach((button) => {
    button.classList.toggle("is-selected", Number(button.dataset.range) === chartRangeSeconds);
  });

  updateChart(samples, state, now, rangeMs, interval * 1_000);
  updateSlowList(samples, settings);
}

function chartX(at: number, view: { now: number; rangeMs: number }): number {
  return CHART_WIDTH * (1 - (view.now - at) / view.rangeMs);
}

function chartY(latency: number, maxMs: number): number {
  return CHART_HEIGHT - (Math.min(latency, maxMs) / maxMs) * CHART_HEIGHT;
}

function updateChart(
  samples: RealtimeSample[],
  state: DisplayState,
  now: number,
  rangeMs: number,
  intervalMs: number
): void {
  const chart = byId("rt-chart")!;
  chart.dataset.state = state;
  const peak = Math.max(0, ...samples.map((sample) => sample.latencyMs ?? 0));
  const maxMs = Math.max(300, Math.ceil(peak / 100) * 100);
  const step = Math.max(100, Math.ceil(maxMs / 4 / 100) * 100);
  chartView = { samples, now, rangeMs, intervalMs, maxMs };
  const x = (at: number) => chartX(at, { now, rangeMs });
  const y = (latency: number) => chartY(latency, maxMs);

  let grid = "";
  let axis = "";
  for (let value = 0; value <= maxMs; value += step) {
    grid += `<line x1="0" x2="${CHART_WIDTH}" y1="${y(value)}" y2="${y(value)}" />`;
    axis += `<span style="top:${(1 - value / maxMs) * 100}%">${value}</span>`;
  }
  grid += `<line class="rt-threshold" x1="0" x2="${CHART_WIDTH}" y1="${y(SLOW_CHECK_MS)}" y2="${y(SLOW_CHECK_MS)}" />`;
  setSvgMarkup(byId<SVGGElement>("rt-grid")!, grid);
  setMarkup(byId("rt-axis-y")!, axis);
  byId("rt-axis-start")!.textContent = chartRangeSeconds === 60 ? "1 min ago" : "5 min ago";

  // Consecutive failed checks merge into one shaded band, padded by half a check
  // interval on each side so a single failure is still visible.
  const halfStep = (intervalMs / rangeMs) * CHART_WIDTH * 0.5;
  let bands = "";
  let bandStart: number | null = null;
  let bandEnd = 0;
  const points: ([number, number] | null)[] = [];
  const closeBand = () => {
    if (bandStart === null) return;
    const from = Math.max(0, x(bandStart) - halfStep);
    const to = Math.min(CHART_WIDTH, x(bandEnd) + halfStep);
    bands += `<rect x="${from.toFixed(1)}" y="0" width="${Math.max(3, to - from).toFixed(1)}" height="${CHART_HEIGHT}" />`;
    bandStart = null;
  };
  samples.forEach((sample, index) => {
    if (isFailureStatus(sample.status)) {
      bandStart ??= sample.at;
      bandEnd = sample.at;
    } else {
      closeBand();
    }
    if (sample.status === "no_data") {
      // Marks where monitoring stopped, e.g. while Firefox was closed.
      if (index > 0 && samples[index - 1].status !== "no_data") {
        const gapX = x(sample.at).toFixed(1);
        bands += `<line class="chart-gap" x1="${gapX}" x2="${gapX}" y1="0" y2="${CHART_HEIGHT}" />`;
      }
      points.push(null);
    } else if (sample.latencyMs !== null) {
      points.push([x(sample.at), y(sample.latencyMs)]);
    }
  });
  closeBand();
  setSvgMarkup(byId<SVGGElement>("rt-bands")!, bands);
  const paths = latencyPaths(points, CHART_HEIGHT);
  byId<SVGPathElement>("rt-line")!.setAttribute("d", paths.line);
  byId<SVGPathElement>("rt-area")!.setAttribute("d", paths.area);
  updateChartHover();
}

// Moves only the hover tooltip, guide and dot; called on every mouse move.
function updateChartHover(): void {
  const chart = byId("rt-chart")!;
  const tip = byId("rt-tip")!;
  const guide = byId<SVGLineElement>("rt-guide")!;
  const dot = byId<SVGCircleElement>("rt-hover-dot")!;
  const view = chartView;
  let sample: RealtimeSample | undefined;
  if (view && chartHoverRatio !== null) {
    const target = view.now - (1 - chartHoverRatio) * view.rangeMs;
    for (const candidate of view.samples) {
      if (!sample || Math.abs(candidate.at - target) < Math.abs(sample.at - target)) {
        sample = candidate;
      }
    }
    if (sample && Math.abs(sample.at - target) > view.intervalMs * 1.5) sample = undefined;
  }
  if (!view || !sample || !snapshot) {
    hideTip(tip);
    guide.classList.remove("is-visible");
    dot.classList.remove("is-visible");
    return;
  }

  const x = chartX(sample.at, view);
  setMarkup(
    tip,
    `${describeSampleLatency(sample)} <small>${formatClock(sample.at, snapshot.settings, true)}</small>`
  );
  const svg = byId("rt-chart-svg")!;
  const center =
    svg.getBoundingClientRect().left -
    chart.getBoundingClientRect().left +
    (x / CHART_WIDTH) * svg.clientWidth;
  placeTip(tip, chart, center);
  guide.setAttribute("x1", String(x));
  guide.setAttribute("x2", String(x));
  guide.classList.add("is-visible");
  if (sample.latencyMs === null) {
    dot.classList.remove("is-visible");
  } else {
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(chartY(sample.latencyMs, view.maxMs)));
    dot.classList.add("is-visible");
  }
}

function updateSlowList(samples: RealtimeSample[], settings: Settings): void {
  type Row = { failed: boolean; at: number; end: number; count: number; latencyMs: number | null };
  const rows: Row[] = [];
  samples.forEach((sample, index) => {
    const failed = isFailureStatus(sample.status);
    if (!failed && (sample.latencyMs === null || sample.latencyMs < SLOW_CHECK_MS)) return;
    const previous = rows[rows.length - 1];
    // A run of failures collapses into one row; slow checks stay individual.
    if (failed && previous?.failed && previous.end === samples[index - 1]?.at) {
      previous.end = sample.at;
      previous.count++;
      return;
    }
    rows.push({ failed, at: sample.at, end: sample.at, count: 1, latencyMs: sample.latencyMs });
  });
  const visible = rows.slice(-8).reverse();
  const key = `${visible.map((row) => `${row.at}:${row.count}`).join(",")}|${chartRangeSeconds}|${settings.dateFormat}|${settings.intervalSeconds}`;
  if (key === slowListKey) return;
  slowListKey = key;

  byId("rt-list-range")!.textContent = chartRangeSeconds === 60 ? "Last minute" : "Last 5 minutes";
  const maxMs = Math.max(300, ...visible.map((row) => row.latencyMs ?? 0));
  setMarkup(
    byId("rt-list")!,
    visible.length
      ? `<div class="dash-row dash-row-head"><span>Time</span><span>Status</span><span>Latency</span><span></span></div>` +
          visible
            .map((row) =>
              row.failed
                ? `<div class="dash-row tabular"><span class="dash-muted">${formatClock(row.at, settings, true)}</span><span><i class="dash-dot is-offline"></i>Failed${row.count > 1 ? ` <span class="dash-muted">· ${row.count} checks</span>` : ""}</span><span class="dash-muted">No response${row.count > 1 ? ` for ${formatDuration(row.end - row.at + settings.intervalSeconds * 1_000)}` : ""}</span><span class="dash-end">—</span></div>`
                : `<div class="dash-row tabular"><span class="dash-muted">${formatClock(row.at, settings, true)}</span><span><i class="dash-dot is-issue"></i>Slow</span><div class="dash-bar"><i class="is-warn" style="width:${((row.latencyMs ?? 0) / maxMs) * 100}%"></i></div><span class="dash-end">${row.latencyMs} ms</span></div>`
            )
            .join("")
      : `<div class="dash-empty"><i class="dash-dot is-online"></i>No slow or failed checks. Every check answered in under ${SLOW_CHECK_MS} ms.</div>`
  );
}

function logCutoff(now: number): number {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (logDays - 1));
  return cutoff.getTime();
}

function updateLog(current: ExtensionSnapshot, now: number): void {
  const segments = current.segments;
  // Counts cover the same days as the list, so a chip never promises hidden rows.
  const cutoff = logCutoff(now);
  const inWindow = segments.filter((segment) => (segment.endedAt ?? now) >= cutoff);
  byId("log-count-all")!.textContent = String(inWindow.length);
  byId("log-count-problems")!.textContent = String(
    inWindow.filter((segment) => isFailureStatus(segment.status)).length
  );
  byId("log-count-offline")!.textContent = String(
    inWindow.filter((segment) => segment.status === "offline").length
  );
  document.querySelectorAll<HTMLButtonElement>("#log-filter [data-filter]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.filter === logFilter);
  });

  // Re-render the list only when the log itself changes; the open row's
  // duration is refreshed in place every second.
  const last = segments[segments.length - 1];
  const key = `${segments.length}|${last?.startedAt}|${last?.endedAt}|${logFilter}|${logDays}|${current.settings.dateFormat}|${Math.floor(now / 60_000)}`;
  if (key !== logKey) {
    logKey = key;
    renderLog(current, now);
  }
  const open = byId("log-open-duration");
  if (open && last && last.endedAt === null)
    open.textContent = formatCompactDuration(now - last.startedAt);
}

function renderLog(current: ExtensionSnapshot, now: number): void {
  const { settings } = current;
  const cutoff = logCutoff(now);
  const matching = current.segments
    .filter((segment) =>
      logFilter === "all"
        ? true
        : logFilter === "offline"
          ? segment.status === "offline"
          : isFailureStatus(segment.status)
    )
    .reverse();
  const shown = matching.filter((segment) => (segment.endedAt ?? now) >= cutoff);
  const older = matching.length - shown.length;

  // Compressed scale: outages last seconds and online stretches last hours,
  // so a linear bar would shrink every outage to a dot.
  const scale = (milliseconds: number) => Math.log10(1 + milliseconds / 1_000);
  const durations = shown.map((segment) => (segment.endedAt ?? now) - segment.startedAt);
  const maxScale = Math.max(1, ...durations.map(scale));
  const toneClass: Record<ConnectionStatus, string> = {
    online: "is-ok",
    connection_issue: "is-warn",
    offline: "is-bad",
    no_data: "is-none"
  };
  const dotClass: Record<ConnectionStatus, string> = {
    online: "is-online",
    connection_issue: "is-issue",
    offline: "is-offline",
    no_data: "is-none"
  };

  let markup = shown.length
    ? `<div class="dash-row dash-row-head"><span>Started</span><span>Status</span><span>Duration</span><span>Latency</span><span>Public IP</span></div>`
    : `<div class="dash-empty">${logFilter === "all" ? "No connection events in this period." : "No matching events in this period."}</div>`;
  let day = "";
  shown.forEach((segment, index) => {
    const dayLabel = formatDay(segment.startedAt, settings);
    if (dayLabel !== day) {
      day = dayLabel;
      markup += `<div class="log-day">${escapeHtml(dayLabel)}</div>`;
    }
    const isOpen = segment.endedAt === null;
    const width = Math.max(4, (scale(durations[index]) / maxScale) * 100);
    const note = isOpen
      ? " · now"
      : segment.status === "no_data" && segment.reason
        ? ` · ${segment.reason.replace(/^Monitoring /, "").toLowerCase()}`
        : "";
    markup += `<div class="dash-row tabular">
      <span class="dash-muted">${formatClock(segment.startedAt, settings)}</span>
      <span><i class="dash-dot ${dotClass[segment.status]}"></i>${LOG_STATUS_LABELS[segment.status]}${note ? `<span class="dash-note">${escapeHtml(note)}</span>` : ""}</span>
      <span class="log-duration"><span${isOpen ? ' id="log-open-duration"' : ""}>${formatCompactDuration(durations[index])}</span><span class="dash-bar"><i class="${toneClass[segment.status]}" style="width:${width}%"></i></span></span>
      <span>${segment.status === "online" && segment.latencyMs !== null ? `${segment.latencyMs} ms` : '<span class="dash-muted">—</span>'}</span>
      <span class="dash-muted">${segment.status === "online" && segment.ip ? escapeHtml(segment.ip) : "—"}</span>
    </div>`;
  });
  setMarkup(byId("log-list")!, markup);
  setMarkup(
    byId("log-more")!,
    older > 0
      ? `<button type="button" class="dash-button" id="log-older">Show older <span class="dash-muted">· ${older} more</span></button>`
      : ""
  );
  byId("log-older")?.addEventListener("click", () => {
    logDays += LOG_PAGE_DAYS;
    if (snapshot) updateLog(snapshot, Date.now());
  });
}

function updateStats(current: ExtensionSnapshot, now: number): void {
  const { settings, stats } = current;
  if (!stats) return;
  const periods = [stats.today, stats.week, stats.month, stats.all];
  const cell = (value: string, tone = "") => `<td class="${tone}">${value}</td>`;
  const rows = [
    `<tr><td>Availability</td>${periods.map((period) => cell(formatAvailabilityValue(period.availability, settings), availabilityTone(period.availability))).join("")}</tr>`,
    `<tr><td>Disconnects</td>${periods.map((period) => cell(String(period.disconnects))).join("")}</tr>`,
    `<tr><td>Downtime</td>${periods.map((period) => cell(formatCompactDuration(period.downtimeMs), availabilityTone(period.availability))).join("")}</tr>`,
    `<tr><td>Monitored</td>${periods.map((period) => cell(formatCompactDuration(period.monitoredMs))).join("")}</tr>`
  ].join("");
  // Replace the table only when a value changes, so text selected in it survives refreshes.
  if (rows !== statsTableMarkup) {
    statsTableMarkup = rows;
    setTableRows(byId<HTMLTableSectionElement>("stats-body")!, rows);
  }

  // The calendar and the 24-hour strip only change when the status does or a new
  // block starts, so recompute them on those changes and at most once a minute.
  const last = current.segments[current.segments.length - 1];
  const key = `${current.segments.length}|${last?.startedAt}|${Math.floor(now / 60_000)}|${settings.dateFormat}`;
  if (key === historyKey) return;
  historyKey = key;
  const start = calendarStart(now);
  calendarDays = Array.from({ length: CALENDAR_DAYS }, (_, index) => {
    const from = new Date(start);
    from.setDate(from.getDate() + index);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return {
      from: from.getTime(),
      stats: calculateStats(current.segments, from.getTime(), Math.min(to.getTime(), now))
    };
  });
  const calendar = byId("stats-calendar")!;
  calendar.querySelectorAll("span").forEach((element, index) => {
    const availability = calendarDays[index].stats.availability;
    element.className = availability === null ? "" : availabilityTone(availability) || "is-ok";
  });
  setMarkup(
    byId("stats-calendar-axis")!,
    `<span>${formatShortDate(calendarDays[0].from, settings)}</span><span>${formatShortDate(calendarDays[15].from, settings)}</span><span>Today</span>`
  );

  statsCells = buildUptimeCells(current.segments, now);
  byId("stats-strip")!
    .querySelectorAll("span")
    .forEach((element, index) => {
      element.dataset.status = statsCells[index]?.status ?? "no_data";
    });
}

function updateSettingsControls(current: ExtensionSnapshot): void {
  const settings = current.settings;
  document.querySelectorAll<HTMLElement>(".dash-segmented[data-setting]").forEach((group) => {
    const value = String(settings[group.dataset.setting as keyof Settings]);
    group.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.setAttribute("aria-checked", String(button.dataset.value === value));
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".dash-switch[data-setting]").forEach((button) => {
    button.setAttribute(
      "aria-checked",
      String(Boolean(settings[button.dataset.setting as keyof Settings]))
    );
  });
  const endpoint = byId<HTMLInputElement>("settings-endpoint")!;
  if (document.activeElement !== endpoint && endpoint.dataset.dirty !== "true") {
    endpoint.value = settings.endpoint;
  }
}

function showSettingsStatus(message: string, isError = false): void {
  const status = byId("settings-status")!;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
  status.classList.add("is-visible");
  window.clearTimeout(savedTimer);
  if (!isError) savedTimer = window.setTimeout(() => status.classList.remove("is-visible"), 1_600);
}

async function saveSettings(changes: Partial<Settings>, canPrompt = true): Promise<boolean> {
  if (!snapshot) return false;
  const next: Settings = { ...(pendingSettings ?? snapshot.settings), ...changes };
  const generation = ++settingsGeneration;
  pendingSettings = next;
  updateSettingsControls({ ...snapshot, settings: next });
  document.documentElement.dataset.theme = next.theme;
  try {
    const url = new URL(next.endpoint);
    if (url.protocol !== "https:") throw new Error("The check URL must use HTTPS.");
    if (next.enabled && (changes.enabled === true || changes.endpoint !== undefined)) {
      const access = { origins: [getEndpointOrigin(next.endpoint)] };
      // permissions.request must be the first await so Firefox still counts it as part
      // of the click or key press; it resolves without a prompt when access exists.
      // Blur is not a user action, so there we can only check existing access.
      const granted = canPrompt
        ? await browser.permissions.request(access)
        : await browser.permissions.contains(access);
      if (!granted) {
        throw new Error(
          canPrompt
            ? "Firefox did not grant access to the check host."
            : `Press Enter to allow access to ${url.host}.`
        );
      }
    }
    const saved = (await browser.runtime.sendMessage({
      type: "saveSettings",
      settings: next
    } as RuntimeRequest)) as ExtensionSnapshot;
    if (generation === settingsGeneration) pendingSettings = undefined;
    applySnapshot(saved);
    logKey = "";
    historyKey = "";
    slowListKey = "";
    update();
    showSettingsStatus("Saved");
    return true;
  } catch (error) {
    // When the newest save fails, go back to what the background page has, not to
    // the settings of an earlier save that finished in the meantime.
    if (generation === settingsGeneration) {
      pendingSettings = undefined;
      if (snapshot && confirmedSettings) snapshot = { ...snapshot, settings: confirmedSettings };
    }
    showSettingsStatus(error instanceof Error ? error.message : "Could not save settings.", true);
    update();
    return false;
  }
}

async function saveEndpoint(input: HTMLInputElement, canPrompt: boolean): Promise<void> {
  const error = byId("settings-endpoint-error")!;
  const value = input.value.trim();
  // Enter opens Firefox's permission prompt, which blurs the field; that blur must not
  // start a second save of the same address while the first waits for an answer.
  if (value === endpointSaveInFlight) return;
  if (!snapshot || value === snapshot.settings.endpoint) {
    input.dataset.dirty = "false";
    error.textContent = "";
    input.removeAttribute("aria-invalid");
    return;
  }
  let message = "";
  try {
    if (new URL(value).protocol !== "https:") message = "Use an https:// address.";
  } catch {
    message = "Enter a full address, like https://www.google.com/generate_204.";
  }
  if (message) {
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
    return;
  }
  error.textContent = "";
  input.removeAttribute("aria-invalid");
  endpointSaveInFlight = value;
  try {
    if (await saveSettings({ endpoint: value }, canPrompt)) input.dataset.dirty = "false";
  } finally {
    endpointSaveInFlight = undefined;
  }
}

function showView(next: DashboardView): void {
  view = next;
  // Name the page in the tab title so several dashboard tabs are easy to tell apart.
  document.title = `${VIEW_TITLES[next]} · Network Speed Monitor`;
  document.querySelectorAll<HTMLElement>(".dash-page").forEach((page) => {
    page.hidden = page.dataset.page !== next;
  });
  chartHoverRatio = null;
  if (snapshot && next === "settings") updateSettingsControls(snapshot);
  update();
  // Realtime and Settings polls carry no history, so fetch it now instead of
  // waiting for the next tick.
  if (snapshot && !scopeCovers(snapshotScope, next, Date.now())) void refresh();
}

function update(): void {
  if (!snapshot) return;
  const now = Date.now();
  const state = getDisplayState(snapshot);
  document.documentElement.dataset.theme = snapshot.settings.theme;
  updateSidebar(snapshot, state, now);
  pingDots(snapshot, state);
  if (view === "realtime") updateRealtime(snapshot, state, now);
  // Until a snapshot with enough history arrives, history pages keep what they show.
  const hasHistory = scopeCovers(snapshotScope, view, now);
  if (view === "log" && hasHistory) updateLog(snapshot, now);
  if (view === "stats" && hasHistory) updateStats(snapshot, now);
  if (view === "settings") updateSettingsControls(snapshot);
}

async function refresh(): Promise<void> {
  // A refresh asked for mid-request (say, by a page switch) runs once that one ends.
  if (isRefreshing) {
    refreshQueued = true;
    return;
  }
  isRefreshing = true;
  const generation = settingsGeneration;
  const scope = scopeFor(view, Date.now());
  const error = byId("dash-error")!;
  try {
    const next = (await browser.runtime.sendMessage({
      type: "getSnapshot",
      ...scope
    } as RuntimeRequest)) as ExtensionSnapshot;
    if (error.dataset.source === "refresh") error.hidden = true;
    // A save that started meanwhile already holds newer settings than this snapshot.
    if (generation !== settingsGeneration) return;
    applySnapshot(next, scope);
    update();
  } catch {
    showError(
      snapshot
        ? "Lost contact with the monitor. Retrying…"
        : "Couldn't load monitor data. Retrying…",
      "refresh"
    );
  } finally {
    isRefreshing = false;
    if (refreshQueued) {
      refreshQueued = false;
      void refresh();
    }
  }
}

function bindStripHover(
  hostId: string,
  tipId: string,
  describe: (index: number) => string | null
): void {
  const host = byId(hostId)!;
  const tip = byId(tipId)!;
  const cells = Array.from(host.querySelectorAll("span"));
  host.addEventListener("mousemove", (event) => {
    const target = (event.target as HTMLElement).closest("span");
    const index = target ? cells.indexOf(target) : -1;
    if (index < 0) return;
    const text = describe(index);
    if (!text) return;
    host.classList.add("is-hovering");
    cells.forEach((cell, cellIndex) => cell.classList.toggle("is-active", cellIndex === index));
    setMarkup(tip, text);
    const box = cells[index].getBoundingClientRect();
    placeTip(tip, host, box.left + box.width / 2 - host.getBoundingClientRect().left);
  });
  host.addEventListener("mouseleave", () => {
    host.classList.remove("is-hovering");
    cells.forEach((cell) => cell.classList.remove("is-active"));
    hideTip(tip);
  });
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
      location.hash = button.dataset.view!;
    })
  );

  byId("rt-probe")!.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.classList.remove("is-spinning");
    void button.offsetWidth;
    button.classList.add("is-spinning");
    await runAction("Couldn't run the check. Try again.", async () => {
      applySnapshot(
        (await browser.runtime.sendMessage({
          type: "probeNow"
        } as RuntimeRequest)) as ExtensionSnapshot
      );
      update();
    });
  });
  byId("rt-power")!.addEventListener("click", () => {
    if (snapshot) void saveSettings({ enabled: !(pendingSettings ?? snapshot.settings).enabled });
  });
  document.querySelectorAll<HTMLButtonElement>("#rt-range [data-range]").forEach((button) =>
    button.addEventListener("click", () => {
      chartRangeSeconds = Number(button.dataset.range);
      chartHoverRatio = null;
      update();
    })
  );
  const svg = byId("rt-chart-svg")!;
  svg.addEventListener("mousemove", (event) => {
    const box = svg.getBoundingClientRect();
    chartHoverRatio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    updateChartHover();
  });
  svg.addEventListener("mouseleave", () => {
    chartHoverRatio = null;
    updateChartHover();
  });

  document.querySelectorAll<HTMLButtonElement>("#log-filter [data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      logFilter = button.dataset.filter as LogFilter;
      logDays = LOG_PAGE_DAYS;
      update();
    })
  );
  byId("log-csv")!.addEventListener("click", () =>
    runAction("Couldn't export the log. Try again.", async () =>
      download(
        "network-connection-log.csv",
        "text/csv",
        await browser.runtime.sendMessage({ type: "exportCsv" } as RuntimeRequest)
      )
    )
  );
  byId("log-pdf")!.addEventListener("click", () =>
    runAction("Couldn't export the report. Try again.", async () =>
      download(
        "network-connection-report.pdf",
        "application/pdf",
        await browser.runtime.sendMessage({ type: "exportPdf" } as RuntimeRequest)
      )
    )
  );
  byId("log-clear")!.addEventListener("click", async () => {
    if (!confirm("Delete all connection history?")) return;
    await runAction("Couldn't clear the log. Try again.", async () => {
      applySnapshot(
        (await browser.runtime.sendMessage({
          type: "clearLog"
        } as RuntimeRequest)) as ExtensionSnapshot
      );
      logKey = "";
      historyKey = "";
      update();
    });
  });

  bindStripHover("stats-calendar", "calendar-tip", (index) => {
    const day = calendarDays[index];
    if (!day || !snapshot) return null;
    const date =
      snapshot.settings.dateFormat === "iso"
        ? formatIsoDate(day.from)
        : new Date(day.from).toLocaleDateString([], {
            weekday: "short",
            month: "short",
            day: "numeric"
          });
    const label =
      day.stats.availability === null
        ? "Not monitored"
        : `${formatAvailabilityValue(day.stats.availability, snapshot.settings)} available`;
    return `${escapeHtml(label)} <small>${escapeHtml(date)}</small>`;
  });
  bindStripHover("stats-strip", "strip-tip", (index) => {
    const cell = statsCells[index];
    if (!cell || !snapshot) return null;
    return describeUptimeTip(cell, index === statsCells.length - 1, snapshot.settings);
  });

  document.querySelectorAll<HTMLElement>(".dash-segmented[data-setting]").forEach((group) =>
    group.querySelectorAll<HTMLButtonElement>("button").forEach((button) =>
      button.addEventListener("click", () => {
        const name = group.dataset.setting as keyof Settings;
        const raw = button.dataset.value!;
        const value = name === "intervalSeconds" || name === "precision" ? Number(raw) : raw;
        void saveSettings({ [name]: value } as Partial<Settings>);
      })
    )
  );
  document.querySelectorAll<HTMLButtonElement>(".dash-switch[data-setting]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!snapshot) return;
      const name = button.dataset.setting as keyof Settings;
      const current = pendingSettings ?? snapshot.settings;
      void saveSettings({ [name]: !current[name] } as Partial<Settings>);
    })
  );
  // The URL saves on Enter or when the field loses focus, never per keystroke,
  // so half-typed addresses don't trigger permission prompts.
  const endpoint = byId<HTMLInputElement>("settings-endpoint")!;
  endpoint.addEventListener("input", () => {
    endpoint.dataset.dirty = "true";
  });
  endpoint.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void saveEndpoint(endpoint, true);
    if (event.key === "Escape" && snapshot) {
      endpoint.value = snapshot.settings.endpoint;
      endpoint.dataset.dirty = "false";
      byId("settings-endpoint-error")!.textContent = "";
      endpoint.removeAttribute("aria-invalid");
    }
  });
  endpoint.addEventListener("blur", () => void saveEndpoint(endpoint, false));
  document.querySelectorAll<HTMLButtonElement>("[data-sound-test]").forEach((button) =>
    button.addEventListener("click", async () => {
      const sound = button.dataset.soundTest as AlertSound;
      // Icon-only button: the playing state shows as an accent tint instead of text.
      button.disabled = true;
      button.classList.add("is-playing");
      try {
        const played = await browser.runtime.sendMessage({
          type: "testSound",
          sound
        } as RuntimeRequest);
        if (!played)
          showSettingsStatus("Firefox blocked the sound. Click the speaker again.", true);
      } finally {
        button.disabled = false;
        button.classList.remove("is-playing");
      }
    })
  );
}

function viewFromHash(): DashboardView {
  const requested = location.hash.slice(1) as DashboardView;
  return DASHBOARD_VIEWS.includes(requested) ? requested : "realtime";
}

async function initializeDashboard(): Promise<void> {
  const app = document.querySelector<HTMLElement>("#app")!;
  setMarkup(app, renderShell());
  bindEvents();
  showView(viewFromHash());
  await refresh();
  // Skip polling while the tab is hidden; catch up as soon as it is shown again.
  refreshTimer = window.setInterval(() => {
    if (!document.hidden) void refresh();
  }, 1_000);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});

window.addEventListener("hashchange", () => showView(viewFromHash()));
window.addEventListener("pagehide", () => {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
});
void initializeDashboard();
