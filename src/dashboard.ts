const DASHBOARD_VIEWS = ["realtime", "log", "stats", "settings"] as const;
type DashboardView = (typeof DASHBOARD_VIEWS)[number];

let snapshot: ExtensionSnapshot;
let view: DashboardView = "realtime";
let refreshTimer: number | undefined;
let isRendering = false;

function esc(value: string): string {
  const span = document.createElement("span");
  span.textContent = value;
  return span.innerHTML;
}

function setDashboardMarkup(container: HTMLElement, markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "text/html").body;
  container.replaceChildren(...Array.from(parsed.childNodes));
}
function download(name: string, type: string, data: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
function date(value: number): string {
  return snapshot.settings.dateFormat === "iso"
    ? new Date(value).toISOString().replace("T", " ").slice(0, 19)
    : new Date(value).toLocaleString();
}
function metric(label: string, value: string): string {
  return `<article class="summary"><span>${label}</span><strong>${value}</strong></article>`;
}

function nav(): string {
  return `<aside><div class="brand"><img class="logo-mark" src="assets/icons/icon-black.svg" width="32" height="32" alt="" /><span>Network<br>Speed Monitor</span></div><nav class="dashboard-nav">${[
    ["realtime", "Realtime"],
    ["log", "Connection log"],
    ["stats", "Statistics"],
    ["settings", "Settings"]
  ]
    .map(
      ([key, label]) =>
        `<button class="nav ${view === key ? "selected" : ""}" data-view="${key}">${label}</button>`
    )
    .join("")}</nav></aside>`;
}
function chart(): string {
  const samples = snapshot.runtime.samples;
  if (!samples.length) return `<div class="empty">Waiting for monitor data…</div>`;
  const width = 760,
    height = 200,
    max = Math.max(100, ...samples.map((sample) => sample.latencyMs ?? 0));
  const points = samples
    .map(
      (sample, index) =>
        `${(index / Math.max(1, samples.length - 1)) * width},${height - ((sample.latencyMs ?? 0) / max) * (height - 24)}`
    )
    .join(" ");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Latency chart"><line x1="0" y1="${height - 1}" x2="${width}" y2="${height - 1}"/><polyline points="${points}"/></svg>`;
}
function realtime(): string {
  return `<section><div class="page-title"><div><p class="eyebrow">LIVE VIEW</p><h1>${statusLabel(snapshot.runtime.status)}</h1></div><button id="probe">Probe now</button></div><div class="status-grid">${metric("Public IP", esc(snapshot.runtime.publicIp ?? "—"))}${metric("Latency", snapshot.runtime.latencyMs === null ? "—" : `${snapshot.runtime.latencyMs} ms`)}${metric("Session status", formatDuration(Date.now() - snapshot.runtime.statusSince))}</div><article class="card"><h2>Latency history</h2>${chart()}</article><article class="card"><h2>Recent probes</h2><table><thead><tr><th>Time</th><th>Status</th><th>Latency</th></tr></thead><tbody>${
    snapshot.runtime.samples
      .slice(-10)
      .reverse()
      .map(
        (sample) =>
          `<tr><td>${date(sample.at)}</td><td><i class="status ${sample.status}"></i>${statusLabel(sample.status)}</td><td>${sample.latencyMs === null ? "—" : `${sample.latencyMs} ms`}</td></tr>`
      )
      .join("") || `<tr><td colspan="3">No samples yet</td></tr>`
  }</tbody></table></article></section>`;
}
function log(): string {
  return `<section><div class="page-title"><div><p class="eyebrow">HISTORY</p><h1>Connection log</h1></div><div class="actions"><button id="csv">Export CSV</button><button id="pdf">Export report</button><button class="danger" id="clear">Clear log</button></div></div><article class="card"><table><thead><tr><th>Started</th><th>Status</th><th>Duration</th><th>Latency</th><th>Public IP</th></tr></thead><tbody>${
    snapshot.segments
      .slice()
      .reverse()
      .map(
        (entry) =>
          `<tr><td>${date(entry.startedAt)}</td><td><i class="status ${entry.status}"></i>${statusLabel(entry.status)}</td><td>${formatDuration((entry.endedAt ?? Date.now()) - entry.startedAt)}</td><td>${entry.latencyMs === null ? "—" : `${entry.latencyMs} ms`}</td><td>${esc(entry.ip ?? "—")}</td></tr>`
      )
      .join("") || `<tr><td colspan="5">No connection events have been recorded.</td></tr>`
  }</tbody></table></article></section>`;
}
function stats(): string {
  return `<section><div class="page-title"><div><p class="eyebrow">SUMMARY</p><h1>Connection statistics</h1></div></div><div class="stat-periods">${(
    [
      ["Today", snapshot.stats.today],
      ["Last 7 days", snapshot.stats.week],
      ["Last 30 days", snapshot.stats.month],
      ["All time", snapshot.stats.all]
    ] as [string, AggregateStats][]
  )
    .map(
      ([label, item]) =>
        `<article class="period"><h2>${label}</h2>${metric("Disconnects", String(item.disconnects))}${metric("Availability", item.availability === null ? "—" : `${item.availability.toFixed(snapshot.settings.precision)}%`)}${metric("Downtime", formatDuration(item.downtimeMs))}</article>`
    )
    .join("")}</div></section>`;
}

function renderSelectField(
  name: string,
  label: string,
  value: string | number,
  options: Array<[string | number, string]>,
  description = ""
): string {
  return `<label class="settings-field"><span>${label}</span><div class="select-control"><select name="${name}">${options
    .map(
      ([optionValue, optionLabel]) =>
        `<option value="${optionValue}" ${String(value) === String(optionValue) ? "selected" : ""}>${optionLabel}</option>`
    )
    .join("")}</select></div>${description ? `<small>${description}</small>` : ""}</label>`;
}

function renderSwitchField(
  name: string,
  label: string,
  checked: boolean,
  description = ""
): string {
  return `<label class="switch-field"><span><strong>${label}</strong>${description ? `<small>${description}</small>` : ""}</span><input name="${name}" type="checkbox" ${checked ? "checked" : ""} /><i aria-hidden="true"></i></label>`;
}

function settings(): string {
  const s = snapshot.settings;
  return `<section class="settings-page"><div class="page-title"><div><p class="eyebrow">PREFERENCES</p><h1>Settings</h1><p class="page-description">Customize monitoring, presentation, and alerts.</p></div></div><form id="settings" class="settings-form"><section class="settings-section"><div class="settings-section-header"><h2>Monitoring</h2><p>How Network Speed Monitor checks your connection.</p></div>${renderSwitchField("enabled", "Monitoring", s.enabled, "Run connectivity checks in the background.")}<div class="settings-field-grid">${renderSelectField(
    "intervalSeconds",
    "Testing interval",
    s.intervalSeconds,
    [
      [1, "Every 1 second"],
      [2, "Every 2 seconds"],
      [3, "Every 3 seconds"],
      [5, "Every 5 seconds"]
    ]
  )}<label class="settings-field"><span>HTTPS ping URL</span><input name="endpoint" required type="url" value="${esc(s.endpoint)}" /><small>Changing this asks Firefox for access to that host.</small></label></div></section><section class="settings-section"><div class="settings-section-header"><h2>Appearance</h2><p>The supplied logo remains the toolbar icon.</p></div><div class="settings-field-grid">${renderSelectField(
    "theme",
    "Theme",
    s.theme,
    [
      ["system", "Use System Default"],
      ["light", "Light"],
      ["dark", "Dark"]
    ]
  )}${renderSelectField("dateFormat", "Date format", s.dateFormat, [
    ["locale", "Local format"],
    ["iso", "ISO 8601"]
  ])}${renderSelectField("precision", "Availability precision", s.precision, [
    [2, "Regular (2 digits)"],
    [7, "Expert (7 digits)"]
  ])}</div></section><section class="settings-section"><div class="settings-section-header"><h2>Alerts</h2><p>Play a short tone when the connection state changes.</p></div><div class="switch-field-grid">${renderSwitchField("soundOnline", "Online sound", s.soundOnline, "When the connection returns.")}${renderSwitchField("soundOffline", "Offline sound", s.soundOffline, "When a probe fails.")}</div></section><div class="settings-actions"><button class="settings-save" type="submit">Save settings</button><p id="form-message" class="quiet" role="status"></p></div></form></section>`;
}

async function render(): Promise<void> {
  if (isRendering) return;
  isRendering = true;

  try {
    snapshot = await browser.runtime.sendMessage({ type: "getSnapshot" } as RuntimeRequest);
    document.documentElement.dataset.theme = snapshot.settings.theme;
    const requested = location.hash.slice(1) as DashboardView;
    if (DASHBOARD_VIEWS.includes(requested)) view = requested;
    setDashboardMarkup(
      document.querySelector<HTMLElement>("#app")!,
      `${nav()}<main class="content">${view === "realtime" ? realtime() : view === "log" ? log() : view === "stats" ? stats() : settings()}</main>`
    );
    syncLiveUpdates();
  } finally {
    isRendering = false;
  }

  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
      location.hash = button.dataset.view!;
      void render();
    })
  );
  document.querySelector("#probe")?.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "probeNow" } as RuntimeRequest);
    await render();
  });
  document.querySelector("#clear")?.addEventListener("click", async () => {
    if (confirm("Delete all connection history?")) {
      await browser.runtime.sendMessage({ type: "clearLog" } as RuntimeRequest);
      await render();
    }
  });
  document
    .querySelector("#csv")
    ?.addEventListener("click", async () =>
      download(
        "network-connection-log.csv",
        "text/csv",
        await browser.runtime.sendMessage({ type: "exportCsv" } as RuntimeRequest)
      )
    );
  document
    .querySelector("#pdf")
    ?.addEventListener("click", async () =>
      download(
        "network-connection-report.pdf",
        "application/pdf",
        await browser.runtime.sendMessage({ type: "exportPdf" } as RuntimeRequest)
      )
    );
  document
    .querySelector<HTMLFormElement>("#settings")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const settings: Settings = {
        enabled: form.get("enabled") === "on",
        intervalSeconds: Number(form.get("intervalSeconds")) as Settings["intervalSeconds"],
        endpoint: String(form.get("endpoint")),
        theme: String(form.get("theme")) as Theme,
        soundOnline: form.get("soundOnline") === "on",
        soundOffline: form.get("soundOffline") === "on",
        dateFormat: String(form.get("dateFormat")) as Settings["dateFormat"],
        precision: Number(form.get("precision")) as Settings["precision"]
      };
      try {
        const url = new URL(settings.endpoint);
        if (url.protocol !== "https:") {
          throw new Error("The probe URL must use HTTPS.");
        }
        const origin = `${url.protocol}//${url.host}/*`;
        const hasPermission = await browser.permissions.contains({ origins: [origin] });
        if (settings.enabled && !hasPermission) {
          const granted = await browser.permissions.request({ origins: [origin] });
          if (!granted) throw new Error("Firefox did not grant access to the probe host.");
        }
        snapshot = (await browser.runtime.sendMessage({
          type: "saveSettings",
          settings
        } as RuntimeRequest)) as ExtensionSnapshot;
        document.documentElement.dataset.theme = snapshot.settings.theme;
        document.querySelector("#form-message")!.textContent = "Settings saved.";
      } catch (error) {
        document.querySelector("#form-message")!.textContent =
          error instanceof Error ? error.message : "Could not save settings.";
      }
    });
}

function syncLiveUpdates(): void {
  if (view === "settings") {
    stopLiveUpdates();
    return;
  }

  if (refreshTimer === undefined) {
    refreshTimer = window.setInterval(() => void render(), 1_000);
  }
}

function stopLiveUpdates(): void {
  if (refreshTimer !== undefined) {
    window.clearInterval(refreshTimer);
    refreshTimer = undefined;
  }
}

window.addEventListener("hashchange", () => void render());
window.addEventListener("pagehide", stopLiveUpdates);
void render();
