# Raid workflow improvement plan

Status: delivered in two parts. Part 1 (this branch) covers everything that runs in the app. Part 2 (a follow-up branch) adds the server workers for Discord delivery, reminders and calendar feeds (M5, M6, M10). Scope approved: all 10 major and 10 minor recommendations from the October 11 review.

## Outcome

Players can join, supply availability, see their assignments, and report changes with fewer steps. Officers can plan across raids, publish clear changes, and rely on saved plans, Discord messages, and personal calendars staying consistent.

## Workstreams and acceptance

| ID  | Improvement                    | Acceptance                                                                                                                                      | Status        |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| M1  | Personal raid dashboard        | Published upcoming assignments show character, role, local time, and remaining onboarding actions.                                              | Done          |
| M2  | Mobile availability editor     | Accessible day/time range controls complement painting; overnight and timezone behavior uses the existing UTC model.                            | Done          |
| M3  | Guided onboarding              | Joining leads to a visible character/availability checklist; setup makes online, browser-only, and demo modes explicit.                         | Done          |
| M4  | Confirmations and late changes | Members can confirm or report a problem after the deadline; officers see affected assignments and eligible replacements.                        | Done          |
| M5  | Targeted scheduled reminders   | Configurable, disabled by default; only missing check-ins or upcoming rostered players are notified, with deduplication and frequency controls. | Done (Part 2) |
| M6  | Reliable Discord lifecycle     | Delivery follows committed publication; cancel/withdraw updates existing posts; failures persist with retry.                                    | Done (Part 2) |
| M7  | Concurrent editing             | Independent row changes merge without recovery; conflicting edits are preserved for explicit review.                                            | Done          |
| M8  | Safe existing-profile claims   | Generic invites cannot claim arbitrary existing members; member-specific invitations constrain the claim on the server.                         | Done          |
| M9  | Cross-raid scheduling          | Suggestions and replacements exclude players committed to overlapping published raids; conflicts explain the other commitment.                  | Done          |
| M10 | Personal calendar subscription | Revocable opaque subscription includes only the member's published assignments, stable event IDs, updates, and cancellations.                   | Done (Part 2) |
| m1  | Active raid header             | Raid, date, time, and publication status lead the planner.                                                                                      | Done          |
| m2  | Publication change summary     | Officers can review time, roster, and character/role changes before republishing.                                                               | Done          |
| m3  | Member search and filters      | Search matches players and characters; role and check-in filters work together.                                                                 | Done          |
| m4  | Bulk attendance                | Mark everyone attended with one action, preserve explicit exceptions, and offer Undo.                                                           | Done          |
| m5  | Availability Undo              | A paint gesture, day toggle, range edit, or unavailable action can be undone without affecting other people.                                    | Done          |
| m6  | Availability source            | Officers can distinguish inherited usual schedules from explicit weekly responses.                                                              | Done          |
| m7  | Contextual save feedback       | Availability shows saving, saved, and failure status next to edits.                                                                             | Done          |
| m8  | Exact local dates              | Selection/tap exposes full local date and time, including midnight crossings and DST.                                                           | Done          |
| m9  | Role-aware instructions        | Player copy does not instruct officer actions; raid count reflects configuration.                                                               | Done          |
| m10 | Actionable publication errors  | Errors identify affected players/roles/overlaps and provide a direct correction action.                                                         | Done          |

## Sequence

1. Establish contracts and tests for member services, concurrent saves, and profile-specific invitations.
2. Build player dashboard/onboarding/availability and officer planner improvements in parallel, with separate file ownership.
3. Integrate server services into the dashboard, planner, and settings; preserve browser-only behavior.
4. Run formatting, lint, unit/component tests, production build, browser tests, database authorization tests, and local integration tests.
5. Review authorization, private calendar access, concurrent edits, delivery retries, and browser interactions. Fix findings before delivery.

## Implementation decisions

- Use existing Svelte/Supabase architecture and reusable pure model helpers. No paid service is needed.
- Add migrations; do not rewrite applied historical migrations.
- RSVP data is separate from locked check-ins, so late reports do not bypass the check-in deadline.
- Generic invitations create new members; targeted invitations link an existing unclaimed non-officer record.
- Durable server delivery jobs follow saved plans. Scheduled notifications remain off until an officer opts in.
- Calendar links are private bearer links with explicit revocation; do not put service keys or webhook secrets in feeds.
- Keep the existing fixed roster per raid/session. No per-boss planning.
- Implement locally on `feat/raid-workflow-improvements`. Hosted migration, worker deployment, and enabling scheduled external delivery are separate rollout steps after verification.

## Part 1 notes

- Player responses (M4) use only the `raid_responses` part of the original services migration (`20261013120000_raid_responses.sql`). Calendar, reminder and delivery tables move to Part 2 with the workers that use them, so the hosted database never holds unused tables.
- Availability Undo restores only the player's own check-in for that week, so another player's concurrent change is neither reverted nor blocks Undo.
- New guilds open on **My raids**; the Planner remains one click away.

## Verification evidence (Part 1, 2026-10-11)

- `npx vitest run`: 41 files, 350 tests passed.
- `npx supabase test db` (local, after `supabase db reset`): 9 files, 112 tests passed, including the new `raid_responses.test.sql`.
- `npx playwright test`: 25 passed (desktop + mobile), including the new `e2e/responses.spec.js`.
- `npm run lint`, `npx prettier --check .`, `npm run build`: clean.
- Not yet run against the hosted database. Push both migrations before merging (the deploy checks `app_schema_version`).

## Part 2 notes

- Online guilds post rosters from the server. Saving a publication, withdrawal or cancellation queues an edit of a roster already in Discord (`capture_raid_publication` trigger), and `raid-dispatch` sends it. Failures retry with backoff; an interrupted send is marked uncertain so an officer checks Discord before retrying, rather than risking a duplicate. Browser-only guilds still post straight from the page.
- The server's roster message is plainer than the browser's (role and character per line, Discord timestamp). An existing post changes to that format the first time the server edits it.
- Reminders (missing check-ins; upcoming raids, optionally only unconfirmed players) are off until an officer turns them on in Guild settings. Recipients are resolved at send time, and each reminder has a unique key, so scheduler retries never repeat it.
- Calendar links: `raid-calendar?token=…` serves only the member's own published assignments with stable UIDs and sequence numbers; cancellations and roster removals stay in the feed as cancelled events. The database stores only a SHA-256 of the token; creating a new link or "Turn off" revokes the old one.

## Rollout (Part 2)

1. Push migrations `20261013130000` and `20261013140000` to the hosted project.
2. Deploy the functions: `npx supabase functions deploy raid-dispatch raid-calendar` (both use `verify_jwt = false` from `supabase/config.toml`; each checks its own caller).
3. Set the scheduler secret: `npx supabase secrets set RAID_DISPATCH_SECRET=<long random value>`.
4. In the SQL editor, store the same secret and the function URL in Vault (the cron job is a no-op until both exist):
   `select vault.create_secret('https://frqvahakcxrvkgjzegvv.supabase.co/functions/v1/raid-dispatch', 'raid_dispatch_url');`
   `select vault.create_secret('<same value>', 'raid_dispatch_secret');`
5. Merge, then test with a real channel: post a roster, republish, withdraw, and try a calendar link in Google Calendar.

## Verification evidence (Part 2, 2026-10-11)

- `npx vitest run`: 367 passed.
- `npx supabase test db`: 141 passed, including `raid_delivery.test.sql` (queue, claim, lease, checkpoint, republish edit, backoff, retry, calendar feed and revocation, reminders, confirmed players skipped).
- `npm run test:integration` with `supabase functions serve`: 17 passed, including a real calendar-feed round trip and officer/outsider dispatch authorization.
- The pg_cron → pg_net → `raid-dispatch` path ran locally with Vault secrets and returned 200.
- `npx playwright test`: 25 passed. Lint, prettier, build: clean.
- Not tested against a real Discord channel (scheduled for the Oct 18 webhook test).
