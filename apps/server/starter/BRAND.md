# {{ORG_NAME}} brand

Scenes for {{ORG_NAME}} use the tokens in `templates/_shared/theme.css`. This org started from the ViewSwitcher starter kit; replace these defaults with the real brand when you have one (colors, fonts, marks in `templates/_shared/brand/`).

| token | value | use |
|---|---|---|
| `--ground` | {{GROUND}} | behind everything (OBS) and slot corner masks; keep in sync with `org.json` `ground` |
| `--panel` | #191b22 | panels, bars |
| `--accent` | {{ACCENT}} | the one highlight: live chip, current item |
| `--text` / `--muted` | #f4f5f7 / #a3a8b5 | main and secondary text |

- **Type**: headlines `.display` (Space Grotesk 700), labels `.kicker` (caps, wide tracking), body Instrument Sans.
- **Mark**: `templates/_shared/brand/mark.svg`. The program page shows it during scene transitions.
- Text readable at stream size: body ≥ 21px, labels ≥ 14px.
