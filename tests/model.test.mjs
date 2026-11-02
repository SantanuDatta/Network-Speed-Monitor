import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { expect, test, vi } from "vitest";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

async function loadScripts(paths, globals = {}) {
  const context = vm.createContext({
    console,
    Date,
    Math,
    URL,
    AbortController,
    TextEncoder,
    TextDecoder,
    ...globals
  });

  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    const javascript = transpileModule(source, {
      compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 }
    }).outputText;
    vm.runInContext(javascript, context, { filename: path });
  }

  return context;
}

function getModel(context) {
  return vm.runInContext(
    "({ defaultRuntime, transition, calculateStats, buildUptimeCells, resetLog: typeof resetLog === 'undefined' ? undefined : resetLog })",
    context
  );
}

test("production statistics exclude no-data time", async () => {
  const context = await loadScripts(["src/types.ts", "src/model.ts"]);
  const { calculateStats } = getModel(context);
  const stats = calculateStats(
    [
      { status: "online", startedAt: 0, endedAt: 1000 },
      { status: "offline", startedAt: 1000, endedAt: 2000 },
      { status: "no_data", startedAt: 2000, endedAt: 5000 }
    ],
    0,
    5000
  );

  expect(stats.availability).toBe(50);
});

test("clearing the log starts a fresh segment for the current status", async () => {
  const context = await loadScripts(["src/types.ts", "src/model.ts"]);
  const { defaultRuntime, transition, resetLog } = getModel(context);
  const runtime = defaultRuntime(1_000);
  const segments = [];

  transition(segments, runtime, "online", 2_000, 42, "203.0.113.10");
  resetLog(segments, runtime, 3_000);
  transition(segments, runtime, "online", 4_000, 45, null);

  expect(segments).toHaveLength(1);
  expect(segments[0]).toMatchObject({
    status: "online",
    startedAt: 3_000,
    endedAt: null
  });
  expect(runtime.statusSince).toBe(3_000);
});

test("does not carry online duration through an unavailable gap after an outage", async () => {
  const context = await loadScripts(["src/types.ts", "src/model.ts"]);
  const { defaultRuntime, transition } = getModel(context);
  const runtime = defaultRuntime(1_000);
  const segments = [];

  transition(segments, runtime, "online", 2_000, 42, "203.0.113.10");
  transition(segments, runtime, "offline", 3_000, null, null, "Probe failed");
  transition(segments, runtime, "no_data", 6_000, null, null, "Monitoring was unavailable");
  transition(segments, runtime, "online", 10_000, 45, "203.0.113.10");

  expect(runtime.statusSince).toBe(10_000);
});

test("counts one disconnect across offline and connection-issue classifications", async () => {
  const context = await loadScripts(["src/types.ts", "src/model.ts"]);
  const { calculateStats } = getModel(context);
  const stats = calculateStats(
    [
      { status: "online", startedAt: 0, endedAt: 1_000 },
      { status: "offline", startedAt: 1_000, endedAt: 2_000 },
      { status: "connection_issue", startedAt: 2_000, endedAt: 3_000 },
      { status: "online", startedAt: 3_000, endedAt: 4_000 }
    ],
    0,
    4_000
  );

  expect(stats.disconnects).toBe(1);
});

test("uptime cells take the worst status in each window", async () => {
  const context = await loadScripts(["src/types.ts", "src/model.ts"]);
  const { buildUptimeCells } = getModel(context);
  const cells = buildUptimeCells(
    [
      { status: "online", startedAt: 0, endedAt: 1_500 },
      { status: "connection_issue", startedAt: 1_500, endedAt: 1_800 },
      { status: "online", startedAt: 1_800, endedAt: 3_000 },
      { status: "offline", startedAt: 3_000, endedAt: 3_200 },
      { status: "no_data", startedAt: 3_200, endedAt: null }
    ],
    4_500,
    5,
    1_000
  );

  expect(cells.map((cell) => cell.status)).toEqual([
    "online",
    "connection_issue",
    "online",
    "offline",
    "no_data"
  ]);
  expect(cells[1]).toMatchObject({ from: 1_000, to: 2_000, onlineMs: 700, issueMs: 300 });
  expect(cells[4]).toMatchObject({ from: 4_000, to: 4_500 });
});

test("uptime cells ignore history before the window and cut the open segment at now", async () => {
  const context = await loadScripts(["src/types.ts", "src/model.ts"]);
  const { buildUptimeCells } = getModel(context);
  const cells = buildUptimeCells(
    [
      { status: "offline", startedAt: 0, endedAt: 500 },
      { status: "online", startedAt: 500, endedAt: null }
    ],
    10_250,
    2,
    1_000
  );

  expect(cells).toHaveLength(2);
  expect(cells.every((cell) => cell.status === "online")).toBe(true);
  expect(cells[1].onlineMs).toBe(250);
});

test("uptime cells start on local half-hours in zones with 45-minute offsets", async () => {
  // UTC+5:45 (Nepal): getTimezoneOffset() reports -345 minutes.
  class NepalDate extends Date {
    getTimezoneOffset() {
      return -345;
    }
  }
  const context = await loadScripts(["src/types.ts", "src/model.ts"], { Date: NepalDate });
  const { buildUptimeCells } = getModel(context);
  // 08:10 UTC is 13:55 local, so the current cell starts at 13:30 local = 07:45 UTC.
  const now = Date.UTC(2026, 10, 2, 8, 10);
  const cells = buildUptimeCells([], now);

  expect(cells.at(-1)).toMatchObject({ from: Date.UTC(2026, 10, 2, 7, 45), to: now });
  expect(cells[0].from).toBe(Date.UTC(2026, 10, 2, 7, 45) - 47 * 30 * 60_000);
});

test("shared UI helpers format dates, durations and uptime cells", async () => {
  const context = await loadScripts(["src/types.ts", "src/format.ts", "src/model.ts", "src/ui.ts"]);
  const ui = vm.runInContext(
    "({ formatIsoDate, formatCompactDuration, describeUptimeCell, formatClock })",
    context
  );

  // A local 00:30 keeps its local calendar date, whatever the machine's time zone.
  expect(ui.formatIsoDate(new Date(2026, 9, 30, 0, 30).getTime())).toBe("2026-10-30");
  expect(
    ui.formatClock(new Date(2026, 9, 30, 7, 5, 9).getTime(), { dateFormat: "iso" }, true)
  ).toBe("07:05:09");

  expect(ui.formatCompactDuration(95_000)).toBe("1m 35s");
  expect(ui.formatCompactDuration((2 * 3_600 + 15 * 60 + 56) * 1_000)).toBe("2h 15m");
  expect(ui.formatCompactDuration((2 * 24 + 3) * 3_600_000)).toBe("2d 3h");

  const cell = (fields) => ({
    from: 0,
    to: 1,
    status: "online",
    onlineMs: 0,
    issueMs: 0,
    offlineMs: 0,
    ...fields
  });
  expect(ui.describeUptimeCell(cell({ onlineMs: 1_000 }))).toBe("No issues");
  expect(ui.describeUptimeCell(cell({ issueMs: 36_000 }))).toBe("Connection issue · 36s");
  expect(ui.describeUptimeCell(cell({ offlineMs: 55_000, issueMs: 20_000 }))).toBe(
    "Offline · 55s, issues 20s"
  );
  expect(ui.describeUptimeCell(cell({}))).toBe("Not monitored");
});

test("snapshots keep the open segment unended and can limit history", async () => {
  const now = Date.now();
  const stored = {
    networkSpeedMonitor: {
      schemaVersion: 1,
      settings: {
        enabled: false,
        intervalSeconds: 1,
        endpoint: "https://probe.example.test/ping",
        theme: "system",
        soundOnline: true,
        soundOffline: true,
        dateFormat: "locale",
        precision: 2
      },
      segments: [
        {
          id: "old",
          status: "online",
          startedAt: now - 3 * 86_400_000,
          endedAt: now - 2 * 86_400_000,
          ip: null,
          latencyMs: 20
        },
        {
          id: "open",
          status: "online",
          startedAt: now - 60_000,
          endedAt: null,
          ip: null,
          latencyMs: 20
        }
      ],
      runtime: {
        status: "online",
        statusSince: now - 60_000,
        latencyMs: 20,
        publicIp: null,
        lastProbeAt: now,
        lastHeartbeatAt: now
      }
    }
  };
  const browser = {
    storage: { local: { get: async () => stored, set: async () => {} } },
    permissions: { contains: async () => true },
    browserAction: {
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
      setTitle: async () => {},
      setBadgeText: async () => {}
    }
  };
  const window = { setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout };
  const context = await loadScripts(
    ["src/types.ts", "src/format.ts", "src/model.ts", "src/storage.ts", "src/monitor.ts"],
    {
      browser,
      window,
      navigator: { onLine: true },
      performance: { now: () => 0 },
      fetch: async () => ({})
    }
  );
  const monitor = vm.runInContext("new ConnectionMonitor()", context);
  await monitor.initialize();

  const full = monitor.snapshot();
  expect(full.segments.find((segment) => segment.id === "open").endedAt).toBeNull();
  expect(full.segments.map((segment) => segment.id)).toContain("old");

  const recent = monitor.snapshot(now - 86_400_000);
  expect(recent.segments.map((segment) => segment.id)).not.toContain("old");
  expect(recent.segments.map((segment) => segment.id)).toContain("open");
  expect(recent.stats.all).toBeDefined();
  expect(monitor.snapshot(now, false).stats).toBeUndefined();
});

test("disabling monitoring aborts in-flight probes and cannot restore old status", async () => {
  let resolveProbe;
  let probeStarted = false;
  let probeAborted = false;
  let ipFetchFinished = false;
  let stored = {
    networkSpeedMonitor: {
      schemaVersion: 1,
      settings: {
        enabled: false,
        intervalSeconds: 1,
        endpoint: "https://probe.example.test/ping",
        theme: "system",
        soundOnline: true,
        soundOffline: true,
        dateFormat: "locale",
        precision: 2
      },
      segments: [],
      runtime: {
        status: "online",
        statusSince: 1_000,
        latencyMs: 50,
        publicIp: "203.0.113.10",
        lastProbeAt: Date.now(),
        lastHeartbeatAt: Date.now()
      }
    }
  };

  const browser = {
    storage: {
      local: {
        get: async () => stored,
        set: async (value) => {
          stored = value;
        }
      }
    },
    permissions: { contains: async () => true },
    browserAction: {
      setBadgeBackgroundColor: async () => {},
      setBadgeTextColor: async () => {},
      setTitle: async () => {},
      setBadgeText: async () => {}
    }
  };
  const window = {
    AudioContext: undefined,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout,
    clearTimeout
  };
  const fetch = async (url, options = {}) => {
    if (String(url).includes("api.ipify.org")) {
      return {
        json: async () => {
          ipFetchFinished = true;
          return { ip: "203.0.113.10" };
        }
      };
    }
    probeStarted = true;
    return new Promise((resolve) => {
      resolveProbe = resolve;
      options.signal?.addEventListener("abort", () => {
        probeAborted = true;
        resolve({});
      });
    });
  };
  const context = await loadScripts(
    ["src/types.ts", "src/format.ts", "src/model.ts", "src/storage.ts", "src/monitor.ts"],
    { browser, window, navigator: { onLine: true }, performance: { now: () => 10 }, fetch }
  );
  const monitor = vm.runInContext("new ConnectionMonitor()", context);
  await monitor.initialize();

  const settings = stored.networkSpeedMonitor.settings;
  const enablePromise = monitor.updateSettings({ ...settings, enabled: true });
  await vi.waitFor(() => expect(probeStarted).toBe(true));
  await enablePromise;

  await monitor.updateSettings({ ...settings, enabled: false });
  try {
    expect(probeAborted).toBe(true);
  } finally {
    resolveProbe({});
  }
  expect(ipFetchFinished).toBe(false);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(monitor.snapshot().runtime.status).toBe("no_data");
  expect(monitor.snapshot().segments.at(-1)).toMatchObject({
    status: "no_data",
    reason: "Monitoring paused"
  });
});

test("PDF stream length counts encoded bytes", async () => {
  const context = await loadScripts(["src/types.ts", "src/format.ts", "src/export.ts"]);
  const { createPdf } = vm.runInContext("({ createPdf })", context);
  const pdf = createPdf({
    runtime: { status: "no_data" },
    stats: { all: { disconnects: 0, monitoredMs: 0, downtimeMs: 0, availability: null } }
  });
  const length = Number(pdf.match(/<< \/Length (\d+) >>/)[1]);
  const streamStart = pdf.indexOf("stream\n") + "stream\n".length;
  const streamEnd = pdf.indexOf("\nendstream", streamStart);

  expect(length).toBe(new TextEncoder().encode(pdf.slice(streamStart, streamEnd)).length);
});
