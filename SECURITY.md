# Security

## Reporting a vulnerability

Please report it privately: open this repository's **Security** tab and choose **Report a vulnerability**. Please don't put the details in a public issue. If that button isn't there, open an issue that only asks for a private contact, and we'll reply with one. Say whether you'd like credit in the release notes.

## What ViewSwitcher protects

ViewSwitcher runs a server on your Mac (port 7420) that the switcher, OBS's browser source, the iPhone and iPad app and AI agents talk to. Its rules:

- **Only this Mac by default.** The server listens on loopback. A request counts as "this Mac" only with a loopback peer, a loopback Host and no proxy headers, so DNS rebinding and forwarded requests don't get in.
- **Phones and tablets pair first.** With "Let Phones and Tablets on This Wi-Fi Connect" on, a device needs a one-time code from the Mac app; it then holds a revocable token (only its hash is stored). Wi-Fi traffic is plain HTTP, so use it on networks you trust. The USB-C iPhone or iPad connects through usbmuxd.
- **Websites can't drive it.** Changes sent by a website on the internet are refused (their Origin isn't the switcher's), and sandboxed pages (`Origin: null`) are refused too.
- **Scenes are untrusted code.** Views come from AI agents and template packs from anyone, so every `/library/` page is served in a CSP sandbox and every scene frame is sandboxed: scene scripts run with an opaque origin and can't call the switcher's API. Template packs are checked before they install (no links, no paths outside the set, size and CRC limits).
- **Agents connect only on this Mac.** `/mcp` and the responses that carry file paths answer only this Mac. The agent on-air setting limits what MCP tools may do; it isn't a boundary against software that already has access to your files.

Out of scope: anything that already runs as your user on the Mac (it can read the library directly), and OBS's own WebSocket server.
