// Checks listing.md against App Store Connect's length limits (MAC-19): bun apps/apple/AppStore/check.ts
const md = await Bun.file(new URL("listing.md", import.meta.url)).text();
const cell = (field: string) => md.match(new RegExp(`^\\| ${field} \\(\\d+\\) \\| \`([^\`]*)\`[^|\\n]*\\|`, "m"))?.[1]; // a note may follow the value
const block = (heading: string) => md.match(new RegExp(`^### ${heading} \\(\\d+\\)\\n\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``, "m"))?.[1];
const fields: [string, string | undefined, number][] = [
  ["Name", cell("Name"), 30],
  ["Subtitle", cell("Subtitle"), 30],
  ["Promotional text", block("Promotional text"), 170],
  ["Description", block("Description"), 4000],
  ["Keywords", block("Keywords"), 100],
  ["Review notes", block("Notes"), 4000],
];
let bad = 0;
for (const [name, value, max] of fields) {
  const n = value === undefined ? -1 : [...value].length;
  const ok = n > 0 && n <= max;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${n < 0 ? "missing" : `${n}/${max}`}`);
}
const words = block("Keywords")?.split(",") ?? [];
if (words.some((w) => w !== w.trim() || !w)) { bad++; console.log("✗ Keywords: no spaces around commas, no empty ones"); }
process.exit(bad ? 1 : 0);
