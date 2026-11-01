# Network Speed Monitor

Keep track of Internet dropouts and response times from Firefox. See whether your connection is
working, when it last went down, and how reliable it has been throughout the day.

Network Speed Monitor measures connection availability and HTTPS response latency in milliseconds.
It does not measure download or upload speed in Mbps.

## What you can do

- Check your current connection status, response time, and public IP from the toolbar.
- Watch recent response times in the realtime monitor.
- See when your connection dropped and how long each interruption lasted.
- Review availability, disconnects, and downtime for today, this week, this month, or all recorded time.
- Export the connection log as CSV or a PDF report.
- Get sound alerts when a check fails or your connection comes back.
- Choose how often to check your connection: every 1, 2, 3, or 5 seconds.
- Use a light, dark, or system theme.

## Install

Requires **Firefox 152 or newer on desktop**.

The [GitHub releases](https://github.com/SantanuDatta/Network-Speed-Monitor/releases) include an
extension ZIP. To try it in Firefox:

1. Download the extension ZIP from a release and extract it into a folder.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on** and select `manifest.json` inside that folder.
4. Open Network Speed Monitor from Firefox's extensions menu. Pin it to the toolbar for easy access.

This installation lasts until Firefox closes. The GitHub ZIP is unsigned; Firefox requires a signed
add-on for permanent installation.

## Start monitoring

Monitoring starts automatically. Click the toolbar icon to see your connection status and recent
statistics. Use the refresh button to run a check immediately, or the power button to pause and
resume monitoring.

Open **Realtime monitor** to watch response times, **Connection log** to review interruptions and
export reports, or **Statistics** to review availability over time.

In **Settings**, you can change the testing interval, sounds, theme, and **HTTPS ping URL**. Click
**Save settings** after making changes. If you choose a different URL, Firefox asks for permission to
contact that host. If the popup asks you to allow connectivity checks, click **Allow** to grant access.

## Understanding the results

| Status                 | Meaning                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Online                 | The selected HTTPS endpoint responded to the latest check.                                    |
| Connection issues      | The check failed, but Firefox still reports a network connection.                             |
| No Internet connection | The check failed and Firefox reports that you are offline.                                    |
| No data                | No measurement is available, for example while monitoring is paused or permission is missing. |

Lower response times mean the selected endpoint responded faster. A failed check can come from your
connection or the endpoint itself; it does not identify the cause of an outage.

Keep Firefox running to collect measurements. Time when monitoring cannot run, such as while Firefox
is closed or your computer is asleep, is treated as a monitoring gap rather than a confirmed outage.
No-data periods are excluded from availability calculations.

## Privacy

No account is needed. There are no ads, analytics, or telemetry, and the extension does not read your
browsing history or page contents. Settings and monitoring history stay in Firefox.

Connection checks contact Google by default, and public IP lookups contact ipify. If you set a custom
HTTPS ping URL, checks contact that host instead. These services receive your public IP and the
ordinary metadata sent with an HTTPS request. Monitoring history is not sent to the developer.

See the [privacy policy](PRIVACY.md) for details. Exported reports may contain your public IP address;
review them before sharing.

## Help and feedback

If monitoring shows **No data**, check that monitoring is enabled and any requested host permission
has been granted. If checks keep failing, confirm that your HTTPS ping URL is reachable.

[Report a problem or request a feature](https://github.com/SantanuDatta/Network-Speed-Monitor/issues).
For bug reports, include your Firefox version, extension version, and steps to reproduce the problem.
Remove public IP addresses and other private information from screenshots or reports before posting.

For building and contributing, see the [development guide](DEVELOPMENT.md).

## License

[GNU General Public License v3.0](LICENSE).
