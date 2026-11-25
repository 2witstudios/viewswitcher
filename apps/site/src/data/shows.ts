// The six made-up shows on the site, each with its own look, and the views the site shows.
// Their view HTML lives in scripts/shows/<id>/ (one style per show); scripts/library.ts copies it into a
// scratch library outside the repo and scripts/shots.ts renders every view to src/assets/views/<id>-<view>.webp.
// `media` says what fills each device box: a photo in src/assets/media (credited in CREDITS.md).

export type ViewSpec = { file: string; name: string; media?: Record<string, string> };
export type Show = {
  id: string; name: string; initial: string; kind: string; episode: string;
  /** OBS paints this behind every view; it also fills the site's frames under the photos. */
  ground: string; accent: string;
  blurb: string; views: ViewSpec[];
};

export const SHOWS: Show[] = [
  {
    id: "fullcount", name: "Full Count", initial: "F", kind: "Sports podcast", episode: "Ep. 112 · Trade deadline",
    ground: "#0b1426", accent: "#e63946",
    blurb: "Two hosts under a scoreboard title bar that counts the segments, with highlights in the break.",
    views: [
      { file: "starting-soon", name: "Pregame", media: { Screen: "fc-stadium" } },
      { file: "live", name: "Host cam", media: { Camera: "fc-host" } },
      { file: "main", name: "Both hosts", media: { Camera: "fc-host", Guest: "fc-analyst" } },
      { file: "brb", name: "Break", media: { Screen: "fc-stadium" } },
      { file: "ending", name: "Final whistle", media: { Camera: "fc-host", Guest: "fc-analyst" } },
    ],
  },
  {
    id: "nova", name: "NOVA_PLAYS", initial: "N", kind: "Gaming stream", episode: "Ranked grind · day 12",
    ground: "#0d0f1a", accent: "#7cf3ff",
    blurb: "The game full screen with an angled face cam, sub alerts and a clipped name plate.",
    views: [
      { file: "starting-soon", name: "Starting soon", media: { Screen: "nova-gameplay" } },
      { file: "live", name: "Just chatting", media: { Camera: "nova-cam" } },
      { file: "main", name: "Gameplay", media: { Screen: "nova-gameplay", Camera: "nova-cam" } },
      { file: "brb", name: "BRB", media: { Screen: "nova-gameplay" } },
      { file: "ending", name: "Raid out", media: { Camera: "nova-cam" } },
    ],
  },
  {
    id: "grace", name: "Grace Community", initial: "G", kind: "Church service", episode: "Sunday Live · 10:30",
    ground: "#08080a", accent: "#c9a45c",
    blurb: "Letterboxed and calm: the scripture beside the pastor, gold rules and spaced capitals.",
    views: [
      { file: "starting-soon", name: "Welcome" },
      { file: "live", name: "Pastor", media: { Camera: "pastor" } },
      { file: "main", name: "Sermon", media: { Camera: "pastor" } },
      { file: "brb", name: "Giving", media: { Camera: "pastor" } },
      { file: "ending", name: "Goodbye" },
    ],
  },
  {
    id: "remi", name: "Roam with Remi", initial: "R", kind: "Travel vlog", episode: "Day 4 · Over the ridge",
    ground: "#e6dcc8", accent: "#d9472b",
    blurb: "A travel journal: paper tags, a polaroid of the view and a location stamp.",
    views: [
      { file: "starting-soon", name: "Starting soon", media: { Screen: "remi-lake" } },
      { file: "live", name: "Walking", media: { Camera: "remi" } },
      { file: "main", name: "The view", media: { Screen: "remi-lake", Camera: "remi" } },
      { file: "brb", name: "Snack stop", media: { Screen: "remi-lake" } },
      { file: "ending", name: "Signing off", media: { Camera: "remi" } },
    ],
  },
  {
    id: "riverside", name: "Riverside Live", initial: "R", kind: "Live event coverage", episode: "Music Festival · Day 2",
    ground: "#101114", accent: "#d62828",
    blurb: "News-style coverage: a red live block, a location bar, the reporter's name strip and a clock.",
    views: [
      { file: "starting-soon", name: "Coming up", media: { Screen: "festival" } },
      { file: "live", name: "Reporter", media: { Camera: "kofi" } },
      { file: "main", name: "Main stage", media: { Screen: "festival", Camera: "kofi" } },
      { file: "brb", name: "Schedule", media: { Screen: "festival" } },
      { file: "ending", name: "That's a wrap", media: { Screen: "festival" } },
    ],
  },
  {
    id: "kitchen", name: "Saltwater Kitchen", initial: "S", kind: "Cooking show", episode: "Ep. 31 · Sunday bread",
    ground: "#eadfca", accent: "#d9472b",
    blurb: "A handwritten recipe card, the dough up close and questions from chat on sticky notes.",
    views: [
      { file: "starting-soon", name: "Starting soon", media: { Screen: "dough" } },
      { file: "live", name: "At the stove", media: { Camera: "cook" } },
      { file: "main", name: "Cook along", media: { Screen: "dough", Camera: "cook" } },
      { file: "brb", name: "Be right back", media: { Screen: "dough" } },
      { file: "ending", name: "Thanks for watching", media: { Camera: "cook" } },
    ],
  },
];

export const viewId = (show: string, file: string) => `${show}-${file}`;
