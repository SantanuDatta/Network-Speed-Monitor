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
    "({ defaultRuntime, transition, calculateStats, resetLog: typeof resetLog === 'undefined' ? undefined : resetLog })",
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
  await vi.waitFor(() => expect(ipFetchFinished).toBe(true));
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
