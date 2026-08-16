const PROBE_TIMEOUT_MS = 8_000;
const IP_PROBE_TIMEOUT_MS = 8_000;
const IP_REFRESH_INTERVAL_MS = 5 * 60_000;
const MISSED_HEARTBEAT_MULTIPLIER = 3;
const IPIFY_ORIGIN = "https://api.ipify.org/*";
const TOOLBAR_UPDATE_DELAY_MS = 250;
const SOUND_GAIN = 0.07;
const SOUND_DURATION_SECONDS = 0.16;
let toolbarStyleInitialized = false;
let lastToolbarTitle: string | undefined;
let lastToolbarBadge: string | undefined;
let toolbarUpdatesPaused = false;
let pendingToolbarRuntime: RuntimeState | undefined;
let toolbarUpdateTimer: number | undefined;
let audioContext: AudioContext | undefined;

interface ProbeResult {
  status: ConnectionStatus;
  latencyMs: number | null;
  reason?: string;
}

class ConnectionMonitor {
  private data!: StoredData;
  private runtime = defaultRuntime();
  private timer: number | undefined;
  private isProbing = false;
  private probeGeneration = 0;
  private activeProbeController: AbortController | undefined;
  private lastIpFetchAt = 0;

  async initialize(): Promise<void> {
    this.data = await loadStored();
    this.runtime = { ...defaultRuntime(), ...this.data.runtime, samples: [] };

    const removedBootstrapErrors = this.removePermissionBootstrapErrors();
    const recordedNoData = this.recordMissedHeartbeat();
    if (removedBootstrapErrors || recordedNoData) await this.persist();
    this.restartMonitoring();
  }

  snapshot(): ExtensionSnapshot {
    const now = Date.now();

    return {
      settings: { ...this.data.settings },
      segments: this.data.segments.map((segment) => ({
        ...segment,
        endedAt: segment.endedAt ?? now
      })),
      runtime: { ...this.runtime, samples: [...this.runtime.samples] },
      stats: {
        today: calculateStats(this.data.segments, ...intervalBounds("today", now)),
        week: calculateStats(this.data.segments, ...intervalBounds("week", now)),
        month: calculateStats(this.data.segments, ...intervalBounds("month", now)),
        all: calculateStats(this.data.segments, ...intervalBounds("all", now))
      }
    };
  }

  async updateSettings(settings: Settings): Promise<void> {
    this.probeGeneration++;
    this.cancelActiveProbe();
    const endpoint = new URL(settings.endpoint);
    const origin = getHttpsOriginPattern(endpoint);

    if (settings.enabled && !(await browser.permissions.contains({ origins: [origin] }))) {
      throw new Error("Allow this probe host before saving settings.");
    }

    this.data.settings = { ...settings, endpoint: endpoint.toString() };

    if (settings.enabled) {
      this.restartMonitoring();
    } else {
      this.stopMonitoring();
      transition(
        this.data.segments,
        this.runtime,
        "no_data",
        Date.now(),
        null,
        this.runtime.publicIp,
        "Monitoring paused"
      );
    }

    await this.persist();
    queueToolbarUpdate(this.runtime);
  }

  async clearLog(): Promise<void> {
    this.probeGeneration++;
    this.cancelActiveProbe();
    resetLog(this.data.segments, this.runtime);
    await this.persist();
  }

  async probeNow(): Promise<void> {
    await this.probe();
  }

  private recordMissedHeartbeat(now = Date.now()): boolean {
    const lastHeartbeatAt = this.data.runtime.lastHeartbeatAt;
    const missedHeartbeatThreshold =
      this.data.settings.intervalSeconds * 1_000 * MISSED_HEARTBEAT_MULTIPLIER;

    if (!lastHeartbeatAt || now - lastHeartbeatAt <= missedHeartbeatThreshold) {
      return false;
    }

    transition(
      this.data.segments,
      this.runtime,
      "no_data",
      lastHeartbeatAt + missedHeartbeatThreshold,
      null,
      this.runtime.publicIp,
      "Monitoring was unavailable"
    );
    return true;
  }

  private removePermissionBootstrapErrors(): boolean {
    const initialCount = this.data.segments.length;
    this.data.segments = this.data.segments.filter(
      (segment) => segment.reason !== "Probe host access has not been granted."
    );
    return this.data.segments.length !== initialCount;
  }

  private restartMonitoring(): void {
    this.stopMonitoring();

    if (!this.data.settings.enabled) {
      return;
    }

    void this.probe();
    this.timer = window.setInterval(
      () => void this.probe(),
      this.data.settings.intervalSeconds * 1_000
    );
  }

  private stopMonitoring(): void {
    this.cancelActiveProbe();
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async probe(): Promise<void> {
    if (this.isProbing || !this.data.settings.enabled) {
      return;
    }

    this.isProbing = true;
    const generation = this.probeGeneration;
    const controller = new AbortController();
    this.activeProbeController = controller;
    const at = Date.now();

    try {
      if (this.recordMissedHeartbeat(at)) {
        await this.persist();
        if (generation !== this.probeGeneration || !this.data.settings.enabled) return;
      }
      const result = await this.runConnectivityProbe(at, controller);
      const publicIp =
        result.status === "online" ? await this.fetchPublicIp(at, controller.signal) : null;
      if (generation !== this.probeGeneration || !this.data.settings.enabled) return;
      const changed = transition(
        this.data.segments,
        this.runtime,
        result.status,
        at,
        result.latencyMs,
        publicIp,
        result.reason
      );

      await this.persist();
      queueToolbarUpdate(this.runtime);
      if (changed) {
        this.notifyStatusTransition(result.status);
      }
    } finally {
      if (this.activeProbeController === controller) this.activeProbeController = undefined;
      this.isProbing = false;
    }
  }

  private async runConnectivityProbe(
    at: number,
    controller: AbortController
  ): Promise<ProbeResult> {
    try {
      const endpoint = new URL(this.data.settings.endpoint);
      const origin = getHttpsOriginPattern(endpoint);
      const hasPermission = await browser.permissions.contains({ origins: [origin] });

      if (controller.signal.aborted) {
        return { status: "no_data", latencyMs: null, reason: "Probe cancelled" };
      }

      if (!hasPermission) {
        return {
          status: "no_data",
          latencyMs: null,
          reason: "Awaiting permission for the probe host"
        };
      }

      const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const startedAt = performance.now();

      try {
        await fetch(withCacheBuster(endpoint, at), {
          cache: "no-store",
          signal: controller.signal
        });
      } finally {
        window.clearTimeout(timeout);
      }

      return {
        status: "online",
        latencyMs: Math.round(performance.now() - startedAt)
      };
    } catch (error) {
      return {
        status: navigator.onLine ? "connection_issue" : "offline",
        latencyMs: null,
        reason: error instanceof Error ? error.message : "Probe failed"
      };
    }
  }

  private async fetchPublicIp(at: number, signal: AbortSignal): Promise<string | null> {
    if (at - this.lastIpFetchAt < IP_REFRESH_INTERVAL_MS) {
      return null;
    }

    this.lastIpFetchAt = at;

    try {
      const hasPermission = await browser.permissions.contains({ origins: [IPIFY_ORIGIN] });
      if (!hasPermission) {
        return null;
      }

      const ipController = new AbortController();
      const abortIpProbe = () => ipController.abort();
      const timeout = window.setTimeout(() => ipController.abort(), IP_PROBE_TIMEOUT_MS);
      signal.addEventListener("abort", abortIpProbe, { once: true });

      try {
        const response = await fetch("https://api.ipify.org?format=json", {
          cache: "no-store",
          signal: ipController.signal
        });
        const payload = (await response.json()) as { ip?: unknown };
        return typeof payload.ip === "string" ? payload.ip : null;
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", abortIpProbe);
      }
    } catch {
      return null;
    }
  }

  private async persist(): Promise<void> {
    const { samples, ...savedRuntime } = this.runtime;
    this.data.runtime = savedRuntime;
    await saveStored(this.data);
  }

  private cancelActiveProbe(): void {
    this.activeProbeController?.abort();
    this.activeProbeController = undefined;
  }

  private notifyStatusTransition(status: ConnectionStatus): void {
    const shouldPlay =
      status === "online"
        ? this.data.settings.soundOnline
        : (status === "offline" || status === "connection_issue") &&
          this.data.settings.soundOffline;

    if (shouldPlay) {
      void playAlertSound(status === "online" ? "online" : "offline");
    }
  }
}

function getHttpsOriginPattern(endpoint: URL): string {
  if (endpoint.protocol !== "https:") {
    throw new Error("Only HTTPS probe URLs are allowed.");
  }

  return `${endpoint.protocol}//${endpoint.hostname}/*`;
}

function withCacheBuster(endpoint: URL, timestamp: number): string {
  endpoint.searchParams.set("_nsm", String(timestamp));
  return endpoint.toString();
}

async function playAlertSound(sound: AlertSound): Promise<boolean> {
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return false;
  }

  audioContext ??= new AudioContextConstructor();

  try {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    if (audioContext.state !== "running") {
      return false;
    }

    const frequency = sound === "online" ? 880 : 220;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startedAt = audioContext.currentTime;
    const endedAt = startedAt + SOUND_DURATION_SECONDS;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, startedAt);
    gain.gain.setValueAtTime(0.0001, startedAt);
    gain.gain.exponentialRampToValueAtTime(SOUND_GAIN, startedAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, endedAt);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
    });
    oscillator.start(startedAt);
    oscillator.stop(endedAt);
    return true;
  } catch {
    return false;
  }
}

async function updateToolbar(runtime: RuntimeState): Promise<void> {
  if (!toolbarStyleInitialized) {
    await browser.browserAction.setBadgeBackgroundColor({ color: "#18181b" });
    if (browser.browserAction.setBadgeTextColor) {
      await browser.browserAction.setBadgeTextColor({ color: "#ffffff" });
    }
    toolbarStyleInitialized = true;
  }

  const title = `Network Speed Monitor · ${statusLabel(runtime.status)}`;
  const badge = getToolbarBadge(runtime);
  if (title !== lastToolbarTitle) {
    await browser.browserAction.setTitle({ title });
    lastToolbarTitle = title;
  }
  if (badge !== lastToolbarBadge) {
    await browser.browserAction.setBadgeText({ text: badge });
    lastToolbarBadge = badge;
  }
}

function queueToolbarUpdate(runtime: RuntimeState): void {
  pendingToolbarRuntime = { ...runtime, samples: [] };
  if (toolbarUpdatesPaused || toolbarUpdateTimer !== undefined) return;

  toolbarUpdateTimer = window.setTimeout(() => {
    toolbarUpdateTimer = undefined;
    if (toolbarUpdatesPaused || !pendingToolbarRuntime) return;
    const nextRuntime = pendingToolbarRuntime;
    pendingToolbarRuntime = undefined;
    void updateToolbar(nextRuntime);
  }, TOOLBAR_UPDATE_DELAY_MS);
}

function setToolbarUpdatesPaused(paused: boolean): void {
  toolbarUpdatesPaused = paused;
  if (!paused && pendingToolbarRuntime) queueToolbarUpdate(pendingToolbarRuntime);
}

function getToolbarBadge(runtime: RuntimeState): string {
  if (runtime.status === "online" && runtime.latencyMs !== null) {
    if (runtime.latencyMs < 1_000) return `${runtime.latencyMs}ms`;
    return `${Math.round(runtime.latencyMs / 1_000)}s`;
  }

  if (runtime.status === "connection_issue") return "!";
  if (runtime.status === "offline") return "×";
  return "";
}
