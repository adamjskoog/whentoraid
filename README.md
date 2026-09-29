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

WhenToRaid runs in two modes. Without backend settings it is **browser-only**: one guild, saved in this browser, with "Act as" standing in for sign-in. With a Supabase project it is **online**: players sign in with Discord, the whole guild sees the same data live, and the database enforces who may change what. See [Online guilds (Supabase)](#online-guilds-supabase).

## Online guilds (Supabase)

### How access works

- Players sign in with Discord through Supabase Auth.
- A signed-in player belongs to a guild when a member row carries their Discord user ID. Officers invite players by adding that ID on Guild members; players see their own ID in the Online panel.
- The ID is read from `auth.identities`, which Supabase fills in from Discord. It is never read from `user_metadata`, which users can edit.
- Row-level security (`supabase/migrations/`) is the permission check:
  - Officers change guild settings, players, rosters, and attendance.
  - Players change only their own check-ins and characters.
  - Officers can edit anyone's check-in ("Act as").
  - Signed-out visitors can read nothing.
  - The last officer cannot step down.
- `create_guild` makes its caller the first officer. "Move this guild online" in Guild settings uploads a browser guild, including its history.

### How sync works

- The app still holds the whole guild in `app.data`, and every change still goes through the pure functions in `src/lib/`.
- Online, `src/lib/remote/rows.js` turns each new state into table rows, diffs them against what the server has, and `api.js` sends only the changed rows.
- Realtime notifies every open copy of the guild, and each one reloads it.
- A write the server refuses is reported and reverted by reloading.
- The week you view and the player you act as stay per viewer and are never stored.

### Run it locally

This needs Docker.

```sh
npm run db:start                  # local Supabase on ports 55421–55429; prints API_URL and PUBLISHABLE_KEY
cp .env.example .env.local        # set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from the output
npm run dev
npm run test:db                   # row-level security tests (pgTAP)
npm run test:integration          # sync code against the local database
npm run db:stop
```

To sign in with Discord locally:

1. Create an application at <https://discord.com/developers/applications>.
2. Add the OAuth2 redirect `http://127.0.0.1:55421/auth/v1/callback`.
3. Copy `supabase/.env.example` to `supabase/.env` and fill in the client ID and secret.
4. Set `enabled = true` under `[auth.external.discord]` in `supabase/config.toml`.
5. Restart with `npm run db:stop` and `npm run db:start`.

Without Discord, use the **local test sign-in**. With `.env.local` pointing at the local Supabase, `npm run dev` shows two extra buttons on the sign-in panel: **Sign in as test officer** (Discord ID `100000000000000001`) and **Sign in as test player** (`100000000000000002`). To invite the test player, add their ID to a member. Use two browsers, or a private window, to be both at once.

How it works:

- `dev/local-sign-in.js` creates each test user on first use and signs a 12-hour session with the local stack's development JWT secret.
- It runs only on the dev server, and only when the Supabase URL is on this machine.
- It answers only requests from this machine.
- Its buttons are removed from production builds.

The integration tests use the same helpers (`dev/local-supabase.js`). Email login stays disabled.

With `.env.local` present, `npm run build`, `npm run preview`, and `npm run test:e2e` also use the local Supabase. Unit tests (`npm test`) always run browser-only.

### Host it

1. Create a Supabase project. Link it and apply the schema:

   ```sh
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```

2. In the dashboard, open Authentication → Providers → Discord. Enter the Discord application's client ID and secret, and add the redirect URL it shows to the Discord application.
3. In the dashboard, open Authentication → URL Configuration. Set the site URL to where the app is hosted (for example `https://<you>.github.io/whentoraid/`) and add it to the redirect URLs.
4. In GitHub, set the repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (Settings → Secrets and variables → Actions → Variables). The deploy workflow builds with them.

The publishable key is public by design. Never put the secret or service-role key in the frontend or in these variables.

Hosted security checklist. `supabase/config.toml` covers only the local stack; set these in the dashboard:

- **Discord is the only sign-in.** Turn off email sign-up (or require confirmed emails), phone, anonymous sign-ins, and manual identity linking. Membership trusts the Discord identity on an account. An open email sign-up would let someone pre-register a player's email and have Supabase link that player's Discord account to it.
- **Exact redirect URL.** Use exactly `https://<you>.github.io/whentoraid/`, not the bare origin and not a wildcard. Every project page under `<you>.github.io` shares one origin and its localStorage (where the session lives), so a custom domain isolates the app better.
- **Auth rate limits.** Keep them on, and consider a captcha on sign-in.

### What the server enforces

The database enforces:

- Who may read and write each table.
- The shape of stored availability, rosters, and settings.
- Caps of 200 players per guild and 20 characters per player.
- Check-in weeks within a year of today.
- Guilds created only through `create_guild`, at most 10 per account.

What stays advisory (enforced in the app only):

- The check-in deadline, and locks on a planned roster. A player could still edit their own availability after the deadline through the API.
- Officer trust: any officer can demote other officers or delete the guild.

Realtime change events are filtered to guild members, except delete events. Those carry only row keys (guild ID, member IDs, weeks), which Supabase Realtime does not filter by row-level security.

## Code layout

- `src/lib/`: framework-free logic, all pure functions with tests beside them.
  - `engine.js`: roster optimizer and conflict checks.
  - `model.js`: state shape and every state change (members, characters, weekly check-ins, plans, settings).
  - `planning.js`: ranked suggestions, the current plan, roster placement, and applying settings.
  - `grid.js`, `time.js`, `intervals.js`: the guild's half-hour grid, timezone conversion, and UTC time ranges.
  - `setup.js`, `guild.js`, `members.js`: first-run guild creation, guild name/timezone/hours/deadline rules, and adding, editing, and removing players.
  - `checkins.js`, `attendance.js`: who has not answered, the weekly deadline, the Discord reminder, and after-raid attendance.
  - `seed.js`: demo guild. `storage.js`: browser persistence, version upgrades, backup files, recovery of unreadable saves, and cross-tab updates.
  - `remote/`: online mode. `rows.js` (state ↔ rows, row diff), `api.js` (Supabase calls), `client.js` (client, or null when not configured), `sync.svelte.js` (sign-in, save queue, Realtime, `canManage`).
  - `route.js`: the page and week in the URL hash. `display.svelte.js`: the viewer's "show my time" preference. `toast.svelte.js`: messages, including Undo. `roster-export.js`, `calendar.js`: Discord/text roster and `.ics` export. `grid-nav.js`: arrow-key movement in the week grids.
- `public/`: web app manifest, icons, and `sw.js`, the service worker for offline use (production builds only).
- `supabase/`: local Supabase config, the schema and row-level security migration, and pgTAP tests. `integration/`: Vitest tests of `remote/` against the local database.
- `e2e/`: Playwright tests against the production build, on desktop and mobile Chrome.
- `src/components/`, `src/views/`: Svelte UI. Views read `app.data` and replace it with the result of a `model.js` or `planning.js` function; nothing mutates state in place.

## Data model

Members and characters are stored once. Each week holds only check-ins (availability as UTC time ranges, plus characters declined that week) and the officer's plan (session start in UTC plus the roster). Storing UTC lets the grid be shown in any timezone later without migrating data. Check-ins save as they are edited; there is no submit step. The first edit of a week checks the member in, and "Can't make it this week" records a response with no availability, so officers can tell "unavailable" from "hasn't answered". Browser storage uses the key `whentoraid-v3` (the key predates the state version); `storage.js` upgrades older saved state on load, one version at a time. Version 5 adds each member's Discord user ID (optional, used to @mention them in reminders), a weekly check-in deadline, and per-plan attendance (`attended`, `late`, `noshow`) plus a `cancelled` flag. Data saved by the legacy prototype is not migrated. If saved data cannot be loaded (damaged, or saved by a newer version), it is copied to `whentoraid-unreadable` before setup opens, and setup offers it for download. On load, weeks more than 12 weeks old lose their check-ins and keep only their plan (attendance history), so storage stays small. The "show my time" choice is stored per browser under `whentoraid-show-local-time`, outside the guild.

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
- Backup: download the whole guild as JSON from Guild settings, and restore it there or from setup, in this or another browser.
- Undo for removing a player, deleting a character, restoring a backup, loading the demo guild, and erasing the guild.
- Tabs stay in step: a change saved in one tab replaces the guild in the others.
- The page and week are in the URL (`#/planner/2026-10-05`), so reloads keep your place, Back works, and links can be shared.
- "Show my time": viewers in another timezone can see the grid, suggestions, session, and deadline in their own time. Row labels marked +1 fall on the next day.
- Raids can run past midnight: raid hours may end as late as 6 am the next day.
- Installable (web app manifest and icons) and usable offline after the first visit.
- Browser-local persistence, .txt roster download, and "Copy for Discord": Markdown grouped by role, with Discord timestamps so each reader sees their local time. Player-entered names are escaped so they cannot format the message or ping @everyone.

## Prototype boundaries

Online mode (Supabase) covers the following:

- Discord sign-in.
- Database storage.
- Officer and player permissions enforced by the database.
- Invitations by Discord ID.

Officers are marked in the app; they are not yet synced from Discord server roles. The Discord server ID and officer role ID fields are notes for that future step, which needs a server function to call Discord's API with the `guilds.members.read` scope. Online, edits save as they happen; two officers editing the same roster at once is last-write-wins per row. Online guilds need a connection: offline, the page loads but changes are not saved. Blizzard import and notifications are not implemented. In browser-only mode, stored Discord IDs are used only for @mentions. Do not enter secrets anywhere in the app.

The grid is shown in the guild's timezone, within its raid hours (the demo guild uses America/Los_Angeles, noon–midnight). "Act as" stands in for sign-in: anyone using this browser can act as any player. Availability is stored in UTC. Grid columns are always the guild's days; in "show my time" mode only the labels change. There is no multi-night roster optimization. On touch screens, dragging a finger across the availability grid paints cells (swipe the time labels or outside the grid to scroll). Roster cards are moved by pressing and holding, then dragging; the page scrolls when the card nears the top or bottom edge. Touch behavior is verified with Chromium touch emulation, not yet on physical iOS or Android devices.

Role slots, backup depth, bench fairness, and main preference are the optimization criteria. Bench fairness counts how many of the last 4 weeks a player was free for the saved plan but left off it; past sessions are assumed to have run for the current raid duration. It does not yet optimize raid buffs, encounter mechanics, class limits, resistances, player skill, or gear. When bench history is also equal, ties still favor players earlier in the member list. Class diversity is shown for officer review. A character's stored role can be manually overridden, which intentionally triggers a warning.

## Production implementation

1. Target World of Warcraft: Forever, launching November 4, 2026. Confirm the guild region, raid sizes, session durations, timezone, and Forever-specific composition rules. Existing sample characters, realms, specs, and the 2/4/14 role split are illustrative, not verified Forever presets.
2. Done: Supabase hosts the database (guild, member with Discord ID, character, weekly check-in with UTC intervals and declined characters, weekly plan with roster, locks, and attendance). Still to add: separate officer drafts from published rosters, and an audit log.
3. Done: Discord sign-in through Supabase Auth, with membership and officer rights enforced by row-level security. Still to add: sync officers from Discord server roles (`guilds.members.read` via a server function), and require membership in the configured Discord server.
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

GitHub Actions (`.github/workflows/`): `ci.yml` runs `npm run check`, the Playwright tests, and the Supabase database and integration tests on every push and pull request. `deploy.yml` publishes `dist/` to GitHub Pages (<https://adamjskoog.github.io/whentoraid/>) on every push to `main`, after the checks and Playwright tests pass. To redeploy without a push, use Actions → Deploy to GitHub Pages → Run workflow. The build uses relative asset paths, so it also works on Netlify, Vercel, or any static host.
