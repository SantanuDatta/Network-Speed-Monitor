let monitor: ConnectionMonitor | undefined;
let initialization: Promise<ConnectionMonitor> | undefined;

async function getMonitor(): Promise<ConnectionMonitor> {
  if (monitor) {
    return monitor;
  }

  initialization ??= initializeMonitor().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

async function initializeMonitor(): Promise<ConnectionMonitor> {
  const nextMonitor = new ConnectionMonitor();
  await nextMonitor.initialize();

  monitor = nextMonitor;
  const snapshot = nextMonitor.snapshot();
  queueToolbarUpdate(snapshot.runtime);

  return nextMonitor;
}

browser.runtime.onInstalled.addListener(() => void getMonitor());
browser.runtime.onStartup.addListener(() => void getMonitor());

browser.runtime.onMessage.addListener(async (request: RuntimeRequest) => {
  if (request.type === "popupOpened") {
    setToolbarUpdatesPaused(true);
    return;
  }
  if (request.type === "popupClosed") {
    setToolbarUpdatesPaused(false);
    return;
  }
  if (request.type === "testSound") {
    return playAlertSound(request.sound === "offline" ? "offline" : "online");
  }

  const activeMonitor = await getMonitor();

  switch (request.type) {
    case "getSnapshot":
      return activeMonitor.snapshot();
    case "saveSettings":
      if (!request.settings) throw new Error("Settings are missing.");
      await activeMonitor.updateSettings(request.settings);
      return activeMonitor.snapshot();
    case "clearLog":
      await activeMonitor.clearLog();
      return activeMonitor.snapshot();
    case "probeNow":
      await activeMonitor.probeNow();
      return activeMonitor.snapshot();
    case "exportCsv":
      return createCsv(activeMonitor.snapshot());
    case "exportPdf":
      return createPdf(activeMonitor.snapshot());
  }
});

void getMonitor();
