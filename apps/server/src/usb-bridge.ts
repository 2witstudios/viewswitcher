// USB-C link to the ViewSwitcher iPad app.
//
// iOS gives apps no network over the cable; the only path is usbmuxd, and it only connects
// Mac → iPad. So this keeps a few idle tunnels open to the app's listener (iPad port 7421).
// When the iPad's WebView makes a request, the app hands it an idle tunnel; the first bytes
// arrive here, and we pipe that tunnel to the ViewSwitcher server and open a replacement.
// One tunnel per HTTP connection or WebSocket, so there is no multiplexing protocol.
import { existsSync } from "node:fs";
import net from "node:net";
import { concat, connectMessage, decodeMessages, decodeOne, listenMessage, resultNumber, u8, USBMUXD_SOCKET } from "./usbmux";

const POOL = 4;
const RETRY_MS = 1000;

type Options = { serverPort: number; devicePort?: number; log?: (msg: string) => void };

export function usbAvailable() {
  return process.platform === "darwin" && existsSync(USBMUXD_SOCKET);
}

export function startUsbBridge({ serverPort, devicePort = 7421, log = (m) => console.log(`[usb] ${m}`) }: Options) {
  const devices = new Map<number, { stop: () => void }>();
  let listener: net.Socket | null = null;
  let stopped = false;

  function listen() {
    if (stopped) return;
    let buf: Buffer = Buffer.alloc(0);
    const sock = net.createConnection(USBMUXD_SOCKET);
    listener = sock;
    sock.on("connect", () => sock.write(u8(listenMessage())));
    sock.on("data", (chunk) => {
      buf = concat(buf, chunk);
      const { messages, rest } = decodeMessages(buf);
      buf = rest;
      for (const { body } of messages) {
        const id = Number(body.DeviceID);
        const props = (body.Properties ?? {}) as Record<string, unknown>;
        if (body.MessageType === "Attached" && props.ConnectionType === "USB" && !devices.has(id)) {
          log(`device ${id} attached over USB`);
          devices.set(id, device(id));
        } else if (body.MessageType === "Detached" && devices.has(id)) {
          log(`device ${id} detached`);
          devices.get(id)!.stop();
          devices.delete(id);
        }
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => {
      for (const d of devices.values()) d.stop();
      devices.clear();
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
      const tunnel = net.createConnection(USBMUXD_SOCKET);
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
        upstream.write(u8(first));
        tunnel.pipe(upstream);
        upstream.pipe(tunnel);
        const end = () => {
          tunnel.destroy();
          upstream.destroy();
          sockets.delete(upstream);
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
