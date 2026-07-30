function statusLabel(status: ConnectionStatus): string {
  return (
    {
      online: "Online",
      connection_issue: "Connection issues",
      offline: "No Internet connection",
      no_data: "No data"
    } as Record<ConnectionStatus, string>
  )[status];
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}
