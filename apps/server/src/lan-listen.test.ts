import { describe, expect, test } from "bun:test";
import { lanListeners } from "./lan-listen";

/** A pretend Bun server per hostname, recording what was published to it and whether it was stopped. */
function fakes(fail: string[] = []) {
  const made: { hostname: string; stopped: boolean; published: string[]; stop: () => void; publish: (t: string, m: string) => void }[] = [];
  const serve = (hostname: string) => {
    if (fail.includes(hostname)) throw new Error(`Failed to start server. Is port 7420 in use?`);
    const s = { hostname, stopped: false, published: [] as string[], stop() { s.stopped = true; }, publish(_t: string, m: string) { s.published.push(m); } };
    made.push(s);
    return s as any;
  };
  return { made, serve };
}

describe("the Wi-Fi listener", () => {
  test("macOS: one listener on every address", () => {
    const f = fakes();
    const lan = lanListeners({ host: "0.0.0.0", addresses: () => ["192.168.1.5"], serve: f.serve, perAddress: false, log: () => {} });
    expect(lan.start()).toBeNull();
    expect(f.made.map((s) => s.hostname)).toEqual(["0.0.0.0"]);
    expect(lan.on).toBe(true);
    expect(lan.has(f.made[0])).toBe(true);
    expect(lan.has({})).toBe(false);
    lan.stop();
    expect(f.made[0]!.stopped).toBe(true);
    expect(lan.on).toBe(false);
  });

  test("Windows: one on each address, published to all, following the addresses as they change", async () => {
    const f = fakes();
    let addresses = ["192.168.4.32", "100.65.202.51"];
    const lan = lanListeners({ host: "0.0.0.0", addresses: () => addresses, serve: f.serve, perAddress: true, everyMs: 20, log: () => {} });
    expect(lan.start()).toBeNull();
    expect(f.made.map((s) => s.hostname)).toEqual(["192.168.4.32", "100.65.202.51"]);
    lan.publish("all", "hello");
    expect(f.made.every((s) => s.published.includes("hello"))).toBe(true);
    // A new Wi-Fi network: its address is listened on, the old one closed.
    addresses = ["10.0.0.9", "100.65.202.51"];
    await Bun.sleep(80);
    expect(f.made.find((s) => s.hostname === "192.168.4.32")!.stopped).toBe(true);
    expect(lan.servers.map((s) => (s as any).hostname).sort()).toEqual(["10.0.0.9", "100.65.202.51"]);
    lan.stop();
    expect(f.made.every((s) => s.stopped)).toBe(true);
    // Stopped: no more following.
    addresses = ["172.16.0.2"];
    await Bun.sleep(60);
    expect(f.made.some((s) => s.hostname === "172.16.0.2")).toBe(false);
  });

  test("an address that can't be listened on is skipped; none at all says why", () => {
    const some = fakes(["100.65.202.51"]);
    const lan = lanListeners({ host: "0.0.0.0", addresses: () => ["192.168.4.32", "100.65.202.51"], serve: some.serve, perAddress: true, log: () => {} });
    expect(lan.start()).toBeNull();
    expect(lan.servers.length).toBe(1);
    lan.stop();
    const none = fakes(["0.0.0.0"]);
    const off = lanListeners({ host: "0.0.0.0", addresses: () => [], serve: none.serve, perAddress: false, log: () => {} });
    expect(off.start()).toContain("Is port 7420 in use?");
    expect(off.on).toBe(false);
    const noWifi = lanListeners({ host: "0.0.0.0", addresses: () => [], serve: fakes().serve, perAddress: true, log: () => {} });
    expect(noWifi.start()).toContain("no network address");
  });

  test("a set address (VIEWSWITCHER_LAN_HOST, the tests') is used as it is, on every platform", () => {
    const f = fakes();
    const lan = lanListeners({ host: "192.168.4.32", addresses: () => ["10.0.0.1"], serve: f.serve, perAddress: true, log: () => {} });
    lan.start();
    expect(f.made.map((s) => s.hostname)).toEqual(["192.168.4.32"]);
    lan.stop();
  });
});
