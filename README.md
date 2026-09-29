# WhenToRaid — WoW: Forever prototype

A Vite + Svelte 5 app. Requires Node.js 20 or newer.

```sh
npm install
npm run dev      # local dev server
npm test         # unit and component tests (Vitest)
npm run test:e2e # end-to-end tests (Playwright; first run: npx playwright install chromium)
npm run build    # production build in dist/
npm run lint     # ESLint (JS + Svelte)
npm run format   # Prettier
npm run check    # lint, format check, tests, and build: run before sharing changes
```

The original single-file prototype is kept in `legacy/` for comparison.

## Code layout

- `src/lib/`: framework-free logic, all pure functions with tests beside them.
  - `engine.js`: roster optimizer and conflict checks.
  - `model.js`: state shape and every state change (members, characters, weekly check-ins, plans, settings).
  - `planning.js`: ranked suggestions, the current plan, roster placement, and applying settings.
  - `grid.js`, `time.js`, `intervals.js`: the guild's half-hour grid, timezone conversion, and UTC time ranges.
  - `setup.js`, `guild.js`, `members.js`: first-run guild creation, guild name/timezone/hours/deadline rules, and adding, editing, and removing players.
  - `checkins.js`, `attendance.js`: who has not answered, the weekly deadline, the Discord reminder, and after-raid attendance.
  - `seed.js`: demo guild. `storage.js`: browser persistence and version upgrades. `roster-export.js`, `calendar.js`: Discord/text roster and `.ics` export. `grid-nav.js`: arrow-key movement in the week grids.
- `e2e/`: Playwright tests against the production build, on desktop and mobile Chrome.
- `src/components/`, `src/views/`: Svelte UI. Views read `app.data` and replace it with the result of a `model.js` or `planning.js` function; nothing mutates state in place.

## Data model

Members and characters are stored once. Each week holds only check-ins (availability as UTC time ranges, plus characters declined that week) and the officer's plan (session start in UTC plus the roster). Storing UTC lets the grid be shown in any timezone later without migrating data. Check-ins save as they are edited; there is no submit step. The first edit of a week checks the member in, and "Can't make it this week" records a response with no availability, so officers can tell "unavailable" from "hasn't answered". Browser storage uses the key `whentoraid-v3` (the key predates the state version); `storage.js` upgrades older saved state on load, one version at a time. Version 5 adds each member's Discord user ID (optional, used to @mention them in reminders), a weekly check-in deadline, and per-plan attendance (`attended`, `late`, `noshow`) plus a `cancelled` flag. Data saved by the legacy prototype is not migrated.

## Implemented

- Dark, Warcraft-inspired guild planner with responsive layouts.
- First-run setup: name the guild, pick its timezone and raid hours, and add yourself with a main character. A demo guild (24 sample players, week of September 28, 2026) is one click away, and Guild settings can start over.
- Guild members page: add, rename, and remove players (with their main character and optional Discord ID), see each player's check-in status and attendance record, and "Act as" any player to fill in their availability and characters. The sidebar has the same switcher.
- Guild name, timezone, raid hours, and a weekly check-in deadline are editable in Guild settings. Changing hours keeps the chosen session at the same clock time.
- Check-ins panel: who has not answered, the deadline, and "Copy reminder for Discord", which @mentions players with a saved Discord ID and shows the deadline in each reader's timezone.
- After the raid: mark each rostered player attended, late, or no-show, or mark the raid cancelled. Cancelled raids do not count toward attendance or bench fairness.
- The availability map shows, by default, how many role slots the best roster fills at each start time and what is short ("Short 1 healer"); Tanks, Healers, Damage, and Players views count who can stay. Suggestion cards name what is missing.
- Week navigation: previous, next, and "This week" buttons beside the date picker.
- The bench is grouped into free for this session, can't make it, and haven't checked in. The Discord and text exports list only players who could fill in.
- "Add to calendar" downloads an `.ics` file for the session (stable per week, so re-importing updates the event).
- Keyboard: the availability map and grid are single Tab stops; arrow keys, Home, and End move between cells.
- Weekly half-hour availability grid, mouse painting, click/tap, and keyboard toggling.
- Character profiles, multiple alts, and per-week willingness to bring each character. Characters can be edited, deleted (two-click confirm; a member's last character is kept), and promoted to main.
- The planner heatmap shows how many players could stay for a full session starting at each time, shaded relative to guild size.
- Adjustable tank/healer/DPS targets and raid duration.
- Ranked raid windows using full-session availability and role requirements.
- Dynamic programming assigns at most one character per person, maximizing filled role slots, then favoring players who sat out recently, then main characters.
- Suggested windows are ranked by slots filled, then backups for the thinnest needed role, then total backups. Cards show backups per role.
- Officers can lock rostered players; rebuilds, window changes, and settings changes keep them.
- Drag players between role columns and the bench, or use buttons to select characters and make changes.
- Visible warnings for unavailable players, unoffered characters, and mismatched roles.
- Each week keeps its own check-ins. New weeks start with nobody checked in.
- Browser-local persistence, .txt roster download, and "Copy for Discord": Markdown grouped by role, with Discord timestamps so each reader sees their local time. Player-entered names are escaped so they cannot format the message or ping @everyone.

## Prototype boundaries

This is not a hosted multiplayer service. Discord login, server-enforced officer authorization, database storage, Blizzard import, notifications, and actual guild invitations are not implemented. The Discord dialog and settings explicitly identify this. Stored Discord IDs are configuration notes only. Do not enter secrets here.

The grid is shown in the guild's timezone, within its raid hours (the demo guild uses America/Los_Angeles, noon–midnight). "Act as" stands in for sign-in: anyone using this browser can act as any player. Availability is stored in UTC, but the UI does not yet show each viewer's local time, and there is no overnight scheduling or multi-night roster optimization. On touch screens, dragging a finger across the availability grid paints cells (swipe the time labels or outside the grid to scroll). Roster cards are moved by pressing and holding, then dragging; the page scrolls when the card nears the top or bottom edge. Touch behavior is verified with Chromium touch emulation, not yet on physical iOS or Android devices.

Role slots, backup depth, bench fairness, and main preference are the optimization criteria. Bench fairness counts how many of the last 4 weeks a player was free for the saved plan but left off it; past sessions are assumed to have run for the current raid duration. It does not yet optimize raid buffs, encounter mechanics, class limits, resistances, player skill, or gear. When bench history is also equal, ties still favor players earlier in the member list. Class diversity is shown for officer review. A character's stored role can be manually overridden, which intentionally triggers a warning.

## Production implementation

1. Target World of Warcraft: Forever, launching November 4, 2026. Confirm the guild region, raid sizes, session durations, timezone, and Forever-specific composition rules. Existing sample characters, realms, specs, and the 2/4/14 role split are illustrative, not verified Forever presets.
2. Host an application with a backend and relational database. Suggested records: guild, member (Discord ID), character, raid week, UTC availability interval, weekly character selection, raid proposal, roster assignment, and audit event. Character profiles should be global; availability and offered characters should be weekly.
3. Register a Discord OAuth application. Use the authorization-code flow with `identify` and `guilds.members.read`, validated state, server-held secrets, and secure sessions. Fetch `/users/@me` and `/users/@me/guilds/{guild_id}/member`. Require membership in the configured server; authorize owner/officers against exact IDs on every protected server operation. A client-side role toggle must never grant access. Recheck role changes and revoked sessions.
4. Add Blizzard server-side API credentials and verify API availability specifically for WoW: Forever; do not assume existing Classic endpoints support it. Import realm, character, specialization, and equipment only where supported; keep manual entry and a last-sync timestamp. Discord identity does not itself prove ownership of a WoW character. Never treat gear as a complete measure of raid readiness.
5. Expand the optimizer with configurable hard and soft constraints: required buffs, class caps, and encounter requirements (backup depth, bench fairness, main preference, and manual locks exist). Explain shortages and scoring. Save officer drafts separately from published raid rosters; revalidate when availability changes.
6. Add concurrent-edit protection, migration tests, OAuth/access-control tests, timezone/DST tests, and end-to-end tests before inviting the guild.

The next setup inputs are the region, Discord server ID, officer role IDs, and a hosting destination. Credentials belong in server environment variables, never in chat or frontend files.

## Sources checked

- Discord OAuth2: https://docs.discord.com/developers/topics/oauth2
- Discord user/member API: https://github.com/discord/discord-api-docs/blob/main/developers/resources/user.mdx
- Official WoW: Forever announcement: https://news.blizzard.com/en-gb/article/24302093/carve-a-new-path-with-world-of-warcraft-forever

Blizzard confirms the WoW: Forever launch on November 4, 2026. Forever-specific character, equipment, and specialization API support remains unverified.

## Tests and deployment

`npm test` runs the Vitest suite: engine, model, planning, members, setup, check-ins, attendance, exports, timezone/DST, storage upgrades, and component tests for the planner, setup, members, characters, availability, and heatmap. `npm run test:e2e` builds the app and runs Playwright against it on desktop and mobile Chrome.

GitHub Actions (`.github/workflows/`): `ci.yml` runs `npm run check` and the Playwright tests on every push and pull request. `deploy.yml` publishes `dist/` to GitHub Pages on each push to `main`; enable it once under repository Settings → Pages → Source: GitHub Actions. The build uses relative asset paths, so it also works on Netlify, Vercel, or any static host.
