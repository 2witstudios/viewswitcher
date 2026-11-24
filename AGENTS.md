# ViewSwitcher: agent map

Rules for the code are in CLAUDE.md; what the product is, in README.md. Planning lives in PageSpace.

## PageSpace

| what | id |
|---|---|
| Drive "ViewSwitcher" | `nlhtwmyseos66ad3amza4e90` |
| Start here | `x3z2ewdhj7h2tzlzac2ufnw2` |
| Product map | `c7xdk5r3bi189a861na3kjg7` |
| Decisions | `y6758y971ap72lg4ansiz4d6` |
| Board (task list) | `i5cvv1swfj5w8bezoyd6nxkj` |
| Issues (task list) | `j3y1x1wmr10d21hx16cntzxu` |
| Plans folder | `uxtz170vnkzy1arlxhvriguq` |
| Dev channel | `b2li4ri1aov7dsoupz9s50td` |

Statuses on the board: To Do, In Progress, In Review, Blocked, Done.

## Task codes

- `EDIT`: scene editor (plan `w13aum9pua3d4mtflq0i2h4x`)
- `MAC`: Mac app (plan `gz7zkvlaofixz6ljsljdj6sh`)
- `ISSUE`: bugs, debt and loose ends found outside a slice

Tasks read `<CODE> — Given X, should Y`. Never renumber; inserted work takes a suffix (`EDIT-4a`).

## Workflow

1. A slice has one plan page under Plans (Outcome, Sources, Discovery findings, Design, Task list, Verification, Decisions and open questions) and one board task per code.
2. Post the plan link in the Dev channel (`pagespace channels send b2li4ri1aov7dsoupz9s50td "<message>"`), then build on one branch.
3. One PR per slice; its body names every code it delivers. Move tasks to In Progress while building and In Review when the PR opens; Done after merge.
4. Record decisions on the Decisions page. File anything outside the slice as the next `ISSUE-n`.
5. Never put secrets or .env material in PageSpace. Verify page ids with `pagespace pages read-details <id>`.
