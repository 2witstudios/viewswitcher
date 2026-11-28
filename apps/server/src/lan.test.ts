import { expect, test } from "bun:test";
import { lanAddresses, localNameFrom, pairingOrder, vpn, vpnAddresses } from "./lan";

test("LAN addresses: IPv4, not loopback or link-local", () => {
  const i = (address: string, family = "IPv4", internal = false) => ({ address, family, internal, netmask: "", mac: "", cidr: null }) as any;
  expect(lanAddresses({ lo0: [i("127.0.0.1", "IPv4", true), i("::1", "IPv6", true)], en0: [i("192.168.1.68"), i("fe80::1", "IPv6")], en5: [i("169.254.3.4")], utun4: [i("100.101.1.2")] })).toEqual(["192.168.1.68", "100.101.1.2"]);
});

test("VPN interfaces last: a Wi-Fi 100.64/10 address comes before Tailscale's", () => {
  const i = (address: string) => ({ address, family: "IPv4", internal: false, netmask: "", mac: "", cidr: null }) as any;
  expect(lanAddresses({ utun4: [i("100.101.1.2")], en0: [i("100.80.7.9")], ipsec0: [i("10.8.0.2")] })).toEqual(["100.80.7.9", "100.101.1.2", "10.8.0.2"]);
});

test("the QR code's order: local Wi-Fi ranges, then other Wi-Fi, then any VPN address", () => {
  // A campus network with a public address and Tailscale: the Wi-Fi address, never the tailnet one.
  expect(pairingOrder(["141.20.1.5", "100.101.1.2"], ["100.101.1.2"])).toEqual(["141.20.1.5", "100.101.1.2"]);
  // A hotspot (CGNAT) beside a corporate IPsec 10.x.
  expect(pairingOrder(["10.8.0.2", "100.80.7.9"], ["10.8.0.2"])).toEqual(["100.80.7.9", "10.8.0.2"]);
  // Home Wi-Fi first; a second public interface after it.
  expect(pairingOrder(["8.8.4.4", "192.168.1.68"], [])).toEqual(["192.168.1.68", "8.8.4.4"]);
});

test("VPN addresses come from utun, ipsec and ppp interfaces", () => {
  const i = (address: string) => ({ address, family: "IPv4", internal: false, netmask: "", mac: "", cidr: null }) as any;
  expect(vpnAddresses({ en0: [i("192.168.1.68")], utun4: [i("100.101.1.2")], ipsec0: [i("10.8.0.2")], ppp0: [i("10.9.0.1")] })).toEqual(["100.101.1.2", "10.8.0.2", "10.9.0.1"]);
});

test("Windows adapters by name: Tailscale and the virtual switches of WSL and VMs never come first", () => {
  const i = (address: string) => ({ address, family: "IPv4", internal: false, netmask: "", mac: "", cidr: null }) as any;
  // As this PC lists them: Tailscale first, then Wi-Fi.
  const ifaces = { Tailscale: [i("100.65.202.51")], "vEthernet (WSL (Hyper-V firewall))": [i("172.24.16.1")], "Wi-Fi": [i("192.168.4.32")], "Ethernet 2": [i("10.0.0.7")] };
  expect(lanAddresses(ifaces)).toEqual(["192.168.4.32", "10.0.0.7", "100.65.202.51", "172.24.16.1"]);
  expect(vpnAddresses(ifaces)).toEqual(["100.65.202.51", "172.24.16.1"]);
  expect(pairingOrder(lanAddresses(ifaces), vpnAddresses(ifaces))[0]).toBe("192.168.4.32");
  for (const name of ["Tailscale", "ZeroTier One [abc]", "WireGuard Tunnel", "OpenVPN TAP-Windows6", "vEthernet (Default Switch)", "VMware Network Adapter VMnet8", "VirtualBox Host-Only Network"]) expect(vpn(name)).toBe(true);
  for (const name of ["Wi-Fi", "Ethernet", "Ethernet 2", "en0"]) expect(vpn(name)).toBe(false);
});

test("a .local name from the computer's own name, when it can be one", () => {
  expect(localNameFrom("DESKTOP-OPRO3MQ")).toBe("desktop-opro3mq.local");
  expect(localNameFrom("Sam's PC")).toBeNull();
});
