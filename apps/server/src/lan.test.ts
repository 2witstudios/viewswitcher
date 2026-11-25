import { expect, test } from "bun:test";
import { lanAddresses } from "./lan";

test("LAN addresses: IPv4, not loopback or link-local", () => {
  const i = (address: string, family = "IPv4", internal = false) => ({ address, family, internal, netmask: "", mac: "", cidr: null }) as any;
  expect(lanAddresses({ lo0: [i("127.0.0.1", "IPv4", true), i("::1", "IPv6", true)], en0: [i("192.168.1.68"), i("fe80::1", "IPv6")], en5: [i("169.254.3.4")], utun4: [i("100.101.1.2")] })).toEqual(["192.168.1.68", "100.101.1.2"]);
});
