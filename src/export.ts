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
    `Generated: ${new Date().toISOString()}`,
    `Status: ${statusLabel(snapshot.runtime.status)}`,
    `Disconnects: ${stats.disconnects}`,
    `Availability: ${stats.availability?.toFixed(2) ?? "-"}%`,
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
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${textBytes.byteLength} >>\nstream\n${text}\nendstream`
  ];
  const parts: Uint8Array[] = [encoder.encode("%PDF-1.4\n")];
  const offsets = [0];
  let totalLength = parts[0].byteLength;

  for (const [index, object] of objects.entries()) {
    const bytes = encoder.encode(`${index + 1} 0 obj\n${object}\nendobj\n`);
    offsets.push(totalLength);
    parts.push(bytes);
    totalLength += bytes.byteLength;
  }

  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${totalLength}\n%%EOF`
  ].join("");
  parts.push(encoder.encode(xref));

  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
