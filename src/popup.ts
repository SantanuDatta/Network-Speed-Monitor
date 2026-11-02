const POPUP_VERSION = "1.0.9";
const SPARKLINE_SAMPLES = 60;
const SPARKLINE_WIDTH = 300;
const SPARKLINE_HEIGHT = 58;
const SPARKLINE_THRESHOLD_MS = 200;
const DAY_MS = 24 * 60 * 60_000;

let popupRefreshTimer: number | undefined;
let renderedSettingsKey: string | undefined;
let renderedEndpointPermission: boolean | undefined;
let currentSnapshot: ExtensionSnapshot | undefined;
let lastPingedProbeAt: number | null = null;
let sparkHoverIndex: number | null = null;
let stripHoverIndex: number | null = null;
let uptimeCells: UptimeCell[] = [];

function getApp(): HTMLElement {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) throw new Error("Popup root element is missing.");
  return app;
}

function getHero(
  snapshot: ExtensionSnapshot,
  state: DisplayState,
  now: number
): { value: string; unit: string; detail: string } {
  const { runtime, settings } = snapshot;
  const statusFor = formatCompactDuration(now - runtime.statusSince);
  const lastLatency = runtime.latencyMs === null ? "—" : String(runtime.latencyMs);

  if (state === "online") return { value: lastLatency, unit: "ms", detail: `Up ${statusFor}` };
  if (state === "connection_issue") {
    return { value: statusFor, unit: "failing", detail: "Checks are failing" };
  }
  if (state === "offline") return { value: statusFor, unit: "down", detail: "Device is offline" };
  if (state === "paused") {
    return {
      value: lastLatency,
      unit: runtime.latencyMs === null ? "" : "ms",
      detail: runtime.latencyMs === null ? "Not checking" : "Last reading"
    };
  }
  return { value: "—", unit: "", detail: `Every ${settings.intervalSeconds}s` };
}

function renderPermissionPrompt(endpoint: string): string {
  return `<section class="ui-alert" aria-label="Monitoring permission required"><span class="alert-symbol">!</span><div><strong>Allow connectivity checks</strong><p>Grant access to ${escapeHtml(new URL(endpoint).host)} to start monitoring.</p></div><button id="allow-monitoring" class="ui-button ui-button-small" type="button">Allow</button></section>`;
}

function renderPopup(snapshot: ExtensionSnapshot, hasEndpointPermission: boolean): void {
  const { settings } = snapshot;

  document.documentElement.dataset.theme = settings.theme;
  setMarkup(
    getApp(),
    `
    <section class="popup-shell">
      <header class="popup-header">
        <div class="popup-brand">
          <img class="logo-mark" src="assets/icons/icon-black.svg" width="26" height="26" alt="" />
          <div><strong>Network Speed Monitor</strong><span class="version-pill">v${POPUP_VERSION}</span></div>
        </div>
        <button class="icon-button" type="button" data-dashboard-view="settings" title="Open settings" aria-label="Open settings">${heroIcon("cog-6-tooth")}</button>
      </header>

      <section class="popup-hero" aria-label="Current connection">
        <div class="hero-top">
          <span id="status-badge" class="status-badge" role="status"><i id="status-dot"></i><span id="status-label"></span></span>
          <div class="hero-actions">
            <button id="refresh" class="icon-button refresh-button" type="button" title="Check ${escapeHtml(new URL(settings.endpoint).host)} now" aria-label="Run a connection check">${heroIcon("arrow-path")}</button>
            <button id="toggle-monitoring" class="icon-button power-button" type="button">${heroIcon("power")}</button>
          </div>
        </div>
        <div class="hero-main">
          <div class="hero-value"><strong id="hero-value" class="tabular"></strong><span id="hero-unit"></span></div>
          <div class="hero-meta">
            <span id="hero-detail" class="tabular"></span>
            <button id="copy-public-ip" class="hero-ip tabular" type="button"><span>IP</span><span id="public-ip-value"></span>${heroIcon("document-duplicate", "copy-icon")}</button>
          </div>
        </div>
        <div id="sparkline" class="sparkline">
          <div id="sparkline-tip" class="popup-tip tabular"></div>
          <svg viewBox="0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="sparkline-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stop-color="currentColor" stop-opacity="0.3" />
                <stop offset="1" stop-color="currentColor" stop-opacity="0" />
              </linearGradient>
            </defs>
            <line id="sparkline-threshold" class="sparkline-threshold" x1="0" x2="${SPARKLINE_WIDTH}" />
            <g id="sparkline-failures"></g>
            <line id="sparkline-guide" class="sparkline-guide" y1="0" y2="${SPARKLINE_HEIGHT}" />
            <path id="sparkline-area" fill="url(#sparkline-fill)" />
            <polyline id="sparkline-line" class="sparkline-line" />
          </svg>
        </div>
      </section>

      ${hasEndpointPermission ? "" : renderPermissionPrompt(settings.endpoint)}

      <section class="uptime" aria-label="Connection over the last 24 hours">
        <div class="uptime-head"><span>Last 24 hours</span></div>
        <div id="uptime-tip" class="popup-tip tabular"></div>
        <div id="uptime-strip" class="uptime-strip">${"<span></span>".repeat(UPTIME_CELL_COUNT)}</div>
      </section>

      <section class="popup-stats" aria-label="Last 24 hours on this device">
        <div><span>Disconnects</span><strong id="stat-disconnects" class="tabular"></strong></div>
        <div><span>Downtime</span><strong id="stat-downtime" class="tabular"></strong></div>
        <div><span>Availability</span><strong id="stat-availability" class="tabular"></strong></div>
      </section>

      <nav class="popup-nav" aria-label="Monitor pages">
        <button type="button" data-dashboard-view="realtime">${heroIcon("signal")}<span>Live</span></button>
        <button type="button" data-dashboard-view="log">${heroIcon("document-text")}<span>Log</span></button>
        <button type="button" data-dashboard-view="stats">${heroIcon("chart-pie")}<span>Stats</span></button>
      </nav>
    </section>`
  );

  bindPopupEvents();
  renderedSettingsKey = JSON.stringify(settings);
  renderedEndpointPermission = hasEndpointPermission;
  lastPingedProbeAt = snapshot.runtime.lastProbeAt;
  sparkHoverIndex = null;
  stripHoverIndex = null;
}

function updateHero(snapshot: ExtensionSnapshot, state: DisplayState, now: number): void {
  const hero = getHero(snapshot, state, now);
  const badge = byId("status-badge");
  const value = byId("hero-value");
  const power = byId<HTMLButtonElement>("toggle-monitoring");
  if (!badge || !value || !power) return;

  badge.dataset.state = state;
  value.dataset.state = state;
  byId("status-label")!.textContent = STATUS_LABELS[state];
  value.textContent = hero.value;
  byId("hero-unit")!.textContent = hero.unit;
  byId("hero-detail")!.textContent = hero.detail;

  const paused = state === "paused";
  power.classList.toggle("is-paused", paused);
  power.title = paused ? "Start monitoring" : "Stop monitoring";
  power.setAttribute("aria-label", power.title);

  // Ping once per completed check so the dot reflects real probe activity.
  const probeAt = snapshot.runtime.lastProbeAt;
  if (probeAt !== lastPingedProbeAt) {
    lastPingedProbeAt = probeAt;
    const dot = byId("status-dot");
    if (dot && (state === "online" || state === "connection_issue")) {
      dot.classList.remove("ping");
      void dot.offsetWidth;
      dot.classList.add("ping");
    }
  }
}

function sparklineY(latencyMs: number, maxMs: number): number {
  return SPARKLINE_HEIGHT - 3 - (Math.min(latencyMs, maxMs) / maxMs) * (SPARKLINE_HEIGHT - 6);
}

function updateSparkline(snapshot: ExtensionSnapshot, state: DisplayState): void {
  const container = byId("sparkline");
  if (!container) return;

  const samples = snapshot.runtime.samples.slice(-SPARKLINE_SAMPLES);
  const step = SPARKLINE_WIDTH / (SPARKLINE_SAMPLES - 1);
  const offset = SPARKLINE_SAMPLES - samples.length;
  const maxMs = Math.max(
    SPARKLINE_THRESHOLD_MS * 1.3,
    ...samples.map((sample) => sample.latencyMs ?? 0)
  );
  const points: string[] = [];
  let failures = "";
  let bandStart: number | null = null;
  let bandEnd = 0;

  // Consecutive failed checks merge into one shaded band, like the dashboard chart.
  const closeBand = () => {
    if (bandStart === null) return;
    const from = Math.max(0, bandStart - step / 2);
    const to = Math.min(SPARKLINE_WIDTH, bandEnd + step / 2);
    failures += `<rect x="${from.toFixed(1)}" y="0" width="${Math.max(3, to - from).toFixed(1)}" height="${SPARKLINE_HEIGHT}" rx="2" />`;
    bandStart = null;
  };

  samples.forEach((sample, index) => {
    const x = (offset + index) * step;
    if (isFailureStatus(sample.status)) {
      bandStart ??= x;
      bandEnd = x;
    } else {
      closeBand();
    }
    if (sample.latencyMs !== null) {
      points.push(`${x.toFixed(1)},${sparklineY(sample.latencyMs, maxMs).toFixed(1)}`);
    }
  });
  closeBand();

  container.dataset.state = state;
  const thresholdY = sparklineY(SPARKLINE_THRESHOLD_MS, maxMs).toFixed(1);
  const threshold = byId<SVGLineElement>("sparkline-threshold")!;
  threshold.setAttribute("y1", thresholdY);
  threshold.setAttribute("y2", thresholdY);
  setSvgMarkup(byId<SVGGElement>("sparkline-failures")!, failures);
  byId<SVGPolylineElement>("sparkline-line")!.setAttribute("points", points.join(" "));
  byId<SVGPathElement>("sparkline-area")!.setAttribute(
    "d",
    points.length > 1
      ? `M${points[0].split(",")[0]},${SPARKLINE_HEIGHT} L${points.join(" L")} L${points[points.length - 1].split(",")[0]},${SPARKLINE_HEIGHT} Z`
      : ""
  );
  showSparklineTip();
}

function showSparklineTip(): void {
  const container = byId("sparkline");
  const tip = byId("sparkline-tip");
  const guide = byId<SVGLineElement>("sparkline-guide");
  if (!container || !tip || !guide || !currentSnapshot) return;

  const samples = currentSnapshot.runtime.samples.slice(-SPARKLINE_SAMPLES);
  const offset = SPARKLINE_SAMPLES - samples.length;
  const sample = sparkHoverIndex === null ? undefined : samples[sparkHoverIndex - offset];
  if (sparkHoverIndex === null || !sample) {
    tip.classList.remove("is-visible");
    guide.classList.remove("is-visible");
    return;
  }

  const ago = Date.now() - sample.at;
  const value = sample.latencyMs === null ? "Failed" : `${sample.latencyMs} ms`;
  setMarkup(tip, `${value} <small>${ago < 1_500 ? "now" : `${formatDuration(ago)} ago`}</small>`);
  const ratio = sparkHoverIndex / (SPARKLINE_SAMPLES - 1);
  const half = tip.offsetWidth / 2 + 2;
  tip.style.left = `${Math.min(Math.max(ratio * container.clientWidth, half), container.clientWidth - half)}px`;
  tip.classList.add("is-visible");
  const x = String(ratio * SPARKLINE_WIDTH);
  guide.setAttribute("x1", x);
  guide.setAttribute("x2", x);
  guide.classList.add("is-visible");
}

function updateUptime(snapshot: ExtensionSnapshot, now: number): void {
  const strip = byId("uptime-strip");
  if (!strip) return;

  uptimeCells = buildUptimeCells(snapshot.segments, now);
  Array.from(strip.children).forEach((cell, index) => {
    (cell as HTMLElement).dataset.status = uptimeCells[index]?.status ?? "no_data";
  });

  const last24h = calculateStats(snapshot.segments, now - DAY_MS, now);
  const availability = byId("stat-availability")!;
  availability.textContent =
    last24h.availability === null
      ? "—"
      : `${last24h.availability.toFixed(snapshot.settings.precision)}%`;
  // Expert precision (7 digits) needs a smaller size to fit its third of the row.
  availability.classList.toggle("is-long", snapshot.settings.precision > 2);
  byId("stat-disconnects")!.textContent = String(last24h.disconnects);
  byId("stat-downtime")!.textContent = formatCompactDuration(last24h.downtimeMs);
  showUptimeTip();
}

function showUptimeTip(): void {
  const strip = byId("uptime-strip");
  const tip = byId("uptime-tip");
  if (!strip || !tip || !currentSnapshot) return;

  const cell = stripHoverIndex === null ? undefined : uptimeCells[stripHoverIndex];
  strip.classList.toggle("is-hovering", Boolean(cell));
  Array.from(strip.children).forEach((element, index) =>
    element.classList.toggle("is-active", index === stripHoverIndex)
  );
  if (!cell || stripHoverIndex === null) {
    tip.classList.remove("is-visible");
    return;
  }

  const isCurrent = stripHoverIndex === uptimeCells.length - 1;
  setMarkup(tip, describeUptimeTip(cell, isCurrent, currentSnapshot.settings));

  const host = strip.parentElement!;
  const box = strip.children[stripHoverIndex].getBoundingClientRect();
  const center = box.left + box.width / 2 - host.getBoundingClientRect().left;
  const half = tip.offsetWidth / 2 + 2;
  tip.style.left = `${Math.min(Math.max(center, half), host.clientWidth - half)}px`;
  tip.classList.add("is-visible");
}

function updatePublicIp(snapshot: ExtensionSnapshot): void {
  const button = byId<HTMLButtonElement>("copy-public-ip");
  if (!button || button.dataset.copied === "true") return;

  const ip = snapshot.runtime.publicIp;
  byId("public-ip-value")!.textContent = ip ?? "checking…";
  button.disabled = !ip;
  button.dataset.ip = ip ?? "";
  button.title = ip ? "Copy public IP address" : "Checking your public IP";
}

function updatePopupLive(snapshot: ExtensionSnapshot, hasEndpointPermission: boolean): boolean {
  if (
    renderedSettingsKey !== JSON.stringify(snapshot.settings) ||
    renderedEndpointPermission !== hasEndpointPermission ||
    !byId("hero-value")
  ) {
    return false;
  }

  const now = Date.now();
  const state = getDisplayState(snapshot);
  currentSnapshot = snapshot;
  updateHero(snapshot, state, now);
  updateSparkline(snapshot, state);
  updateUptime(snapshot, now);
  updatePublicIp(snapshot);
  return true;
}

async function openDashboard(view: string): Promise<void> {
  await browser.tabs.create({
    url: browser.runtime.getURL(`dashboard.html#${view}`)
  });
  window.close();
}

function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : "The monitor could not start.";
  setMarkup(
    getApp(),
    `<section class="popup-shell popup-error"><img class="logo-mark" src="assets/icons/icon-black.svg" width="40" height="40" alt="" /><h1>Monitor unavailable</h1><p>${escapeHtml(message)}</p><button id="retry" class="ui-button" type="button">Try again</button></section>`
  );
  renderedSettingsKey = undefined;
  document.querySelector("#retry")?.addEventListener("click", () => void loadPopup());
}

function hoverIndex(
  event: MouseEvent,
  element: HTMLElement,
  count: number,
  round: boolean
): number {
  const box = element.getBoundingClientRect();
  const ratio = (event.clientX - box.left) / box.width;
  const index = round ? Math.round(ratio * (count - 1)) : Math.floor(ratio * count);
  return Math.min(Math.max(index, 0), count - 1);
}

function bindPopupEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-dashboard-view]").forEach((button) => {
    button.addEventListener("click", async () => {
      const view = button.dataset.dashboardView;
      if (!view) return;

      button.disabled = true;
      try {
        await openDashboard(view);
      } finally {
        button.disabled = false;
      }
    });
  });

  document.querySelector("#refresh")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.classList.remove("is-spinning");
    void button.offsetWidth;
    button.classList.add("is-spinning");
    try {
      await browser.runtime.sendMessage({ type: "probeNow" } as RuntimeRequest);
    } catch (error) {
      renderError(error);
      return;
    }
    await loadPopup();
  });

  byId<HTMLButtonElement>("copy-public-ip")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const ip = button.dataset.ip;
    if (!ip) return;

    let label = "Copied";
    try {
      await navigator.clipboard.writeText(ip);
    } catch {
      label = "Copy failed";
    }
    button.dataset.copied = "true";
    byId("public-ip-value")!.textContent = label;
    window.setTimeout(() => {
      button.dataset.copied = "false";
      if (currentSnapshot) updatePublicIp(currentSnapshot);
    }, 1_200);
  });

  const sparkline = byId("sparkline");
  sparkline?.addEventListener("mousemove", (event) => {
    sparkHoverIndex = hoverIndex(event, sparkline, SPARKLINE_SAMPLES, true);
    showSparklineTip();
  });
  sparkline?.addEventListener("mouseleave", () => {
    sparkHoverIndex = null;
    showSparklineTip();
  });

  const strip = byId("uptime-strip");
  strip?.addEventListener("mousemove", (event) => {
    stripHoverIndex = hoverIndex(event, strip, UPTIME_CELL_COUNT, false);
    showUptimeTip();
  });
  strip?.addEventListener("mouseleave", () => {
    stripHoverIndex = null;
    showUptimeTip();
  });

  document.querySelector("#allow-monitoring")?.addEventListener("click", async () => {
    if (!currentSnapshot) return;
    try {
      const granted = await browser.permissions.request({
        origins: [getEndpointOrigin(currentSnapshot.settings.endpoint), "https://api.ipify.org/*"]
      });

      if (granted) {
        await browser.runtime.sendMessage({
          type: "saveSettings",
          settings: currentSnapshot.settings
        } as RuntimeRequest);
      }
    } catch (error) {
      renderError(error);
      return;
    }

    await loadPopup();
  });

  document.querySelector("#toggle-monitoring")?.addEventListener("click", async () => {
    if (!currentSnapshot) return;
    const settings = currentSnapshot.settings;
    const enabled = !settings.enabled;
    try {
      if (enabled) {
        // permissions.request must be the first await so Firefox still counts it as
        // part of the click; it resolves without a prompt when access already exists.
        const granted = await browser.permissions.request({
          origins: [getEndpointOrigin(settings.endpoint)]
        });
        if (!granted) return;
      }

      await browser.runtime.sendMessage({
        type: "saveSettings",
        settings: { ...settings, enabled }
      } as RuntimeRequest);
    } catch (error) {
      renderError(error);
      return;
    }
    await loadPopup();
  });
}

function startPopupLiveUpdates(): void {
  stopPopupLiveUpdates();
  popupRefreshTimer = window.setInterval(() => void loadPopup(), 1_000);
}

function stopPopupLiveUpdates(): void {
  if (popupRefreshTimer !== undefined) {
    window.clearInterval(popupRefreshTimer);
    popupRefreshTimer = undefined;
  }
}

async function loadPopup(): Promise<void> {
  try {
    // The popup only shows the last 24 hours and works out its own figures for them,
    // so it asks for just that slice of history and no all-time statistics.
    const snapshot = (await browser.runtime.sendMessage({
      type: "getSnapshot",
      segmentsSince: Date.now() - DAY_MS - UPTIME_CELL_MS,
      includeStats: false
    } as RuntimeRequest)) as ExtensionSnapshot;
    const hasEndpointPermission = await browser.permissions.contains({
      origins: [getEndpointOrigin(snapshot.settings.endpoint)]
    });

    currentSnapshot = snapshot;
    if (!updatePopupLive(snapshot, hasEndpointPermission)) {
      renderPopup(snapshot, hasEndpointPermission);
      updatePopupLive(snapshot, hasEndpointPermission);
    }
  } catch (error) {
    renderError(error);
  }
}

async function initializePopup(): Promise<void> {
  void browser.runtime
    .sendMessage({ type: "popupOpened" } as RuntimeRequest)
    .catch(() => undefined);
  await loadPopup();
  startPopupLiveUpdates();
}

void initializePopup();
window.addEventListener("pagehide", () => {
  stopPopupLiveUpdates();
  void browser.runtime.sendMessage({ type: "popupClosed" } as RuntimeRequest);
});
