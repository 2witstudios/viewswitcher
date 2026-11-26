# Glossary

One word for each thing. **People read** is the word in the app, the site, the README, packs and the skill. **Code** is the name in types, functions, routes and files. They differ only where a row says so; the Decisions page records why (2026-11-24 "templates, not styles"; 2026-11-25 Hardening Q3).

| People read | Code | What it is | Where it lives |
|---|---|---|---|
| **library** | `library`, `libraryRoot` (a bare `root` is always the library's; one show's folder is `orgDir`) | Everything ViewSwitcher keeps: every show, plus its own state | `~/ViewSwitcher Library` (`VIEWSWITCHER_LIBRARY`) |
| **show** | `org`, `Org`, `orgDir`, `orgId` | One brand or channel: a name, an accent and a ground color, its templates, projects and assets | `<library>/<org>/org.json` |
| **project** | `project`, `Project` | A series within a show. Its views are shared by every stream in it | `<org>/projects/<id>/project.json`, `scenes/` |
| **stream** | `stream`, `Stream` | One episode: a dated folder holding the views made for it and its own copies of project views | `<project>/streams/MM-DD-slug/stream.json` |
| **view** | `scene`, `Scene` | One 1920×1080 web page that can go on air | any `.html` under `templates/`, `projects/<id>/scenes/` or a stream |
| **template** | `template` (a `Scene` whose `origin` is `"template"`) | A view new views start from. It can go on air too | `<org>/templates/*.html`, `<org>/templates/<set>/*.html` |
| **template set** | `TemplateSet`, `set` | An installed template pack: its templates, `_shared/` and `assets/` | `<org>/templates/<set>/` |
| **template pack** | `pack`, `TemplatePack` | The portable format: `pack.json` plus `templates/`, `_shared/` and `assets/`, as a `.zip` or a folder | a download; `docs/template-packs.md` |
| **copy for this stream** | `override` | A stream's own copy of a project view, with the same file name | `<stream>/<name>.html` |
| **transition** | `transition` | The page that plays between two views: the set's, else the project's, else the show's | `…/_shared/transition.html`, `projects/<id>/transition.html` |
| **on air** | `onAir`, `OnAir` | The view the program shows now | `<library>/.viewswitcher/state.json` |
| **program** | `program` | The `/program` page that OBS shows as the browser source "ViewSwitcher Program" | |
| **ground** | `ground` | The show's background color, painted in OBS under the program (source "ViewSwitcher Ground") | `org.json` |
| **camera box** | `slot`, `Slot`, `data-slot` | A box in a view where an OBS source is placed and cropped | `data-slot="Camera"` in the view's HTML |
| **source** | `source` | An OBS input a camera box names: Camera, Screen, iPad, Guest, Camera 2… | OBS |
| **the ViewSwitcher scene** | `obsScene` | The one OBS scene ViewSwitcher drives. Always say "OBS scene" in code | `OBS_SCENE` |
| **live** / **recording** | `ObsStatus.streaming`, `ObsStatus.recording` | OBS is broadcasting or recording. Never "stream" for this | |
| **phone or tablet** (paired) | `remote`, `Remote` | A phone or tablet paired over Wi-Fi | this Mac's `devices.json`, under `VIEWSWITCHER_STATE`, never in the library |
| **iPhone or iPad on USB-C** | `usb` (the caller `{ kind: "usb" }`, `Audience.MacOrUsb`, `LiveState.usb`) | The app connected over the cable | |
| **the app** (iPhone, iPad) | `iPad` (folder, target "ViewSwitcher iPad", user agent `ViewSwitcher-iPad`): a historical name kept on purpose, for App Store continuity | The one universal iPhone and iPad app | `apps/apple/iPad` |
| **AI app**, **agent** | `agent` | An AI app connected over MCP | `/mcp` |
| **preview** | `preview`, `Previewer` | A picture of a view rendered in OBS, for agents. Nothing else is called a preview, except one wire name kept on purpose: the `?preview` query and `preview` class that paint a view as a cover (every library's and pack's `scene.js` reads them; `cover` in code) | `preview.ts` |
| **live edit** | `liveEdit` | Unsaved editor changes shown on the program as you make them | |

## Words we don't use

- **style**, **look**: say *template* or *template set*.
- **scene** in anything people read: say *view*. In code, a bare "scene" is a ViewSwitcher view; OBS's is always `obsScene`.
- **org**, **brand**, **channel** in anything people read: say *show*.
- **episode** in the app: say *stream*. (The site may say "episode 112" in a show's own text.)
- **device** for a paired phone: say *phone or tablet* (a `remote` in code). *Device* is only USB hardware.
- **series**: say *project*.
