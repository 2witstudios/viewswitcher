import { describe, expect, test } from "bun:test";
import { concat, connectMessage, decodeMessages, decodeOne, deviceKind, encodeMessage, parsePlist, resultNumber, swapPort } from "./usbmux";

describe("usbmux", () => {
  test("port is sent in network byte order", () => {
    expect(swapPort(7421)).toBe(0xfd1c); // 7421 = 0x1cfd
    expect(swapPort(swapPort(62078))).toBe(62078);
  });

  test("header is little-endian {length, version 1, type 8, tag}", () => {
    const m = encodeMessage({ MessageType: "Listen" }, 7);
    expect(m.readUInt32LE(0)).toBe(m.length);
    expect(m.readUInt32LE(4)).toBe(1);
    expect(m.readUInt32LE(8)).toBe(8);
    expect(m.readUInt32LE(12)).toBe(7);
  });

  test("connect message round-trips", () => {
    const one = decodeOne(connectMessage(5, 7421))!;
    expect(one.message.body).toMatchObject({ MessageType: "Connect", DeviceID: 5, PortNumber: swapPort(7421) });
    expect(one.rest.length).toBe(0);
  });

  test("raw bytes after a Result are kept", () => {
    const buf = concat(encodeMessage({ MessageType: "Result", Number: 0 }), Buffer.from("GET / HTTP/1.1"));
    const one = decodeOne(buf)!;
    expect(resultNumber(one.message.body)).toBe(0);
    expect(one.rest.toString()).toBe("GET / HTTP/1.1");
  });

  test("decodes several messages and keeps a partial one", () => {
    const a = encodeMessage({ MessageType: "Result", Number: 0 });
    const b = encodeMessage({ MessageType: "Attached", DeviceID: 3, Properties: { ConnectionType: "USB", ProductID: 4776 } });
    const { messages, rest } = decodeMessages(concat(a, b, b.subarray(0, 10)));
    expect(messages.map((m) => m.body.MessageType)).toEqual(["Result", "Attached"]);
    expect(messages[1]!.body).toMatchObject({ DeviceID: 3, Properties: { ConnectionType: "USB" } });
    expect(rest.length).toBe(10);
  });

  test("parses a real usbmuxd Attached plist", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>DeviceID</key>
	<integer>12</integer>
	<key>MessageType</key>
	<string>Attached</string>
	<key>Properties</key>
	<dict>
		<key>ConnectionSpeed</key>
		<integer>480000000</integer>
		<key>ConnectionType</key>
		<string>USB</string>
		<key>EscapedFullServiceName</key>
		<string>a &amp; b</string>
		<key>USBSerialNumber</key>
		<data>AAEC</data>
		<key>Flag</key>
		<true/>
		<key>List</key>
		<array><integer>1</integer><string>x</string></array>
	</dict>
</dict>
</plist>`;
    expect(parsePlist(xml)).toEqual({
      DeviceID: 12,
      MessageType: "Attached",
      Properties: { ConnectionSpeed: 480000000, ConnectionType: "USB", EscapedFullServiceName: "a & b", USBSerialNumber: new Uint8Array([0, 1, 2]), Flag: true, List: [1, "x"] },
    });
  });

  test("names the device from its product id", () => {
    expect(deviceKind(0x12a8)).toBe("iPhone");
    expect(deviceKind(4779)).toBe("iPad");
    expect(deviceKind("4776")).toBe("iPhone");
    expect(deviceKind(0x1234)).toBeUndefined();
    expect(deviceKind(undefined)).toBeUndefined();
  });
});
