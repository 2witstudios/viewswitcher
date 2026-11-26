// The built-in packs as they're built: example shows made generic (their name, accent and ground
// become placeholders) and checked with the validator installs use.
import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { genericTheme, genericView, SHOWS, SHOWS_DIR, type Show, showPacks } from "./index";

describe("an example show made generic", () => {
  const show: Show = { ...SHOWS.find((s) => s.id === "remi")!, views: [] };
  test("a view loses the show's name: as typed, broken over lines, in capitals, and in its title", () => {
    expect(genericView(`<title>Roam with Remi · Walking</title><b>Roam<br>with<br/>Remi</b><i>Roam with\n    Remi</i><small>ROAM WITH REMI · DAY 4</small><p class="a" style="top: 1px">ROAM&nbsp;WITH REMI</p><p>Remi, up top</p>`, show))
      .toBe(`<title>Walking</title><b>{{ORG_NAME}}</b><i>{{ORG_NAME}}</i><small style="text-transform: uppercase">{{ORG_NAME}} · DAY 4</small><p class="a" style="top: 1px; text-transform: uppercase">{{ORG_NAME}}</p><p>Remi, up top</p>`);
  });
  test("capitals keep the element plain text people can retype (one leaf, no span inside)", () => {
    const out = genericView(`<small>ROAM WITH REMI · DAY 4</small>`, show);
    expect(out).not.toContain("<span");
  });
  test("capitals: never styled onto a void element, nor onto lower-case words beside them; either quote; never markup inside an attribute", () => {
    const span = `<span style="text-transform: uppercase">{{ORG_NAME}}</span>`;
    expect(genericView(`<p>Live from<br>ROAM WITH REMI</p>`, show)).toBe(`<p>Live from<br>${span}</p>`);
    expect(genericView(`<p>Live with ROAM WITH REMI, day 4</p>`, show)).toBe(`<p>Live with ${span}, day 4</p>`);
    expect(genericView(`<p style='color: red'>ROAM WITH REMI</p>`, show)).toBe(`<p style='color: red; text-transform: uppercase'>{{ORG_NAME}}</p>`);
    expect(genericView(`<img alt="ROAM WITH REMI" src="x.png">`, show)).toBe(`<img alt="{{ORG_NAME}}" src="x.png">`);
  });
  test("a show name left in an attribute fails the export too", () => {
    expect(() => genericView(`<img alt="Roam With Remi">`, show)).toThrow(/still in a view/);
  });
  test("a show name it can't turn generic fails the export, however it's written", () => {
    for (const v of [`<p>Roam With Remi</p>`, `<p>roam with remi</p>`, `<p>Roam&nbsp;with remi</p>`, `<p><b>ROAM</b> WITH REMI</p>`]) {
      expect(() => genericView(v, show)).toThrow(/still in a view/);
    }
  });
  test("a theme takes the org's accent and ground; a paper ground keeps its own color", () => {
    const css = `:root {\n  --ground: #e6dcc8;\n  --red: #D9472B;\n}\n.ground.paper { background-color: var(--ground); }`;
    expect(genericTheme(css, show)).toBe(`:root {\n  --ground: {{GROUND}};\n  --paper-ground: #e6dcc8;\n  --red: {{ACCENT}};\n}\n.ground.paper { background-color: var(--paper-ground); }`);
    expect(() => genericTheme(":root { --ground: #000; }", show)).toThrow(/no --ground/);
  });
  test("compact CSS: every accent variable, one after another", () => {
    expect(genericTheme(`:root{--ground:#e6dcc8;--red:#d9472b;--edge:#d9472b;}`, show)).toBe(`:root{--ground: {{GROUND}};--red:{{ACCENT}};--edge:{{ACCENT}};}`);
  });
  test("every variable set to the accent takes the org's; only --ground itself is the ground", () => {
    const css = `:root { --x-ground: #e6dcc8; --ground: #e6dcc8; --red: #d9472b; --edge: #d9472b; }`;
    expect(genericTheme(css, show)).toBe(`:root { --x-ground: #e6dcc8; --ground: {{GROUND}}; --red: {{ACCENT}}; --edge: {{ACCENT}}; }`);
  });
});

describe("showPacks", () => {
  test("one pack per show, in the site's order, each with its views and theme", async () => {
    const packs = await showPacks();
    expect(packs.map((p) => p.id)).toEqual(SHOWS.map((s) => s.id));
    for (const p of packs) {
      const show = SHOWS.find((s) => s.id === p.id)!;
      expect(p.files.map((f) => f.path)).toEqual(expect.arrayContaining(["pack.json", "_shared/theme.css", ...show.views.map((v) => `templates/${v.file}.html`)]));
    }
  });

  test("one show that won't build is left out (and reported), not the rest; without onError it fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vs-shows-"));
    await cp(SHOWS_DIR, dir, { recursive: true });
    await writeFile(join(dir, "nova/main.html"), "<p>NOVA PLAYS</p><p>nova_plays</p>"); // a name it can't make generic
    const left: string[] = [];
    const packs = await showPacks((id) => left.push(id), SHOWS, dir);
    expect(left).toEqual(["nova"]);
    expect(packs.map((p) => p.id)).toEqual(["fullcount", "grace", "remi", "riverside", "kitchen"]);
    await expect(showPacks(undefined, SHOWS, dir)).rejects.toThrow(/nova/); // packs:export and the site build still fail on it
    await rm(dir, { recursive: true, force: true });
  });
});
