# Network Speed Monitor Privacy Policy

Effective date: July 30, 2026

Network Speed Monitor is a Firefox extension that measures Internet connectivity and latency. It does not require an account and does not use advertising, analytics, or telemetry.

## Information processed

- **Connectivity probes:** The extension sends HTTPS requests to the probe URL selected in Settings. The default probe is `https://www.google.com/generate_204`. The selected host receives the network information that is normally disclosed by an HTTPS request, such as the device's public IP address and standard request metadata. The extension does not attach browsing history, page contents, or account information to these requests.
- **Public IP lookup:** The extension periodically requests the current public IP address from `https://api.ipify.org` so it can display it in the popup and reports. The response is stored locally in Firefox.
- **Local monitoring data:** Settings, latency samples, connection status segments, and exported reports are stored in Firefox's local extension storage. They are not uploaded by the extension.

Changing the probe URL can cause Firefox to request permission for that HTTPS host. A custom probe host receives the same connectivity requests described above. The privacy practices and retention of Google, ipify, or a custom probe host are governed by that service's own policies.

## Sharing and retention

Network Speed Monitor does not sell, share, or transmit monitoring history to the developer. Data remains in Firefox until you clear the log, reset the statistics, clear the extension's storage, or uninstall the extension. Network requests can be disabled by stopping monitoring or uninstalling the extension.

## Contact

For privacy questions or requests, open an issue in the project's GitHub repository:

<https://github.com/SantanuDatta/Network-Speed-Monitor/issues>
