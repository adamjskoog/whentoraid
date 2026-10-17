# Discord acceptance run

Real-channel test of the online Discord lifecycle (audit risk #2 in [AUDIT_2026-10-16.md](AUDIT_2026-10-16.md)). Started October 16, 2026; paused after step B. **Must be finished before the November 4, 2026 release.**

Test guild: **Unsanction Raid** (bot channel in the "Distracted Minds" Discord server, no webhook). The demo guild "The After Hours (demo)" has no Discord link, so publishing there never posts.

## Setup (done October 16)

- PR #27 merged; Edge Functions redeployed with `@supabase/supabase-js@2.117.2`.
- Vault `raid_dispatch_secret` and Edge secret `RAID_DISPATCH_SECRET` created (same random value). Before this, the 5-minute `raid-dispatch` cron job exited without calling anything, so reminders and automatic retries never ran.
- First scheduled call after the fix: 200 `{"results":[]}` at 23:55 UTC.

## Results

| Step | Action                                             | Result                                                                                                                                                                                    |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | Publish roster with "Also post to Discord"         | **Pass.** Week 2026-10-26 / `raid-20` posted as message `1560807477124141088`; delivery `sent` on attempt 1, ~4 s after publishing; recorded in `guild_discord.posts`.                    |
| B    | Click **Confirm**, then **Can't attend**           | **Pass.** Two interactions recorded once each; `raid_responses` ends `unavailable`, tied to publication `1792195897756`; app Responses tab matched.                                       |
| C    | Change roster → **Publish draft changes**          | Not run. Expect the same message edited (no new post), delivery `version` 2, previous answers no longer current.                                                                          |
| D    | **Withdraw**, then publish again                   | Not run. Expect "ROSTER WITHDRAWN", then the roster again.                                                                                                                                |
| E    | **Cancel** the raid                                | Not run. Expect the post to show cancelled and buttons to stop accepting answers.                                                                                                         |
| F    | Turn on check-in and upcoming reminders            | Not run. Settings → Discord reminders; with a published raid inside the lead time, expect one reminder of each kind within ~5 min and no duplicate rows (`delivery_key`) over later runs. |
| G    | Calendar link: create, subscribe, change, turn off | Not run. Home → Create calendar link; a change shows on refresh; the link stops working after Turn off link.                                                                              |
| H    | Disconnected viewer                                | Not run. Phone offline, edit on desktop, reconnect: the change appears without a reload.                                                                                                  |

After the run, also run the database and integration suites on the final revision (CI covers both).

## Checking results

`npx supabase db query --linked "<sql>"` reads the hosted database. Useful queries:

- Deliveries: `select kind, action, status, attempts, version, message_ids, week, raid_id, last_error, updated_at from public.discord_deliveries order by updated_at desc limit 5`
- Scheduler calls: `select status_code, left(content,200), created from net._http_response order by created desc limit 3`
- Responses: `select week, raid_id, status, publication, updated_at from public.raid_responses order by updated_at desc limit 3`

Never select secret values; check only that `vault.secrets` names exist.

## Found during the run

- In a guild with no Discord channel, the Planner says so only inside the collapsed "Publication & sharing options", so it is easy to publish without noticing nothing will post. Show it next to the Publish button.
