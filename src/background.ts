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

function createCsv(snapshot: ExtensionSnapshot): string {
  const rows = [["Started", "Ended", "Status", "Duration", "Latency (ms)", "Public IP", "Reason"]];
  for (const item of snapshot.segments)
    rows.push([
      new Date(item.startedAt).toISOString(),
      new Date(item.endedAt ?? Date.now()).toISOString(),
      statusLabel(item.status),
      formatDuration((item.endedAt ?? Date.now()) - item.startedAt),
      item.latencyMs?.toString() ?? "",
      item.ip ?? "",
      item.reason ?? ""
    ]);
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function createPdf(snapshot: ExtensionSnapshot): string {
  const stats = snapshot.stats.all;
  const lines = [
    "Network Speed Monitor report",
    `Generated: ${new Date().toLocaleString()}`,
    `Status: ${statusLabel(snapshot.runtime.status)}`,
    `Disconnects: ${stats.disconnects}`,
    `Availability: ${stats.availability?.toFixed(2) ?? "—"}%`,
    `Downtime: ${formatDuration(stats.downtimeMs)}`,
    "",
    "Use CSV export for detailed event records."
  ];
  const text = lines
    .map(
      (line, index) =>
        `BT /F1 12 Tf 50 ${760 - index * 20} Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

void getMonitor();
