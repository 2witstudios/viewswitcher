// Which library scenes the site shows. `bun run shots` renders each one to
// src/assets/scenes/<id>.webp and records its slot boxes in src/data/scenes.json.
export type SceneSpec = { id: string; path: string; org: string; name: string };

/** The hero's switcher: one Daisy Debate stream, in running order. */
export const HERO: SceneSpec[] = [
  { id: "daisy-starting", path: "daisy/projects/ld-resolution-2026-27/scenes/starting-soon.html", org: "Daisy Debate", name: "Starting soon" },
  { id: "daisy-teaching", path: "daisy/projects/ld-resolution-2026-27/streams/12-04-burdens/teaching.html", org: "Daisy Debate", name: "Teaching" },
  { id: "daisy-whiteboard", path: "daisy/projects/ld-resolution-2026-27/scenes/whiteboard.html", org: "Daisy Debate", name: "Whiteboard" },
  { id: "daisy-chapter", path: "daisy/projects/ld-resolution-2026-27/streams/12-04-burdens/chapter.html", org: "Daisy Debate", name: "Chapter" },
  { id: "daisy-brb", path: "daisy/projects/ld-resolution-2026-27/scenes/brb.html", org: "Daisy Debate", name: "Be right back" },
];

/** Who it's for: one real scene per kind of show. */
export const AUDIENCE: SceneSpec[] = [
  { id: "bible-study-teaching", path: "bible-study/projects/day-1/scenes/teaching.html", org: "Bible Study", name: "Teaching" },
  { id: "personal-whiteboard", path: "personal/templates/whiteboard.html", org: "Personal", name: "Whiteboard" },
  { id: "pagespace-teaching", path: "pagespace/templates/teaching.html", org: "PageSpace", name: "Teaching" },
];

export const SCENES = [...HERO, ...AUDIENCE];
