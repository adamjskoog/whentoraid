# Coordination improvements

Scope approved October 14, 2026: the five major and five minor recommendations from the app review.

## Task list

- [x] Officer dashboard across upcoming raids with actionable issues.
- [x] Authenticated Discord Confirm / Can't attend / View roster actions, preserving delivery lifecycle.
- [x] Weekly recurring raid series, per-date exceptions, and a month view.
- [x] Optional class limits, utility requirements, and configurable roster priorities.
- [x] Preferred / firm / tentative availability and date-range absences.
- [x] Automatic response refresh and last-checked status.
- [x] Copy published roster link.
- [x] Full date plus local/guild time in the planner heading.
- [x] Discoverable demo and accurate setup instructions.
- [x] Prominent editing-as banner and return-to-self action.

## Where each item lives (October 14, 2026)

- Dashboard: `src/lib/officer-dashboard.js`, `OfficerDashboard.svelte` on Home (officers only).
- Discord buttons: migration `20261014120000_coordination.sql` (`guild_discord.channel_id`, target fingerprints, `respond_to_discord_raid`), `supabase/functions/_shared/discord-interactions.js`, the new `raid-interactions` Edge Function, bot targets in `deliverMessages`. Buttons appear only on bot-channel posts; webhook guilds behave as before.
- Series and month view: `src/lib/raid-series.js` (stored on each raid profile as `series`), `RaidScheduleEditor.svelte` (Guild settings → Raid rules), `RaidMonth.svelte` on Home.
- Rules: `src/lib/composition-rules.js`, `engine.js` (class counts and a utility bitmask in the DP state), `RaidRulesEditor.svelte`, warnings in the planner roster tab.
- Availability kinds and absences: `model.js` (`setAvailabilityKind`, `setAbsenceDates`, `getRawCheckin`), check-in column `availability`, "Mark as" and "Away dates" on My availability.
- Response refresh, roster link, heading: `Planner.svelte`, `RaidResponsesPanel.svelte`, `route.js` (`#/published/<week>/<raid>`, `publishedRosterUrl`), `sync.svelte.js` (`?guild=` survives Discord sign-in), `grid.js` (`formatSessionHeading`).
- Demo and setup: "Try the demo" at the top of setup; README hosting steps for Edge Functions, Vault secrets, and the Discord bot.
- Banner: `EditingAsBanner.svelte` (online officers editing another player).

## Verification results (October 14, 2026)

- `npm run check`: lint, formatting, 49 unit/component files / 413 tests, production build.
- `npx supabase test db`: 11 pgTAP files including the new `coordination.test.sql` (availability validation, old-client rows, rule and series constraints, bot channel, every Discord response outcome, service-role-only RPC).
- `npm run test:integration`: 17 tests including the Edge Function delivery tests with `supabase functions serve` running.
- Playwright desktop + Pixel 7: 52 passed, 2 intentional platform skips, including the new `e2e/coordination.spec.js`.

Not exercised: the hosted migration push and function deploys, a real Discord application/bot (signature verification is covered with generated Ed25519 keys; the Discord API is mocked), and the `raid-interactions` function served end to end with real secrets. Local test runs from the agent shell need `NO_PROXY=127.0.0.1,localhost` because that shell routes HTTP through a proxy.

## Implementation contract

Preserve the current uncommitted UI overhaul, published snapshots, role permissions, existing backups, UTC storage and guild-local recurring clock times. Each configured raid retains one occurrence per week; guilds can use different raid profiles for different recurring nights. Series generation creates drafts and never publishes or sends messages automatically. Firm availability remains separate from tentative times; tentative players must not make a roster appear guaranteed.

New online data must round-trip through the existing atomic save pipeline and be validated server-side. Discord interaction identity comes only from verified Discord signatures and is checked against guild membership and the current published roster. Hosted deployment, real Discord messages, and enabling delivery are separate from local implementation and verification.

## Verification

Add focused model, optimizer, response, recurrence, permission, storage, and integration coverage. Run formatting, lint, unit/component tests, production build, browser tests, and local database/integration tests where the local services are available. Record any untested hosted setup explicitly.
