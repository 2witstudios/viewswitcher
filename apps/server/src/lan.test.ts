import { expect, test } from "bun:test";
import { lanAddresses } from "./lan";

test("LAN addresses: IPv4, not loopback or link-local", () => {
  const i = (address: string, family = "IPv4", internal = false) => ({ address, family, internal, netmask: "", mac: "", cidr: null }) as any;
  expect(lanAddresses({ lo0: [i("127.0.0.1", "IPv4", true), i("::1", "IPv6", true)], en0: [i("192.168.1.68"), i("fe80::1", "IPv6")], en5: [i("169.254.3.4")], utun4: [i("100.101.1.2")] })).toEqual(["192.168.1.68", "100.101.1.2"]);
});

test("VPN interfaces last: a Wi-Fi 100.64/10 address comes before Tailscale's (PHONE-4)", () => {
  const i = (address: string) => ({ address, family: "IPv4", internal: false, netmask: "", mac: "", cidr: null }) as any;
  expect(lanAddresses({ utun4: [i("100.101.1.2")], en0: [i("100.80.7.9")], ipsec0: [i("10.8.0.2")] })).toEqual(["100.80.7.9", "100.101.1.2", "10.8.0.2"]);
});
