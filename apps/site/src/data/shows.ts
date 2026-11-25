// The four made-up shows on the site, and which of their views it shows.
// scripts/library.ts styles the starter kit with each show's theme and titles (outside the repo);
// scripts/shots.ts renders every view below to src/assets/views/<show>-<view>.webp.
// `media` says what fills each device box: a photo or screen in src/assets/media.

export type Theme = { display: string; body: string; panel: string; line: string; text: string; muted: string; onAccent: string; displayWeight?: number };
export type ShowText = { topic: string; upNext: string; note: string; nextTime: string; starting: string; brb: string; host: string; guest: string };
export type ViewSpec = { file: string; name: string; media?: Record<string, string> };
export type Show = { id: string; name: string; initial: string; kind: string; ground: string; accent: string; theme: Theme; text: ShowText; views: ViewSpec[]; blurb: string };

export const SHOWS: Show[] = [
  {
    id: "kitchen", name: "Saltwater Kitchen", initial: "S", kind: "Cooking show",
    ground: "#13302e", accent: "#f2b544",
    theme: { display: "Outfit", body: "Figtree", panel: "#1a3f3c", line: "#2a5652", text: "#fbf4e6", muted: "#b9cbc4", onAccent: "#2a1d05" },
    text: { topic: "Ep. 31 · Sunday bread, start to finish", upNext: "Ep. 31 · Sunday bread, start to finish", note: "You'll need: 500 g flour, 350 g water, 10 g salt, a pinch of yeast.", nextTime: "Next Sunday: fresh pasta by hand", starting: "The kitchen opens soon.", brb: "The dough's resting. Back in five.", host: "Rosa Delgado · Your cook", guest: "Theo Marchetti · Guest cook" },
    blurb: "The cook at the stove, the pot up close in its own box, and a guest cook in the interview view.",
    views: [
      { file: "starting-soon", name: "Starting soon" },
      { file: "talking-head", name: "Welcome", media: { Camera: "cook" } },
      { file: "teaching", name: "Cook along", media: { Screen: "dough", Camera: "cook" } },
      { file: "interview", name: "Guest cook", media: { Camera: "cook", Guest: "guest-cook" } },
      { file: "brb", name: "Be right back" },
      { file: "ending", name: "Thanks for watching" },
    ],
  },
  {
    id: "watercolor", name: "Intro to Watercolor", initial: "W", kind: "Weekly class",
    ground: "#efe6d8", accent: "#c4553b",
    theme: { display: "Fraunces", body: "Instrument Sans", panel: "#fbf6ee", line: "#e0d3c0", text: "#2d241d", muted: "#76685b", onAccent: "#fff8f0", displayWeight: 600 },
    text: { topic: "Week 3 · Wet-on-wet skies", upNext: "Week 3 · Wet-on-wet skies", note: "You'll need: two brushes, cold-press paper, a jar of clean water.", nextTime: "Next Thursday: painting trees", starting: "Class starts soon.", brb: "Let the paint dry. Back in five.", host: "Maya Lin-Torres · Your teacher", guest: "" },
    blurb: "The painting under an overhead camera, the teacher beside it, and this week's lesson in the title.",
    views: [
      { file: "starting-soon", name: "Starting soon" },
      { file: "teaching", name: "Demo", media: { Screen: "painting", Camera: "teacher" } },
      { file: "talking-head", name: "Talk", media: { Camera: "teacher" } },
      { file: "brb", name: "Break" },
    ],
  },
  {
    id: "grace", name: "Grace Community", initial: "G", kind: "Church service",
    ground: "#141a2e", accent: "#d8b56f",
    theme: { display: "Cormorant Garamond", body: "Source Sans 3", panel: "#1d2440", line: "#2d3658", text: "#f6f1e6", muted: "#b3b0c4", onAccent: "#1a1608", displayWeight: 700 },
    text: { topic: "Romans 12 · A living sacrifice", upNext: "Sunday Live · 10:30 a.m.", note: "Prayer requests: type them in chat and our team will pray with you.", nextTime: "Join us next Sunday at 10:30", starting: "Welcome home.", brb: "We'll be right back.", host: "Pastor Daniel Cho", guest: "" },
    blurb: "A welcome before the service, the sermon slides beside the pastor, and a warm goodbye.",
    views: [
      { file: "starting-soon", name: "Welcome" },
      { file: "teaching", name: "Sermon", media: { Screen: "screen-sermon", Camera: "pastor" } },
      { file: "talking-head", name: "Announcements", media: { Camera: "pastor" } },
      { file: "ending", name: "Goodbye" },
    ],
  },
  {
    id: "longtable", name: "The Long Table", initial: "L", kind: "Podcast and interviews",
    ground: "#1b1411", accent: "#ff7a45",
    theme: { display: "Bricolage Grotesque", body: "Instrument Sans", panel: "#2a1f1a", line: "#3d2e27", text: "#fbf1ea", muted: "#c0a99b", onAccent: "#1b0e07" },
    text: { topic: "Ep. 48 · Starting a bakery at 50", upNext: "Ep. 48 · Starting a bakery at 50", note: "Leave a question for our guest in chat.", nextTime: "Next episode drops Friday", starting: "On air in a minute.", brb: "Back after this.", host: "Marcus Hale · Host", guest: "Nina Alvarez · Guest" },
    blurb: "Host and guest side by side with their names on screen, and a clean intro and outro.",
    views: [
      { file: "starting-soon", name: "Intro" },
      { file: "interview", name: "Conversation", media: { Camera: "host", Guest: "guest" } },
      { file: "talking-head", name: "Host", media: { Camera: "host" } },
      { file: "ending", name: "Outro" },
    ],
  },
];

export const viewId = (show: string, file: string) => `${show}-${file}`;
