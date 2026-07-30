declare const browser: any;

type ConnectionStatus = "online" | "connection_issue" | "offline" | "no_data";
type Theme = "system" | "light" | "dark";

interface Settings {
  enabled: boolean;
  intervalSeconds: 1 | 2 | 3 | 5;
  endpoint: string;
  theme: Theme;
  soundOnline: boolean;
  soundOffline: boolean;
  dateFormat: "locale" | "iso";
  precision: 2 | 7;
}

interface StatusSegment {
  id: string;
  status: ConnectionStatus;
  startedAt: number;
  endedAt: number | null;
  ip: string | null;
  latencyMs: number | null;
  reason?: string;
}

interface RealtimeSample {
  at: number;
  status: ConnectionStatus;
  latencyMs: number | null;
}

interface RuntimeState {
  status: ConnectionStatus;
  statusSince: number;
  latencyMs: number | null;
  publicIp: string | null;
  lastProbeAt: number | null;
  lastHeartbeatAt: number | null;
  samples: RealtimeSample[];
}

interface StoredData {
  schemaVersion: number;
  settings: Settings;
  segments: StatusSegment[];
  runtime: Omit<RuntimeState, "samples">;
}

interface AggregateStats {
  disconnects: number;
  monitoredMs: number;
  downtimeMs: number;
  availability: number | null;
}

interface ExtensionSnapshot {
  settings: Settings;
  segments: StatusSegment[];
  runtime: RuntimeState;
  stats: Record<"today" | "week" | "month" | "all", AggregateStats>;
}

interface RuntimeRequest {
  type:
    | "getSnapshot"
    | "saveSettings"
    | "clearLog"
    | "exportCsv"
    | "exportPdf"
    | "probeNow"
    | "popupOpened"
    | "popupClosed";
  settings?: Settings;
}
