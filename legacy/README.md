# WhenToRaid — WoW: Forever prototype

Open `index.html` in a browser. No installation or build step is required. Keep the HTML, CSS, and JavaScript files together.

## Implemented

- Dark, Warcraft-inspired guild planner with responsive layouts.
- Sample week: September 28, 2026, with 24 sample players.
- Weekly half-hour availability grid, mouse painting, click/tap, and keyboard toggling.
- Character profiles, multiple alts, and per-week willingness to bring each character.
- Adjustable tank/healer/DPS targets and raid duration.
- Ranked raid windows using full-session availability and role requirements.
- Dynamic programming assigns at most one character per person, maximizing filled role slots and then main-character preference.
- Drag players between role columns and the bench, or use buttons to select characters and make changes.
- Visible warnings for unavailable players, unoffered characters, and mismatched roles.
- Date changes preserve weekly submissions separately. New weeks have no submitted availability.
- Browser-local persistence and text roster export.

## Prototype boundaries

This is not a hosted multiplayer service. Discord login, server-enforced officer authorization, database storage, Blizzard import, notifications, and actual guild invitations are not implemented. The Discord dialog and settings explicitly identify this. Stored Discord IDs are configuration notes only. Do not enter secrets here.

Times are a fixed guild timezone (America/Los_Angeles), noon–midnight. There is no timezone conversion, overnight scheduling, or multi-night roster optimization yet. Visual browser testing was blocked by the tool's local-file URL policy; automated scheduling tests are included. The UI supports mobile tap selection, but mobile drag painting has not been verified.

Role slots and main preference are the optimization criteria. It does not yet optimize raid buffs, encounter mechanics, class limits, resistances, attendance fairness, player skill, or gear. Equal-quality solutions may favor earlier players. Class diversity is shown for officer review. A character's stored role can be manually overridden, which intentionally triggers a warning.

## Production implementation

1. Target World of Warcraft: Forever, launching November 4, 2026. Confirm the guild region, raid sizes, session durations, timezone, and Forever-specific composition rules. Existing sample characters, realms, specs, and the 2/4/14 role split are illustrative, not verified Forever presets.
2. Host an application with a backend and relational database. Suggested records: guild, member (Discord ID), character, raid week, UTC availability interval, weekly character selection, raid proposal, roster assignment, and audit event. Character profiles should be global; availability and offered characters should be weekly.
3. Register a Discord OAuth application. Use the authorization-code flow with `identify` and `guilds.members.read`, validated state, server-held secrets, and secure sessions. Fetch `/users/@me` and `/users/@me/guilds/{guild_id}/member`. Require membership in the configured server; authorize owner/officers against exact IDs on every protected server operation. A client-side role toggle must never grant access. Recheck role changes and revoked sessions.
4. Add Blizzard server-side API credentials and verify API availability specifically for WoW: Forever; do not assume existing Classic endpoints support it. Import realm, character, specialization, and equipment only where supported; keep manual entry and a last-sync timestamp. Discord identity does not itself prove ownership of a WoW character. Never treat gear as a complete measure of raid readiness.
5. Expand the optimizer with configurable hard and soft constraints: required buffs, roles, class caps, encounter requirements, main preference, bench fairness, and manual locks. Explain shortages and scoring. Save officer drafts separately from published raid rosters; revalidate when availability changes.
6. Add concurrent-edit protection, migration tests, OAuth/access-control tests, timezone/DST tests, and end-to-end tests before inviting the guild.

The next setup inputs are the region, Discord server ID, officer role IDs, and a hosting destination. Credentials belong in server environment variables, never in chat or frontend files.

## Sources checked

- Discord OAuth2: https://docs.discord.com/developers/topics/oauth2
- Discord user/member API: https://github.com/discord/discord-api-docs/blob/main/developers/resources/user.mdx
- Official WoW: Forever announcement: https://news.blizzard.com/en-gb/article/24302093/carve-a-new-path-with-world-of-warcraft-forever

Blizzard confirms the WoW: Forever launch on November 4, 2026. Forever-specific character, equipment, and specialization API support remains unverified.

## Tests

With Node.js installed: `node --test engine.test.js`
