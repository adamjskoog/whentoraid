# Discord bot overhaul

The bot should answer three questions without making a player leave Discord: **When is my next raid? Am I playing? What does the team still need?** WhenToRaid's existing availability planner, alternate characters, roster rules, and bench fairness provide the foundation. The Discord experience should make those decisions easy to see and act on.

## Implemented in this change

| Command                      | Result                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/raid next`                 | Next visible raid, local timestamps, signup role gaps, personal status, and links to the actual signup/confirmation posts.                                        |
| `/raid upcoming [page]`      | Next four weeks, five raids per page. Members see posted signups and published rosters; officers also see drafts.                                                 |
| `/raid mine [page]`          | Personal signups, provisional bench positions, selected character/spec, late changes, and current published assignment confirmations.                             |
| `/raid roster [raid] [page]` | Every player and character name on the roster, bench, tentative list, and absence list. Choose a raid number from `/raid upcoming`; the default is the next raid. |
| `/raid readiness [page]`     | Officer-only report: published roster role gaps, confirmed/unconfirmed/unavailable counts, and separate signup coverage.                                          |
| `/raid help`                 | A player guide to commands, character/spec selection, provisional signups, and roster confirmation.                                                               |

Every command reply is private. Signup cards now state the exact missing roles and call out slotted late arrivals, tentative players, and players without a role. A full signup list is never presented as proof that the raid is ready. Bench signups do not fill another role's shortage, and provisional signup order does not override the officers' published roster.

Roster lists show the full character name and the player name when they differ, plus role/spec details. Before publication, role slots and the bench follow signup order. After publication, the roster is the officers' selected team and the bench contains signed-up or late players outside it. Tentative and absent signup answers remain separate, including when an officer has already rostered that player. Empty groups say **None**. Large lists continue on private pages or additional public signup messages: no names are replaced with “and N more.” The delivery worker edits those messages in place, removes surplus continuations when lists shrink, and puts the buttons on the last message.

Guild settings → Connections includes an **Enable / update raid commands** action and a command guide. Registration upserts only `/raid` for the connected server; other application commands stay intact. It does not post channel messages.

The existing signup buttons, character/spec menus, reminders, published roster responses, and delivery retries continue to work.

## Access and consistency

- Ed25519 signature verification and immediate private acknowledgement happen before background database work.
- The database resolves the requesting Discord user through guild membership and an OAuth-verified server connection. A manually entered server ID is insufficient.
- Multiple memberships in one server resolve by the configured bot channel. Ambiguous connections return an explanation rather than picking a guild.
- Members never receive officer confirmation aggregates or unannounced drafts. Announced signup lists and published roster names are visible to fellow guild members; individual roster confirmations remain private to their owner and officers.
- Confirmation validity follows the current character, role, start, and end assignment. Changing any of these makes the old response count as unanswered.
- Message links must belong to the current connected channel. Confirmation links are withheld while a roster edit is awaiting delivery.
- Reads do not create drafts, sign anyone up, publish rosters, or send reminders. No privileged Discord gateway intents are required.
- The overview is bounded to 28 days and 50 raids; the UI serves five per page. Existing role target semantics apply: zero means an unlimited signup role.

## Rollout

1. Apply `20261020120000_discord_command_hub.sql` to the hosted Supabase project. The deployment schema check requires this version.
2. Deploy `raid-interactions`, `discord-connect`, and `raid-dispatch` together so the command handler, setup action, and enhanced signup cards use the same shared code.
3. Deploy the frontend. Keep the existing `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and HTTPS `WHENTORAID_APP_URL` settings.
4. An officer opens Connections and clicks **Enable / update raid commands** for each connected Discord server. Existing bot installations already include the application command scope with the bot scope. Discord's **Use Application Commands** permission controls whether members can invoke commands in a channel.
5. Verify `/raid help`, `/raid next`, `/raid mine`, and `/raid roster` with a member account, and `/raid readiness` with an officer account. Check a character/spec change, a benched signup, a republished assignment, and names across continuation pages. Existing signup cards adopt the improved summary on their next refresh.

Command registration and production deployment are not performed by the code change itself. Live Discord verification requires a deployed endpoint and connected test server.

## Competitive direction

Raid-Helper already has extensive event settings, signup notes, custom templates, recurring events, reminders, and roster composition tooling. These are baseline expectations, not evidence that a new bot is superior. Sources checked October 16, 2026: [advanced settings](https://raid-helper.dev/documentation/advanced), [premium features](https://raid-helper.dev/premium/), and [setup guide](https://raid-helper.dev/documentation/intro).

The opportunity is to connect scheduling and participation: choose a viable time from real availability, explain why a roster fits, keep alternate-character choices consistent, and make late changes actionable. This change brings discovery and personal status into Discord; it does not establish complete feature parity with Raid-Helper.

Next substantial capabilities:

1. Officer event creation and editing in Discord, including recurring schedules and timezone-safe date input.
2. Flexible role/alternate-character offers and an explained roster proposal using the existing optimizer, followed by officer publication.
3. Late-arrival times and signup notes, with role-specific replacement suggestions after a decline.
4. Opt-in, targeted reminder policies and delivery diagnostics that avoid repeated or irrelevant pings.
5. Attendance review and fair bench rotation visible to players, with transparent reasons and officer overrides.

Discord API references: [application commands](https://docs.discord.com/developers/interactions/application-commands), [interaction acknowledgements](https://docs.discord.com/developers/interactions/receiving-and-responding).
