# Atomic write rollout and rollback

The migration `20261010160000_atomic_guild_writes.sql` revokes table writes that older open
WhenToRaid pages use. Coordinate this release as a maintenance window. A zero-downtime release
for old tabs requires a separate compatibility phase; do not run an unattended `db push` while
players are editing.

## Before the release

1. Announce a time when players should stop editing and close old WhenToRaid tabs.
2. Confirm a restorable Supabase database backup and record the current Pages deployment run.
3. Run `npm run db:start`, `npm run test:db`, `npm run test:integration`, `npm run check`, and
   `npm run test:e2e` against the release commit.
4. Confirm the two GitHub Actions Supabase variables point to the intended hosted project.

## Release

1. During the maintenance window, apply pending migrations to the hosted project with
   `npx supabase db push`.
2. Run the Pages deploy workflow. Its hosted schema-version gate must pass before publishing.
3. Open the deployed site in a fresh tab, sign in as a test officer and player, and verify a save,
   a refresh, and a rejected unauthorized edit. Ask players to reload any tabs left open before
   they resume editing.

The app's local draft protects edits rejected by a save, but an older page cannot use the new
RPC. Do not end the maintenance window until the new deployment and live sign-in/save checks pass.

## If the new frontend must be rolled back

1. Keep editing paused. Re-run the previously successful Pages deployment workflow to restore
   its static frontend build.
2. With a privileged direct Postgres connection to the hosted project, run the compatibility
   script as one transaction (never commit a database URL to the repository):

   ```sh
   psql "$DATABASE_URL" --single-transaction --set ON_ERROR_STOP=1 \
     --file supabase/tests/rollback/20261010160000_restore_legacy_writes.psql
   ```

3. Verify an old frontend tab can save and a second tab sees the result. The compatibility
   triggers advance guild revisions for those legacy writes. The migration's new tables and RPCs
   stay in place, so this procedure does not discard guild data.

When the new frontend is ready again, deploy it, have all old tabs close, and run
`supabase/tests/rollback/20261010160000_reenforce_atomic_writes.psql` with the same `psql` options to
remove legacy grants and triggers. Run the online integration tests and a live sign-in/save check
again. The SQL rollback and re-enforcement scripts are exercised by the pgTAP rollback test.
