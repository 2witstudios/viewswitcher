// Minimal obs-websocket v5 client (built into OBS 28+). No dependencies.
import { createHash } from "node:crypto";
import type { ObsStatus } from "@viewswitcher/shared";

const sha256b64 = (s: string) => createHash("sha256").update(s).digest("base64");

// EventSubscription bitflags: General | Scenes | Inputs | Outputs | SceneItems
const EVENTS = 1 | 4 | 8 | 64 | 128;

export class OBSRequestError extends Error {
  constructor(readonly requestType: string, readonly code: number, comment?: string) {
    super(`${requestType}: ${comment ?? `error ${code}`}`);
  }
}

type Options = {
  url: string;
  password?: string;
  onStatus?: (s: ObsStatus) => void;
  onIdentified?: () => void;
  /** Every OBS event (op 5), e.g. to notice sources being added or removed. */
  onEvent?: (eventType: string, eventData: Record<string, unknown>) => void;
  log?: boolean;
};

export class OBSClient {
  status: ObsStatus = { connected: false, recording: false, streaming: false };
  /**
   * Whether OBS has answered, since it connected, whether it's streaming and recording. Until then
   * status says false for both, which only means "not known yet" (the agents' guard treats it as live).
   */
  outputsKnown = false;
  private ws?: WebSocket;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; type: string }>();
  private seq = 0;
  private stopped = false;
  private waiters: (() => void)[] = [];

  constructor(private opts: Options) {}

  start() {
    this.stopped = false;
    this.connect();
    return this;
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  /** Resolves once identified (or immediately if already connected). */
  ready(timeoutMs = 5000): Promise<void> {
    if (this.status.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Could not reach OBS at ${this.opts.url}. Is OBS open with its WebSocket server on?`)), timeoutMs);
      this.waiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  /** Requests waiting for OBS's answer. */
  get pendingCount() {
    return this.pending.size;
  }

  /** With `timeoutMs`, a request OBS hasn't answered by then is rejected and forgotten (a late answer is ignored). */
  request<T = any>(requestType: string, requestData?: object, { timeoutMs }: { timeoutMs?: number } = {}): Promise<T> {
    const ws = this.ws;
    if (!ws || !this.status.connected) return Promise.reject(new Error("OBS not connected"));
    const requestId = String(++this.seq);
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = <A>(f: (a: A) => void) => (a: A) => {
        clearTimeout(timer);
        f(a);
      };
      this.pending.set(requestId, { resolve: done(resolve), reject: done(reject), type: requestType });
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          if (!this.pending.delete(requestId)) return;
          reject(new Error(`OBS didn't answer ${requestType} within ${timeoutMs / 1000} s`));
        }, timeoutMs);
      }
      ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  private connect() {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)));
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.outputsKnown = false;
      for (const p of this.pending.values()) p.reject(new Error("OBS disconnected"));
      this.pending.clear();
      if (this.status.connected && this.opts.log) console.log("[obs] disconnected");
      this.update({ connected: false });
      if (!this.stopped) setTimeout(() => this.connect(), 3000);
    };
  }

  private handle(msg: { op: number; d: any }) {
    switch (msg.op) {
      case 0: {
        const auth = msg.d.authentication;
        let authentication: string | undefined;
        if (auth) {
          if (!this.opts.password) {
            console.error("[obs] OBS requires a password: set OBS_PASSWORD");
            return;
          }
          authentication = sha256b64(sha256b64(this.opts.password + auth.salt) + auth.challenge);
        }
        this.ws?.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication, eventSubscriptions: EVENTS } }));
        return;
      }
      case 2:
        if (this.opts.log) console.log("[obs] connected");
        this.outputsKnown = false;
        this.update({ connected: true }); // published now, not only once refresh() has answered
        for (const w of this.waiters.splice(0)) w();
        this.refresh();
        this.opts.onIdentified?.();
        return;
      case 5:
        if (msg.d.eventType === "RecordStateChanged") this.update({ recording: !!msg.d.eventData?.outputActive });
        if (msg.d.eventType === "StreamStateChanged") this.update({ streaming: !!msg.d.eventData?.outputActive });
        this.opts.onEvent?.(msg.d.eventType, msg.d.eventData ?? {});
        return;
      case 7: {
        const p = this.pending.get(msg.d.requestId);
        if (!p) return;
        this.pending.delete(msg.d.requestId);
        const st = msg.d.requestStatus;
        if (st.result) p.resolve(msg.d.responseData ?? {});
        else p.reject(new OBSRequestError(p.type, st.code, st.comment));
        return;
      }
    }
  }

  private async refresh() {
    try {
      const [rec, stream] = await Promise.all([this.request("GetRecordStatus"), this.request("GetStreamStatus")]);
      this.outputsKnown = true;
      this.update({ recording: !!rec.outputActive, streaming: !!stream.outputActive });
    } catch {}
  }

  private update(patch: Partial<ObsStatus>) {
    this.status = { ...this.status, ...patch };
    this.opts.onStatus?.(this.status);
  }
}
