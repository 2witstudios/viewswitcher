# Library kit

What a new ViewSwitcher library starts with. On every start the server's `ensureLibrary` (`src/library-kit.ts`) copies these into the library, under the names below, when they're missing:

| here | in the library |
|---|---|
| `library-CLAUDE.md` | `CLAUDE.md` |
| `library-gitignore` | `.gitignore` |
| `skills/viewswitcher-scenes/SKILL.md` | `.claude/skills/viewswitcher-scenes/SKILL.md` |

They're stored under other names so this repo's own agents and git don't pick them up as this repo's CLAUDE.md, .gitignore or skill.

**This is where changes to the scene skill ship.** A file the kit wrote and nobody has changed since (its hash is in the library's `.viewswitcher/kit.json`) is updated when the kit changes; a file someone edited, or one that was there before the kit, is never touched.

This README isn't copied.
