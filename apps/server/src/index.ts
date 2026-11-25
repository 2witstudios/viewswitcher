// ViewSwitcher server entry. `--mcp-stdio` is an agent's stdio connection: it only relays to the
// switcher already running (mcp/stdio.ts), so it's decided here, before anything of the server is
// even loaded (no library setup, no OBS, no Bun.serve). Otherwise this is the switcher (main.ts).
if (process.argv.includes("--mcp-stdio")) {
  const { main } = await import("./mcp/stdio");
  await main();
} else {
  await import("./main");
}
export {}; // a module, for the top-level await
