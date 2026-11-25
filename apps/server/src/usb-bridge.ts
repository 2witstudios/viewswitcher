// USB-C link to the ViewSwitcher app on an iPhone or iPad.
//
// iOS gives apps no network over the cable; the only path is usbmuxd, and it only connects
// Mac → iPad. So this keeps a few idle tunnels open to the app's listener (iPad port 7421).
// When the iPad's WebView makes a request, the app hands it an idle tunnel; the first bytes
// arrive here, and we pipe that tunnel to the ViewSwitcher server and open a replacement.
// One tunnel per HTTP connection or WebSocket, so there is no multiplexing protocol.
import { existsSync } from "node:fs";
import net from "node:net";
import { bridgePorts } from "./gate";
import type { UsbDevice } from "@viewswitcher/shared";
import { concat, connectMessage, decodeMessages, decodeOne, deviceKind, listenMessage, resultNumber, u8, USBMUXD_SOCKET } from "./usbmux";

const POOL = 4;
const RETRY_MS = 1000;

/** What the bridge sees: an iPhone or iPad plugged in (which, PHONE-8), and the ViewSwitcher app on it with tunnels ready. */
export type BridgeStatus = { attached: boolean; connected: boolean; device?: UsbDevice };

type Options = {
  serverPort: number;
  devicePort?: number;
  log?: (msg: string) => void;
  /** Called whenever attached/connected changes (for LiveState.usb). */
  onStatus?: (status: BridgeStatus) => void;
  /** usbmuxd's socket; a fake one in tests. */
  socketPath?: string;
};

export function usbAvailable() {
  return process.platform === "darwin" && existsSync(USBMUXD_SOCKET);
}

export function startUsbBridge({ serverPort, devicePort = 7421, log = (m) => console.log(`[usb] ${m}`), onStatus, socketPath = USBMUXD_SOCKET }: Options) {
  const devices = new Map<number, { stop: () => void; ready: () => boolean | null; kind?: UsbDevice }>();
  let last: BridgeStatus = { attached: false, connected: false };
  const report = () => {
    const all = [...devices.values()];
    // The device to name: the one whose app is connected, else the first plugged in.
    const named = all.find((d) => d.ready() === true) ?? all[0];
    const now: BridgeStatus = { attached: all.length > 0, connected: all.some((d) => d.ready() === true), ...(named?.kind ? { device: named.kind } : {}) };
    if (now.attached === last.attached && now.connected === last.connected && now.device === last.device) return;
    last = now;
    onStatus?.(now);
  };
  let listener: net.Socket | null = null;
  let stopped = false;

  function listen() {
    if (stopped) return;
    let buf: Buffer = Buffer.alloc(0);
    const sock = net.createConnection(socketPath);
    listener = sock;
    sock.on("connect", () => sock.write(u8(listenMessage())));
    // @types/node types a socket's chunk as string | Buffer (a string only after setEncoding, which we never call).
    sock.on("data", (chunk: string | Buffer) => {
      buf = concat(buf, typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      const { messages, rest } = decodeMessages(buf);
      buf = rest;
      for (const { body } of messages) {
        const id = Number(body.DeviceID);
        const props = (body.Properties ?? {}) as Record<string, unknown>;
        if (body.MessageType === "Attached" && props.ConnectionType === "USB" && !devices.has(id)) {
          log(`device ${id} attached over USB`);
          const kind = deviceKind(props.ProductID);
          devices.set(id, { ...device(id), ...(kind ? { kind } : {}) });
          report();
        } else if (body.MessageType === "Detached" && devices.has(id)) {
          log(`device ${id} detached`);
          devices.get(id)!.stop();
          devices.delete(id);
          report();
        }
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => {
      for (const d of devices.values()) d.stop();
      devices.clear();
      report();
      if (!stopped) setTimeout(listen, 2000);
    });
  }

  function device(id: number) {
    let idle = 0; // connected tunnels waiting for a request
    let opening = 0;
    let alive = true;
    let ready: boolean | null = null; // null = unknown yet
    const sockets = new Set<net.Socket>();
    let retry: ReturnType<typeof setTimeout> | undefined;

    const setReady = (r: boolean) => {
      if (ready === r) return;
      ready = r;
      queueMicrotask(report); // (on the first tunnel, before devices.set has run)
      log(r ? `device ${id}: ViewSwitcher connected, tunnels ready` : `device ${id}: waiting for ViewSwitcher to open`);
    };

    const fill = () => {
      while (alive && idle + opening < POOL) open();
    };
    const fillLater = () => {
      if (!alive || retry) return;
      retry = setTimeout(() => {
        retry = undefined;
        fill();
      }, RETRY_MS);
    };

    function open() {
      opening++;
      let state: "connecting" | "idle" | "piped" | "dead" = "connecting";
      let buf: Buffer = Buffer.alloc(0);
      const tunnel = net.createConnection(socketPath);
      sockets.add(tunnel);
      tunnel.setNoDelay(true);

      const onData = (chunk: Buffer) => {
        if (state === "connecting") {
          buf = concat(buf, chunk);
          const one = decodeOne(buf);
          if (!one) return;
          opening--;
          if (resultNumber(one.message.body) !== 0) {
            state = "dead";
            setReady(false);
            tunnel.destroy();
            fillLater();
            return;
          }
          state = "idle";
          idle++;
          setReady(true);
          if (one.rest.length) activate(one.rest);
          return;
        }
        if (state === "idle") activate(chunk);
      };

      // The iPad sent a request on this tunnel: pipe it to the server.
      function activate(first: Buffer) {
        state = "piped";
        idle--;
        tunnel.off("data", onData);
        tunnel.pause();
        const upstream = net.createConnection({ host: "127.0.0.1", port: serverPort });
        upstream.setNoDelay(true);
        sockets.add(upstream);
        let marked: number | undefined;
        // The server must know this connection is the iPad's (gate.ts bridgePorts) before it reads a byte of it,
        // so nothing is sent until its local port is marked.
        upstream.once("connect", () => {
          marked = upstream.localPort;
          if (marked !== undefined) bridgePorts.add(marked);
          upstream.write(u8(first));
          tunnel.pipe(upstream);
          upstream.pipe(tunnel);
        });
        const end = () => {
          tunnel.destroy();
          upstream.destroy();
          sockets.delete(upstream);
          if (marked !== undefined) bridgePorts.delete(marked);
          marked = undefined;
        };
        upstream.on("error", end);
        upstream.on("close", end);
        fill();
      }

      tunnel.on("connect", () => tunnel.write(u8(connectMessage(id, devicePort))));
      tunnel.on("data", onData);
      tunnel.on("error", () => {});
      tunnel.on("close", () => {
        sockets.delete(tunnel);
        if (state === "connecting") {
          opening--;
          fillLater();
        } else if (state === "idle") {
          // The app closed an idle tunnel (backgrounded or quit).
          idle--;
          fillLater();
        }
        state = "dead";
      });
    }

    fill();
    return {
      ready: () => ready,
      stop() {
        alive = false;
        clearTimeout(retry);
        for (const s of sockets) s.destroy();
      },
    };
  }

  listen();
  return {
    stop() {
      stopped = true;
      listener?.destroy();
      for (const d of devices.values()) d.stop();
    },
  };
}
