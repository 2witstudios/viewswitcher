// The six made-up shows on the site, each with its own look, and the views the site shows. Each is
// also a built-in template set in the app (./build.ts showPacks).
// Their view HTML lives in ../shows/<id>/ (one template set per show), with ../shows/_shared/ common
// to all; the site's scripts/library.ts copies it into a scratch library outside the repo and
// scripts/shots.ts renders every view to apps/site/src/assets/views/<id>-<view>.webp.
// `media` says what fills each device box: a photo in apps/site/src/assets/media (credited in its CREDITS.md).
// Plain data, so the site's pages can import it (@viewswitcher/packs/shows) without the pack builder.

export type ViewSpec = {
  file: string; name: string; media?: Record<string, string>;
  /** When to put it on air: one line on its template set's page. */
  use: string;
};
export type Show = {
  id: string; name: string; initial: string; kind: string; episode: string;
  /** OBS paints this behind every view; it also fills the site's frames under the photos. */
  ground: string; accent: string;
  blurb: string; views: ViewSpec[];
  /** Its template set's page: /templates/<slug>. */
  slug: string;
  /** Who the template set suits, for its page. */
  goodFor: string;
};

export const SHOWS: Show[] = [
  {
    id: "fullcount", name: "Full Count", initial: "F", kind: "Sports podcast", episode: "Ep. 112 · Trade deadline",
    ground: "#0b1426", accent: "#e63946",
    blurb: "Two hosts under a scoreboard title bar that counts the segments, with highlights in the break.",
    slug: "full-count", goodFor: "Sports talk shows and podcasts with two hosts, from fantasy leagues to local teams.",
    views: [
      { file: "starting-soon", name: "Pregame", use: "Before the show: tonight's topic over the stadium, with a countdown to the first pitch.", media: { Screen: "fc-stadium" } },
      { file: "live", name: "Host cam", use: "One host full screen, with the scoreboard bar and the segment count.", media: { Camera: "fc-host" } },
      { file: "main", name: "Both hosts", use: "Both hosts side by side under the scoreboard bar: the show itself.", media: { Camera: "fc-host", Guest: "fc-analyst" } },
      { file: "brb", name: "Break", use: "Commercial break: highlights play beside a countdown and what's up next.", media: { Screen: "fc-stadium" } },
      { file: "ending", name: "Final whistle", use: "The sign-off: both hosts, \"That's the game\" and when you're back.", media: { Camera: "fc-host", Guest: "fc-analyst" } },
    ],
  },
  {
    id: "nova", name: "NOVA_PLAYS", initial: "N", kind: "Gaming stream", episode: "Ranked grind · day 12",
    ground: "#0d0f1a", accent: "#7cf3ff",
    blurb: "The game full screen with an angled face cam, sub alerts and a clipped name plate.",
    slug: "nova-plays", goodFor: "Gaming streams on Twitch or YouTube: a face cam over the game, alerts and a raid screen.",
    views: [
      { file: "starting-soon", name: "Starting soon", use: "Before you go live: last night's clip plays behind a countdown.", media: { Screen: "nova-gameplay" } },
      { file: "live", name: "Just chatting", use: "Just chatting: your camera full screen with the viewer count and sub alerts.", media: { Camera: "nova-cam" } },
      { file: "main", name: "Gameplay", use: "Gameplay full screen, your face cam in an angled frame, and your rank.", media: { Screen: "nova-gameplay", Camera: "nova-cam" } },
      { file: "brb", name: "BRB", use: "Stepping away: the game blurs behind a BRB timer.", media: { Screen: "nova-gameplay" } },
      { file: "ending", name: "Raid out", use: "Raid out: GG, who you're raiding and when you're next on.", media: { Camera: "nova-cam" } },
    ],
  },
  {
    id: "grace", name: "Grace Community", initial: "G", kind: "Church service", episode: "Sunday Live · 10:30",
    ground: "#08080a", accent: "#c9a45c",
    blurb: "Letterboxed and calm: the scripture beside the pastor, gold rules and spaced capitals.",
    slug: "grace-community", goodFor: "Church services and other weekly gatherings that want a calm, reverent look.",
    views: [
      { file: "starting-soon", name: "Welcome", use: "Before the service: \"Welcome home\" and a countdown to the start." },
      { file: "live", name: "Pastor", use: "Worship and announcements: the camera full screen, with a name strip to retype.", media: { Camera: "pastor" } },
      { file: "main", name: "Sermon", use: "The sermon: the scripture beside the pastor, with the sermon title underneath.", media: { Camera: "pastor" } },
      { file: "brb", name: "Giving", use: "Giving: a calm thank-you with how to give, over the camera.", media: { Camera: "pastor" } },
      { file: "ending", name: "Goodbye", use: "The goodbye: \"Go in peace\" and next Sunday's time." },
    ],
  },
  {
    id: "remi", name: "Roam with Remi", initial: "R", kind: "Travel vlog", episode: "Day 4 · Over the ridge",
    ground: "#e6dcc8", accent: "#d9472b",
    blurb: "A travel journal: paper tags, a polaroid of the view and a location stamp.",
    slug: "roam-with-remi", goodFor: "Travel vlogs and outdoor streams: walks, hikes and city tours, with chat along for the ride.",
    views: [
      { file: "starting-soon", name: "Starting soon", use: "Before you head out: today's route, a countdown and where you're going.", media: { Screen: "remi-lake" } },
      { file: "live", name: "Walking", use: "Walking and talking: your camera full screen, with a question from chat.", media: { Camera: "remi" } },
      { file: "main", name: "The view", use: "At the viewpoint: the view in a polaroid, you beside it.", media: { Screen: "remi-lake", Camera: "remi" } },
      { file: "brb", name: "Snack stop", use: "A snack stop: the view stays on with a back-in timer.", media: { Screen: "remi-lake" } },
      { file: "ending", name: "Signing off", use: "Signing off: the day's distance and tomorrow's plan.", media: { Camera: "remi" } },
    ],
  },
  {
    id: "riverside", name: "Riverside Live", initial: "R", kind: "Live event coverage", episode: "Music Festival · Day 2",
    ground: "#101114", accent: "#d62828",
    blurb: "Coverage like the evening news: a red live block, a location bar, the reporter's name strip and a clock.",
    slug: "riverside-live", goodFor: "Live event coverage, local news and festivals, with a reporter on location.",
    views: [
      { file: "starting-soon", name: "Coming up", use: "Before you're on: the event over the crowd, with a countdown.", media: { Screen: "festival" } },
      { file: "live", name: "Reporter", use: "The reporter full screen, with the location bar and name strip.", media: { Camera: "kofi" } },
      { file: "main", name: "Main stage", use: "The main stage, with the reporter in a box and the headline below.", media: { Screen: "festival", Camera: "kofi" } },
      { file: "brb", name: "Schedule", use: "Between sets: the schedule for the rest of the night.", media: { Screen: "festival" } },
      { file: "ending", name: "That's a wrap", use: "That's a wrap: when coverage picks up again.", media: { Screen: "festival" } },
    ],
  },
  {
    id: "kitchen", name: "Saltwater Kitchen", initial: "S", kind: "Cooking show", episode: "Ep. 31 · Sunday bread",
    ground: "#eadfca", accent: "#d9472b",
    blurb: "A handwritten recipe card, the dough up close and questions from chat on sticky notes.",
    slug: "saltwater-kitchen", goodFor: "Cooking, baking and craft shows with a second camera on the work.",
    views: [
      { file: "starting-soon", name: "Starting soon", use: "Before the kitchen opens: today's recipe and a countdown.", media: { Screen: "dough" } },
      { file: "live", name: "At the stove", use: "At the stove: the cook full screen, with a question from chat.", media: { Camera: "cook" } },
      { file: "main", name: "Cook along", use: "Cook along: the dough up close, the cook in a polaroid and the recipe card.", media: { Screen: "dough", Camera: "cook" } },
      { file: "brb", name: "Be right back", use: "While the dough rests: a back-in timer and the next question.", media: { Screen: "dough" } },
      { file: "ending", name: "Thanks for watching", use: "Thanks for watching, and next week's recipe.", media: { Camera: "cook" } },
    ],
  },
];

export const viewId = (show: string, file: string) => `${show}-${file}`;
