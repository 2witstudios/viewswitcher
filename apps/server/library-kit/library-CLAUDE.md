# ViewSwitcher Library

Live-stream content for ViewSwitcher, one folder per org (a brand or channel). Each org has its own templates, assets, projects and brand (`<org>/BRAND.md`). Template sets installed from template packs live in `<org>/templates/<set>/`. The ViewSwitcher app serves this folder and switches scenes in OBS.

Before creating or editing anything here, use the **viewswitcher-scenes** skill (`.claude/skills/viewswitcher-scenes/SKILL.md`). It covers the folder layout, the stream-over-project override rule, the scene file contract (1920×1080, transparent, `data-slot` device boxes), what people can edit in the switcher, how scenes run (sandboxed), template sets and template packs, and where each org's brand lives.
