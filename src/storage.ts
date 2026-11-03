const STORAGE_KEY = "networkSpeedMonitor";

function storedDefault(): StoredData {
  return {
    schemaVersion: 1,
    settings: { ...DEFAULT_SETTINGS },
    segments: [],
    runtime: defaultRuntime()
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
    runtime: {
      ...defaultRuntime(),
      ...stored.runtime,
      // Data saved before samples were stored has none.
      samples: Array.isArray(stored.runtime?.samples) ? stored.runtime.samples : []
    }
  };
}

async function saveStored(data: StoredData): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: data });
}
