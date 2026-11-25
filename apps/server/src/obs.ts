// Minimal obs-websocket v5 client (built into OBS 28+). No dependencies.
import { createHash } from "node:crypto";
import type { ObsStatus } from "@viewswitcher/shared";

const sha256b64 = (s: string) => createHash("sha256").update(s).digest("base64");

// EventSubscription bitflags: General | Config | Scenes | Inputs | Outputs | SceneItems.
// Config brings scene-collection and profile changes, after which every cached scene item id is stale.
const EVENTS = 1 | 2 | 4 | 8 | 64 | 128;

/** obs-websocket's close code when the password is wrong (WebSocketCloseCode::AuthenticationFailed). */
export const CLOSE_AUTH_FAILED = 4009;
/** How long to wait before trying OBS again after it closed or couldn't be reached. */
const RETRY_MS = 3000;
/**
 * The longest any request may wait for OBS. An OBS that keeps its socket open but never answers would
 * otherwise hold its caller for the rest of the show.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

export class OBSRequestError extends Error {
  constructor(readonly requestType: string, readonly code: number, comment?: string) {
    super(`${requestType}: ${comment ?? `error ${code}`}`);
  }
}

/** One request of a batch, and its answer (obs-websocket v5 RequestBatch, op 8 and 9). */
export type BatchRequest = { requestType: string; requestData?: object };
export type BatchResult = { requestType: string; requestStatus: { result: boolean; code: number; comment?: string }; responseData?: any };

type Options = {
  url: string;
  /** Read again on every connect, so a password set or changed in OBS after start is picked up. */
  password?: string | (() => string | undefined);
  onStatus?: (s: ObsStatus) => void;
  onIdentified?: () => void;
  /** Every OBS event (op 5), e.g. to notice sources being added or removed. */
  onEvent?: (eventType: string, eventData: Record<string, unknown>) => void;
  log?: boolean;
  /** For requests that don't pass their own timeoutMs. */
  defaultTimeoutMs?: number;
  /** Tests only: the wait before reconnecting. */
  retryMs?: number;
};

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; type: string };

export class OBSClient {
  status: ObsStatus = { connected: false, recording: false, streaming: false };
  /**
   * Whether OBS has answered, since it connected, whether it's streaming and recording. Until then
   * status says false for both, which only means "not known yet" (the agents' guard treats it as live).
   */
  outputsKnown = false;
  private ws?: WebSocket;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private stopped = false;
  private waiters: (() => void)[] = [];
  private retry?: ReturnType<typeof setTimeout>;
  /** The password this connection identifies with: read when it opened. */
  private password?: string;
  /** Why the last connection ended, when OBS turned us away. */
  private refused?: ObsStatus["auth"];

  constructor(private opts: Options) {}

  start() {
    this.stopped = false;
    this.connect();
    return this;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retry);
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

  /** A request OBS hasn't answered within `timeoutMs` (default: defaultTimeoutMs) is rejected and forgotten; a late answer is ignored. */
  request<T = any>(requestType: string, requestData?: object, { timeoutMs }: { timeoutMs?: number } = {}): Promise<T> {
    return this.send(requestType, timeoutMs, (requestId) => ({ op: 6, d: { requestType, requestId, requestData } }));
  }

  /**
   * Several requests in one message, run by OBS in order (SerialRealtime): one round trip instead of
   * one per request. Resolves with every request's own result, failed ones included; rejects only when
   * the batch as a whole gets no answer (a timeout, a disconnect).
   */
  requestBatch(requests: BatchRequest[], { timeoutMs, haltOnFailure = false }: { timeoutMs?: number; haltOnFailure?: boolean } = {}): Promise<BatchResult[]> {
    if (!requests.length) return Promise.resolve([]);
    return this.send("RequestBatch", timeoutMs, (requestId) => ({ op: 8, d: { requestId, haltOnFailure, executionType: 0, requests } }));
  }

  private send<T>(type: string, timeoutMs: number | undefined, message: (requestId: string) => object): Promise<T> {
    const ws = this.ws;
    if (!ws || !this.status.connected) return Promise.reject(new Error("OBS not connected"));
    const requestId = String(++this.seq);
    const ms = timeoutMs ?? this.opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        reject(new Error(`OBS didn't answer ${type} within ${ms / 1000} s`));
      }, ms);
      const done = <A>(f: (a: A) => void) => (a: A) => {
        clearTimeout(timer);
        f(a);
      };
      this.pending.set(requestId, { resolve: done(resolve), reject: done(reject), type });
      ws.send(JSON.stringify(message(requestId)));
    });
  }

  private connect() {
    const p = this.opts.password;
    this.password = typeof p === "function" ? p() : p;
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    ws.onmessage = (e) => this.handle(ws, JSON.parse(String(e.data)));
    ws.onerror = () => {};
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = undefined;
      this.outputsKnown = false;
      for (const p of this.pending.values()) p.reject(new Error("OBS disconnected"));
      this.pending.clear();
      if (this.status.connected && this.opts.log) console.log("[obs] disconnected");
      if (e.code === CLOSE_AUTH_FAILED) {
        if (this.status.auth !== "wrong" && this.opts.log) console.error("[obs] OBS refused the password. Check Tools → WebSocket Server Settings in OBS.");
        this.refused = "wrong";
      }
      const auth = this.refused;
      this.refused = undefined;
      this.update({ connected: false, auth });
      if (!this.stopped) this.retry = setTimeout(() => this.connect(), this.opts.retryMs ?? RETRY_MS);
    };
  }

  private handle(ws: WebSocket, msg: { op: number; d: any }) {
    if (this.ws !== ws) return;
    switch (msg.op) {
      case 0: {
        const auth = msg.d.authentication;
        let authentication: string | undefined;
        if (auth) {
          if (!this.password) {
            // Close and try again later: the password may be turned off, or set where we read it, meanwhile.
            if (this.status.auth !== "missing" && this.opts.log) console.error("[obs] OBS asks for a password: set OBS_PASSWORD, or turn off authentication in OBS");
            this.refused = "missing";
            ws.close();
            return;
          }
          authentication = sha256b64(sha256b64(this.password + auth.salt) + auth.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, authentication, eventSubscriptions: EVENTS } }));
        return;
      }
      case 2:
        if (this.opts.log) console.log("[obs] connected");
        this.outputsKnown = false;
        this.update({ connected: true, auth: undefined }); // published now, not only once refresh() has answered
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
        const p = this.take(msg.d.requestId);
        if (!p) return;
        const st = msg.d.requestStatus;
        if (st.result) p.resolve(msg.d.responseData ?? {});
        else p.reject(new OBSRequestError(p.type, st.code, st.comment));
        return;
      }
      case 9: {
        const p = this.take(msg.d.requestId);
        if (p) p.resolve((msg.d.results ?? []) as BatchResult[]);
        return;
      }
    }
  }

  private take(requestId: string) {
    const p = this.pending.get(requestId);
    if (p) this.pending.delete(requestId);
    return p;
  }

  private async refresh() {
    try {
      const [rec, stream] = await Promise.all([this.request("GetRecordStatus"), this.request("GetStreamStatus")]);
      this.outputsKnown = true;
      this.update({ recording: !!rec.outputActive, streaming: !!stream.outputActive });
    } catch {}
  }

  private update(patch: Partial<ObsStatus>) {
    const next = { ...this.status, ...patch };
    if (next.auth === undefined) delete next.auth;
    this.status = next;
    this.opts.onStatus?.(this.status);
  }
}
