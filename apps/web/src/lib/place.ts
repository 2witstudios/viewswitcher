// Where a scene lives in the library, in words, for the editor's crumb and title.
import { parseLibraryPath, shortDate } from "@viewswitcher/shared";
import type { Library } from "@viewswitcher/shared";

const fileName = (path: string) => parseLibraryPath(path).name.replace(/\.html$/, "");

/** "Bible Study · Day 1 · Nov 24" and the scene's label; its file name until the library is known. */
export function placeOf(lib: Library | undefined, path: string): { crumb: string; title: string } {
  if (!lib) return { crumb: "", title: fileName(path) };
  const t = lib.templates.find((s) => s.path === path);
  if (t) return { crumb: `${lib.org.name} · Templates`, title: t.label };
  for (const p of lib.projects) {
    const s = p.scenes.find((x) => x.path === path);
    if (s) return { crumb: `${lib.org.name} · ${p.name}`, title: s.label };
    for (const st of p.streams) {
      const x = st.scenes.find((y) => y.path === path);
      if (x) return { crumb: `${lib.org.name} · ${p.name} · ${st.date ? shortDate(st.date) : st.name}`, title: x.label };
    }
  }
  return { crumb: lib.org.name, title: fileName(path) };
}
