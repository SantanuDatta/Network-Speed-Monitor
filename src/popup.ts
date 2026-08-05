const POPUP_VERSION = "1.0.1";
let popupRefreshTimer: number | undefined;
let renderedSettingsKey: string | undefined;
let renderedEndpointPermission: boolean | undefined;

type IconName =
  | "arrow-path"
  | "chart-bar"
  | "chart-pie"
  | "check-circle"
  | "chevron-right"
  | "document-text"
  | "exclamation-triangle"
  | "power"
  | "wifi"
  | "x-circle";

const HEROICON_PATHS: Record<IconName, string> = {
  "arrow-path":
    "M16.023 9.348h4.992V4.356m-4.992 4.992 3.181-3.181a8.25 8.25 0 0 0-11.67 0 8.25 8.25 0 0 0 0 11.67 8.25 8.25 0 0 0 11.67 0l.814-.814",
  "chart-bar": "M3.75 3v18m0 0h18M3.75 21l5.25-5.25 3.75 3.75L21 11.25M21 11.25v5.25m0-5.25h-5.25",
  "chart-pie": "M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6ZM13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z",
  "check-circle": "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  "chevron-right": "m9 18 6-6-6-6",
  "document-text":
    "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H6.75A2.25 2.25 0 0 0 4.5 4.5v15A2.25 2.25 0 0 0 6.75 21.75h5.625m-6.75-9h6m-6 3h4.5m8.25 1.5c0 1.243-1.12 2.25-2.5 2.25s-2.5-1.007-2.5-2.25S14.5 15 15.88 15s2.5 1.007 2.5 2.25Zm0 0c0 1.243 1.12 2.25 2.5 2.25s2.5-1.007 2.5-2.25S22.26 15 20.88 15s-2.5 1.007-2.5 2.25Z",
  "exclamation-triangle":
    "m12 9.75.008.008M10.71 3.51 2.36 18.04a1.875 1.875 0 0 0 1.63 2.82h16.02a1.875 1.875 0 0 0 1.63-2.82L13.29 3.51a1.875 1.875 0 0 0-2.58 0ZM12 15.75v-3",
  power: "M12 2.25v9.75m6.364-6.364a9 9 0 1 1-12.728 0",
  wifi: "M8.288 15.038a5.25 5.25 0 0 1 7.424 0m-10.076-2.652a9 9 0 0 1 12.728 0M3.72 9.72a11.625 11.625 0 0 1 16.56 0M12 18.75h.008v.008H12v-.008Z",
  "x-circle": "m14.25 9.75-4.5 4.5m0-4.5 4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
};

function heroIcon(name: IconName, className = ""): string {
  return `<svg class="hero-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${HEROICON_PATHS[name]}" /></svg>`;
}

function escapeHtml(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function getApp(): HTMLElement {
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) throw new Error("Popup root element is missing.");
  return app;
}

function setPopupMarkup(container: HTMLElement, markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "text/html").body;
  container.replaceChildren(...Array.from(parsed.childNodes));
}

function getEndpointOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}/*`;
}

function formatAvailability(value: number | null, precision: Settings["precision"]): string {
  return value === null ? "—" : `${value.toFixed(precision)}%`;
}

function getStatusDescription(snapshot: ExtensionSnapshot): string {
  if (!snapshot.settings.enabled) {
    return "Monitoring is paused. Start it when you want to collect connection data.";
  }

  const host = new URL(snapshot.settings.endpoint).host;
  const interval = snapshot.settings.intervalSeconds;

  if (snapshot.runtime.status === "online") {
    return `Checking ${host} every ${interval} second${interval === 1 ? "" : "s"}`;
  }

  return "The monitor will keep checking and log any connection changes.";
}

function getStatusIcon(status: ConnectionStatus): IconName {
  if (status === "online") return "check-circle";
  if (status === "connection_issue") return "exclamation-triangle";
  if (status === "offline") return "x-circle";
  return "power";
}

function getLatencyTone(latencyMs: number | null): string {
  if (latencyMs === null) return "metric-neutral";
  return latencyMs < 200 ? "metric-good" : "metric-warning";
}

function getDisconnectTone(disconnects: number): string {
  if (disconnects === 0) return "metric-good";
  return disconnects <= 2 ? "metric-warning" : "metric-danger";
}

function getAvailabilityTone(availability: number | null): string {
  if (availability === null) return "metric-neutral";
  if (availability >= 99.5) return "metric-good";
  return availability >= 95 ? "metric-warning" : "metric-danger";
}

function getDowntimeTone(stats: AggregateStats): string {
  if (stats.monitoredMs === 0) return "metric-neutral";
  const downtimeRatio = stats.downtimeMs / stats.monitoredMs;
  if (downtimeRatio < 0.005) return "metric-good";
  return downtimeRatio < 0.05 ? "metric-warning" : "metric-danger";
}

function getConnectionTone(snapshot: ExtensionSnapshot): string {
  if (!snapshot.settings.enabled || snapshot.runtime.status === "no_data") return "metric-neutral";
  if (snapshot.runtime.status === "online") return "metric-good";
  if (snapshot.runtime.status === "connection_issue") return "metric-warning";
  return "metric-danger";
}

function renderDataRow(
  label: string,
  value: string,
  tooltip: string,
  tone = "metric-neutral",
  copyable = false
): string {
  const metricId = label.toLowerCase().replaceAll(" ", "-");
  const valueMarkup = copyable
    ? `<button id="copy-public-ip" class="metric-pill ${tone} copyable-metric" type="button" data-ip="${escapeHtml(value)}" aria-label="Copy public IP address">${escapeHtml(value)}</button>`
    : `<strong class="metric-pill ${tone}">${escapeHtml(value)}</strong>`;
  return `<div class="data-row has-tooltip" data-metric="${metricId}" data-tooltip="${escapeHtml(tooltip)}"><span>${label}</span>${valueMarkup}</div>`;
}

function renderNavigationRow(icon: IconName, label: string, hash: string): string {
  return `<button class="navigation-row" type="button" data-dashboard-view="${hash}">${heroIcon(icon)}<span>${label}</span>${heroIcon("chevron-right", "navigation-chevron")}</button>`;
}

async function openDashboard(view: string): Promise<void> {
  await browser.tabs.create({
    url: browser.runtime.getURL(`dashboard.html#${view}`)
  });
  window.close();
}

function renderPermissionPrompt(endpoint: string): string {
  return `<section class="ui-alert" aria-label="Monitoring permission required"><span class="alert-symbol">!</span><div><strong>Allow connectivity checks</strong><p>Grant access to ${escapeHtml(new URL(endpoint).host)} to start monitoring.</p></div><button id="allow-monitoring" class="ui-button ui-button-small" type="button">Allow</button></section>`;
}

function renderPopup(snapshot: ExtensionSnapshot, hasEndpointPermission: boolean): void {
  const { runtime, settings, stats } = snapshot;
  const app = getApp();
  const latency = runtime.latencyMs === null ? "Measuring…" : `${runtime.latencyMs} ms`;
  const statusClass = runtime.status.replace("_", "-");
  const connectionTone = getConnectionTone(snapshot);
  const endpointHost = new URL(settings.endpoint).host;

  document.documentElement.dataset.theme = settings.theme;
  setPopupMarkup(
    app,
    `
    <section class="popup-shell shadcn-popup">
      <header class="popup-header">
        <div class="popup-brand">
          <img class="logo-mark" src="assets/icons/icon-black.svg" width="32" height="32" alt="" />
          <div><strong>Network Speed Monitor</strong><span>Connection health</span></div>
        </div>
        <button class="icon-button settings-button" type="button" data-dashboard-view="settings" title="Open settings" aria-label="Open settings"><img class="settings-cog" src="assets/icons/cog-wheel.svg" width="18" height="18" alt="" /></button>
      </header>

      <section class="ui-card status-card ${statusClass}">
        <div class="status-card-icon" data-live="status-icon">${heroIcon(getStatusIcon(runtime.status))}</div>
        <div class="status-copy"><span class="ui-badge ${statusClass}"><i></i><span data-live="status-label">${statusLabel(runtime.status)}</span></span><h1 data-live="status-heading">${runtime.status === "online" ? "Internet is connected" : statusLabel(runtime.status)}</h1><p data-live="status-description">${getStatusDescription(snapshot)}</p></div>
        <div class="status-actions"><button id="refresh" class="icon-button refresh-button" type="button" title="Run a connection check" aria-label="Run a connection check">${heroIcon("arrow-path")}</button><button id="toggle-monitoring" class="icon-button monitor-power ${settings.enabled ? "is-running" : ""}" type="button" title="${settings.enabled ? "Stop monitoring" : "Start monitoring"}" aria-label="${settings.enabled ? "Stop monitoring" : "Start monitoring"}">${heroIcon("power")}</button></div>
      </section>

      ${hasEndpointPermission ? "" : renderPermissionPrompt(settings.endpoint)}

      <section class="ui-card data-card" aria-label="Current connection details">
        ${renderDataRow("Public IP", runtime.publicIp ?? "Checking…", "Your public IP address. Click to copy to clipboard.", runtime.status === "online" ? "metric-info" : connectionTone, Boolean(runtime.publicIp))}
        ${renderDataRow("Latency", latency, `Latency is measured against ${endpointHost}. It is shown in milliseconds; it is 1/1000 of a second.\n\nLatency is not ICMP ping, so it can be a little higher because of this measurement method.\n\nTurns green if less than 200 ms.`, getLatencyTone(runtime.latencyMs))}
        ${renderDataRow("Online for", formatDuration(Date.now() - runtime.statusSince), "The period of the current online status.", connectionTone)}
      </section>

      <section class="ui-card summary-card ${settings.precision === 7 ? "precision-expert" : ""}" aria-label="Today's connection summary for this device">
        <div class="summary-heading"><span>Today <small class="summary-scope">(this device)</small></span><span class="live-dot">Live</span></div>
        <div class="summary-grid">
          <div class="has-tooltip" data-metric="disconnects" data-tooltip="Internet disconnects counted today.\nGreen: 0 · Amber: 1–2 · Red: 3 or more."><strong class="metric-pill ${getDisconnectTone(stats.today.disconnects)}">${stats.today.disconnects}</strong><span>Disconnects</span></div>
          <div class="has-tooltip" data-metric="availability" data-tooltip="Internet availability today.\nGreen: 99.5% or more · Amber: 95–99.49% · Red: below 95%."><strong class="metric-pill ${getAvailabilityTone(stats.today.availability)}">${formatAvailability(stats.today.availability, settings.precision)}</strong><span>Availability</span></div>
          <div class="has-tooltip" data-metric="downtime" data-tooltip="Downtime today — when the connection was down.\nGreen: below 0.5% · Amber: 0.5–4.99% · Red: 5% or more of today's monitored time."><strong class="metric-pill ${getDowntimeTone(stats.today)}">${formatDuration(stats.today.downtimeMs)}</strong><span>Downtime</span></div>
        </div>
      </section>

      <nav class="ui-card navigation-card" aria-label="Monitor pages">
        ${renderNavigationRow("chart-bar", "Realtime monitor", "realtime")}
        ${renderNavigationRow("document-text", "Connection log", "log")}
        ${renderNavigationRow("chart-pie", "Connection statistics", "stats")}
      </nav>

      <footer class="popup-footer"><span>Updates every second while open</span><span>v${POPUP_VERSION}</span></footer>
    </section>`
  );

  bindPopupEvents(snapshot);
  renderedSettingsKey = JSON.stringify(settings);
  renderedEndpointPermission = hasEndpointPermission;
}

function updateMetric(metricId: string, value: string, tone: string): boolean {
  const valueElement = document.querySelector<HTMLElement>(
    `[data-metric="${metricId}"] .metric-pill`
  );
  if (!valueElement) return false;

  valueElement.textContent = value;
  valueElement.className = `metric-pill ${tone}${valueElement.id === "copy-public-ip" ? " copyable-metric" : ""}`;
  return true;
}

function updatePopupLive(snapshot: ExtensionSnapshot, hasEndpointPermission: boolean): boolean {
  if (
    renderedSettingsKey !== JSON.stringify(snapshot.settings) ||
    renderedEndpointPermission !== hasEndpointPermission
  ) {
    return false;
  }

  const { runtime, settings, stats } = snapshot;
  const statusClass = runtime.status.replace("_", "-");
  const connectionTone = getConnectionTone(snapshot);
  const statusCard = document.querySelector<HTMLElement>(".status-card");
  const statusIcon = document.querySelector<HTMLElement>('[data-live="status-icon"]');
  const statusBadge = document.querySelector<HTMLElement>(".status-copy .ui-badge");
  const statusLabelElement = document.querySelector<HTMLElement>('[data-live="status-label"]');
  const statusHeading = document.querySelector<HTMLElement>('[data-live="status-heading"]');
  const statusDescription = document.querySelector<HTMLElement>('[data-live="status-description"]');
  const monitorButton = document.querySelector<HTMLButtonElement>("#toggle-monitoring");
  const publicIpButton = document.querySelector<HTMLButtonElement>("#copy-public-ip");

  if (
    !statusCard ||
    !statusIcon ||
    !statusBadge ||
    !statusLabelElement ||
    !statusHeading ||
    !statusDescription ||
    !monitorButton
  ) {
    return false;
  }

  if (runtime.publicIp && !publicIpButton) return false;

  statusCard.className = `ui-card status-card ${statusClass}`;
  setPopupMarkup(statusIcon, heroIcon(getStatusIcon(runtime.status)));
  statusBadge.className = `ui-badge ${statusClass}`;
  statusLabelElement.textContent = statusLabel(runtime.status);
  statusHeading.textContent =
    runtime.status === "online" ? "Internet is connected" : statusLabel(runtime.status);
  statusDescription.textContent = getStatusDescription(snapshot);
  monitorButton.className = `icon-button monitor-power ${settings.enabled ? "is-running" : ""}`;
  monitorButton.title = settings.enabled ? "Stop monitoring" : "Start monitoring";
  monitorButton.setAttribute("aria-label", monitorButton.title);

  if (publicIpButton && runtime.publicIp) {
    publicIpButton.textContent = runtime.publicIp;
    publicIpButton.dataset.ip = runtime.publicIp;
    publicIpButton.className = `metric-pill ${runtime.status === "online" ? "metric-info" : connectionTone} copyable-metric`;
  }

  const latency = runtime.latencyMs === null ? "Measuring…" : `${runtime.latencyMs} ms`;
  return [
    updateMetric("latency", latency, getLatencyTone(runtime.latencyMs)),
    updateMetric("online-for", formatDuration(Date.now() - runtime.statusSince), connectionTone),
    updateMetric(
      "disconnects",
      String(stats.today.disconnects),
      getDisconnectTone(stats.today.disconnects)
    ),
    updateMetric(
      "availability",
      formatAvailability(stats.today.availability, settings.precision),
      getAvailabilityTone(stats.today.availability)
    ),
    updateMetric("downtime", formatDuration(stats.today.downtimeMs), getDowntimeTone(stats.today))
  ].every(Boolean);
}

function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : "The monitor could not start.";
  setPopupMarkup(
    getApp(),
    `<section class="popup-shell popup-error"><img class="logo-mark" src="assets/icons/icon-black.svg" width="40" height="40" alt="" /><h1>Monitor unavailable</h1><p>${escapeHtml(message)}</p><button id="retry" class="ui-button" type="button">Try again</button></section>`
  );
  document.querySelector("#retry")?.addEventListener("click", () => void loadPopup());
}

function bindPopupEvents(snapshot: ExtensionSnapshot): void {
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

  document.querySelector("#refresh")?.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "probeNow" } as RuntimeRequest);
    await loadPopup();
  });

  document
    .querySelector<HTMLButtonElement>("#copy-public-ip")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const ip = button.dataset.ip;
      if (!ip) return;

      await navigator.clipboard.writeText(ip);
      button.setAttribute("aria-label", "Public IP copied to clipboard");
    });

  document.querySelector("#allow-monitoring")?.addEventListener("click", async () => {
    const granted = await browser.permissions.request({
      origins: [getEndpointOrigin(snapshot.settings.endpoint), "https://api.ipify.org/*"]
    });

    if (granted) {
      await browser.runtime.sendMessage({
        type: "saveSettings",
        settings: snapshot.settings
      } as RuntimeRequest);
    }

    await loadPopup();
  });

  document.querySelector("#toggle-monitoring")?.addEventListener("click", async () => {
    const enabled = !snapshot.settings.enabled;
    if (enabled) {
      const origin = getEndpointOrigin(snapshot.settings.endpoint);
      const hasPermission = await browser.permissions.contains({ origins: [origin] });
      if (!hasPermission) {
        const granted = await browser.permissions.request({ origins: [origin] });
        if (!granted) return;
      }
    }

    await browser.runtime.sendMessage({
      type: "saveSettings",
      settings: { ...snapshot.settings, enabled }
    } as RuntimeRequest);
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
    const snapshot = (await browser.runtime.sendMessage({
      type: "getSnapshot"
    } as RuntimeRequest)) as ExtensionSnapshot;
    const hasEndpointPermission = await browser.permissions.contains({
      origins: [getEndpointOrigin(snapshot.settings.endpoint)]
    });

    if (!updatePopupLive(snapshot, hasEndpointPermission)) {
      renderPopup(snapshot, hasEndpointPermission);
    }
  } catch (error) {
    renderError(error);
  }
}

async function initializePopup(): Promise<void> {
  await browser.runtime.sendMessage({ type: "popupOpened" } as RuntimeRequest);
  await loadPopup();
  startPopupLiveUpdates();
}

void initializePopup();
window.addEventListener("pagehide", () => {
  stopPopupLiveUpdates();
  void browser.runtime.sendMessage({ type: "popupClosed" } as RuntimeRequest);
});
