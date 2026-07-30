const STORAGE_KEY = "networkSpeedMonitor";

function storedDefault(): StoredData {
  const runtime = defaultRuntime();
  const { samples, ...savedRuntime } = runtime;
  return {
    schemaVersion: 1,
    settings: { ...DEFAULT_SETTINGS },
    segments: [],
    runtime: savedRuntime
  };
}

async function loadStored(): Promise<StoredData> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as StoredData | undefined;
  if (!stored || stored.schemaVersion !== 1) return storedDefault();
  return {
    ...stored,
    settings: { ...DEFAULT_SETTINGS, ...stored.settings },
    segments: Array.isArray(stored.segments) ? stored.segments : [],
    runtime: { ...defaultRuntime(), ...stored.runtime }
  };
}

async function saveStored(data: StoredData): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: data });
}
