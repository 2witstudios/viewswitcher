// The USB bridge against a fake usbmuxd on a temp socket: no iPad, and nothing touches the real
// /var/run/usbmuxd (where a live bridge may be running).
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bridgePorts, isMac } from "./gate";
import { type BridgeStatus, startUsbBridge } from "./usb-bridge";
import { concat, decodeOne, encodeMessage, u8 } from "./usbmux";

/** A usbmuxd that reports one iPad; its app accepts tunnels while `appOpen`. */
async function fakeUsbmuxd(socketPath: string) {
  const tunnels = new Set<net.Socket>();
  let listener: net.Socket | null = null;
  const fake = {
    appOpen: true,
    tunnels,
    attach: (productId?: number) => listener?.write(u8(encodeMessage({ MessageType: "Attached", DeviceID: 7, Properties: { ConnectionType: "USB", DeviceID: 7, ...(productId ? { ProductID: productId } : {}) } }))),
    detach: () => listener?.write(u8(encodeMessage({ MessageType: "Detached", DeviceID: 7 }))),
    /** The app quits: idle tunnels close and new ones are refused. */
    quitApp() {
      fake.appOpen = false;
      for (const t of tunnels) t.destroy();
    },
  };
  const server = net.createServer((sock) => {
    let buf: Buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = concat(buf, chunk);
      const one = decodeOne(buf);
      if (!one) return;
      sock.off("data", onData);
      const type = one.message.body.MessageType;
      if (type === "Listen") {
        listener = sock;
        sock.write(u8(encodeMessage({ MessageType: "Result", Number: 0 })));
      } else if (type === "Connect") {
        sock.write(u8(encodeMessage({ MessageType: "Result", Number: fake.appOpen ? 0 : 3 })));
        if (fake.appOpen) tunnels.add(sock);
        else sock.end();
      }
    };
    sock.on("data", onData);
    sock.on("close", () => tunnels.delete(sock));
    sock.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(socketPath, r));
  return { fake, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(10);
  }
};

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

describe("usb bridge status", () => {
  test("reports the iPad attached and the app connected, then each going away", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-usb-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const { fake, close } = await fakeUsbmuxd(join(dir, "usbmuxd"));
    cleanup.push(close);
    const seen: BridgeStatus[] = [];
    const bridge = startUsbBridge({ serverPort: 1, socketPath: join(dir, "usbmuxd"), log: () => {}, onStatus: (s) => seen.push(s) });
    cleanup.push(() => bridge.stop());
    const now = () => seen.at(-1) ?? { attached: false, connected: false };

    await Bun.sleep(50);
    expect(now()).toEqual({ attached: false, connected: false });
    fake.attach();
    await until(() => now().connected);
    expect(now()).toEqual({ attached: true, connected: true });
    await until(() => fake.tunnels.size === 4); // the idle pool

    fake.quitApp();
    await until(() => !now().connected);
    expect(now()).toEqual({ attached: true, connected: false });

    fake.appOpen = true; // the app comes back: the bridge's retry finds it
    await until(() => now().connected);

    fake.detach();
    await until(() => !now().attached);
    expect(now()).toEqual({ attached: false, connected: false });
  });

  test("names an iPhone plugged in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-usb-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const { fake, close } = await fakeUsbmuxd(join(dir, "usbmuxd"));
    cleanup.push(close);
    const seen: BridgeStatus[] = [];
    const bridge = startUsbBridge({ serverPort: 1, socketPath: join(dir, "usbmuxd"), log: () => {}, onStatus: (s) => seen.push(s) });
    cleanup.push(() => bridge.stop());
    await Bun.sleep(50);
    fake.attach(0x12a8);
    await until(() => seen.at(-1)?.connected === true);
    expect(seen.at(-1)).toEqual({ attached: true, connected: true, device: "iPhone" });
    fake.detach();
    await until(() => seen.at(-1)?.attached === false);
    expect(seen.at(-1)).toEqual({ attached: false, connected: false });
  });

  test("an iPad request on an idle tunnel reaches the server", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-usb-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const { fake, close } = await fakeUsbmuxd(join(dir, "usbmuxd"));
    cleanup.push(close);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("hello from the Mac") });
    cleanup.push(() => server.stop(true));
    const bridge = startUsbBridge({ serverPort: server.port!, socketPath: join(dir, "usbmuxd"), log: () => {} });
    cleanup.push(() => bridge.stop());
    await Bun.sleep(50);
    fake.attach();
    await until(() => fake.tunnels.size > 0);
    const tunnel = [...fake.tunnels][0]!;
    let reply = "";
    tunnel.on("data", (c) => (reply += c.toString()));
    tunnel.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    await until(() => reply.includes("hello from the Mac"));
  });
  test("the server tells the iPad's requests from this Mac's (gate.ts isMac): /mcp and /api/info stay this Mac's only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-usb-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const { fake, close } = await fakeUsbmuxd(join(dir, "usbmuxd"));
    cleanup.push(close);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (req, srv) => new Response(isMac(srv.requestIP(req), req.headers) ? "this Mac" : "not this Mac") });
    cleanup.push(() => server.stop(true));
    const bridge = startUsbBridge({ serverPort: server.port!, socketPath: join(dir, "usbmuxd"), log: () => {} });
    cleanup.push(() => bridge.stop());
    await Bun.sleep(50);
    fake.attach();
    await until(() => fake.tunnels.size > 0);
    const tunnel = [...fake.tunnels][0]!;
    let reply = "";
    tunnel.on("data", (c) => (reply += c.toString()));
    // What the iPad's WebView sends: Host 127.0.0.1, no proxy headers.
    tunnel.write(`GET /mcp HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nConnection: close\r\n\r\n`);
    await until(() => /this Mac/.test(reply));
    expect(reply).toContain("not this Mac");
    // The Mac's own request still is.
    expect(await (await fetch(`http://127.0.0.1:${server.port}/mcp`)).text()).toBe("this Mac");
    // A closed tunnel's port is forgotten (the OS may give it to a local client next).
    await until(() => bridgePorts.size === 0);
  });
});
