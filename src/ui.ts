// Shared helpers for the popup and dashboard pages.

type IconName =
  | "arrow-down-tray"
  | "arrow-path"
  | "chart-pie"
  | "cog-6-tooth"
  | "document-duplicate"
  | "document-text"
  | "information-circle"
  | "power"
  | "signal"
  | "speaker-wave"
  | "trash";

const HEROICON_PATHS: Record<IconName, string> = {
  "arrow-down-tray":
    "M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3",
  "arrow-path":
    "M16.023 9.348h4.992V4.356m-4.992 4.992 3.181-3.181a8.25 8.25 0 0 0-11.67 0 8.25 8.25 0 0 0 0 11.67 8.25 8.25 0 0 0 11.67 0l.814-.814",
  "chart-pie": "M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6ZM13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z",
  "cog-6-tooth":
    "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  "document-duplicate":
    "M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75",
  "document-text":
    "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z",
  "information-circle":
    "m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z",
  power: "M12 2.25v9.75m6.364-6.364a9 9 0 1 1-12.728 0",
  signal:
    "M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z",
  "speaker-wave":
    "M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z",
  trash:
    "m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
};

// Some Heroicons are drawn off-center in their 24×24 box; nudge them so they
// sit optically centered inside square buttons.
const HEROICON_OFFSETS: Partial<Record<IconName, string>> = {
  "arrow-path": "translate(-1.3 0)",
  power: "translate(0 0.4)"
};

function heroIcon(name: IconName, className = ""): string {
  const offset = HEROICON_OFFSETS[name];
  return `<svg class="hero-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${HEROICON_PATHS[name]}"${offset ? ` transform="${offset}"` : ""}/></svg>`;
}

function escapeHtml(value: string): string {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function byId<T extends HTMLElement | SVGElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setMarkup(container: HTMLElement, markup: string): void {
  const parsed = new DOMParser().parseFromString(markup, "text/html").body;
  container.replaceChildren(...Array.from(parsed.childNodes));
}

// SVG shapes must be parsed in the SVG namespace, or they render as unknown HTML elements.
function setSvgMarkup(container: SVGElement, markup: string): void {
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    "image/svg+xml"
  ).documentElement;
  container.replaceChildren(...Array.from(parsed.childNodes));
}

// Table rows only survive HTML parsing inside a table.
function setTableRows(body: HTMLTableSectionElement, markup: string): void {
  const parsed = new DOMParser()
    .parseFromString(`<table><tbody>${markup}</tbody></table>`, "text/html")
    .querySelector("tbody")!;
  body.replaceChildren(...Array.from(parsed.childNodes));
}

function getEndpointOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.hostname}/*`;
}

function formatClock(value: number, settings: Settings, withSeconds = false): string {
  const date = new Date(value);
  if (settings.dateFormat === "iso") {
    const parts = [date.getHours(), date.getMinutes(), ...(withSeconds ? [date.getSeconds()] : [])];
    return parts.map((part) => String(part).padStart(2, "0")).join(":");
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {})
  });
}

// Like formatDuration, but drops seconds once hours are shown so values stay short.
function formatCompactDuration(milliseconds: number): string {
  if (milliseconds < 3_600_000) return formatDuration(milliseconds);
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1_440)}d ${Math.floor((minutes % 1_440) / 60)}h`;
}

function isFailureStatus(status: ConnectionStatus): boolean {
  return status === "offline" || status === "connection_issue";
}

function describeUptimeCell(cell: UptimeCell): string {
  if (cell.offlineMs > 0) {
    const issue = cell.issueMs > 0 ? `, issues ${formatDuration(cell.issueMs)}` : "";
    return `Offline · ${formatDuration(cell.offlineMs)}${issue}`;
  }
  if (cell.issueMs > 0) return `Connection issue · ${formatDuration(cell.issueMs)}`;
  if (cell.onlineMs > 0) return "No issues";
  return "Not monitored";
}

// Tooltip for one half-hour block of an uptime strip; the newest block runs until now.
function describeUptimeTip(cell: UptimeCell, isCurrent: boolean, settings: Settings): string {
  const end = isCurrent ? "now" : formatClock(cell.from + UPTIME_CELL_MS, settings);
  return `${escapeHtml(describeUptimeCell(cell))} <small>${formatClock(cell.from, settings)}–${end}</small>`;
}

// What the popup and dashboard show: the probe status, or "paused" when monitoring is off.
type DisplayState = ConnectionStatus | "paused";

const STATUS_LABELS: Record<DisplayState, string> = {
  online: "Connected",
  connection_issue: "Connection issue",
  offline: "Offline",
  no_data: "Waiting for data",
  paused: "Paused"
};

function getDisplayState(snapshot: ExtensionSnapshot): DisplayState {
  return snapshot.settings.enabled ? snapshot.runtime.status : "paused";
}

// ISO 8601 calendar date in local time; toISOString() would shift it to UTC.
function formatIsoDate(value: number): string {
  const date = new Date(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}
