# UI overhaul

## Design contract

WhenToRaid is a recurring guild coordination tool. Preserve its dark Warcraft identity, class colors, scheduling rules, published roster snapshots, permissions, timezone handling, and recovery paths.

- Players: see their next published assignment, respond, and update weekly availability. Completed onboarding must not occupy a full panel.
- Officers: choose a time, edit a roster, and review responses through separate workspace tabs. Publication status and publishing remain available above these views.
- Desktop: compact persistent navigation, readable operational text, roster and bench side by side when space permits. Damage players use a wrapping grid rather than one tall column.
- Phones: three personal destinations and a More menu; compact expandable availability days and a separate character view. Controls must be reachable without traversing the entire week.
- Visuals: charcoal surfaces, ivory text, restrained gold actions, blue published/assigned status, green confirmations, red problems. Use shared tokens and SVG icons without a new dependency.
- Targets: 1440x1000, 390x844, and a 320px narrow-layout stress check. Planner suggestions and the selected roster should begin within the first viewport at the primary targets with the sample guild.
- Accessibility: keyboard-operable tabs/disclosures, visible focus, labelled inputs, touch-friendly actions, reduced-motion support, status conveyed in text as well as color.

The pre-change rendered review showed suggestions at approximately 1050px and the roster at 2300px on desktop; the mobile roster began around 3100px. A completed onboarding checklist occupied a full home panel, and the mobile range editor expanded seven forms.

## Content states to verify

Loading and response-refresh feedback; no published assignment and no check-ins; failed response loading and retry; partial rosters and missing responses; successful edits/publication/confirmation; player read-only planning and closed check-ins. Preserve recovery of unsaved online drafts. Record authenticated service limitations separately from local UI evidence.

## Validation

Implemented and reviewed locally on October 12, 2026.

- `npm run check`: lint, formatting, 44 unit-test files / 372 tests, and the production build passed.
- Desktop Chromium and Pixel 7 browser coverage: 34 passing cases and 2 intentional platform skips, including the corrected availability-copy selector rerun. Existing setup, roster editing, multiple raids, publication, response/replacement, calendar export, mocked Discord posting, backup restore, and unsaved-change protection passed.
- New browser checks cover task tabs and keyboard selection, copying availability without deleting existing times, Undo, opening the published roster from Home, phone navigation and character selection, and 320px layouts with long names.
- Isolated rendered fixtures exercised loading, empty, error/retry, partial responses, complete confirmations, read-only player rosters, and closed check-ins at desktop and phone sizes. These mount the real views and mock the transport boundary; they do not write to an online guild.
- Keyboard checks passed for the skip link without changing the route, tab arrows and Home/End, and visible focus. Reduced-motion styles remove control transitions. Checked palette text contrasts range from 6.73:1 to 11.97:1 against the control surface; class-name colors are at least 5.41:1 against roster cards. This is targeted accessibility verification, not a complete assistive-technology audit.
- Captures across all primary screens at 1440x1000, 390x844, and 320x780 showed no horizontal overflow or uncaught JavaScript errors.

Measurements use the sample guild, closed disclosures, and the relevant active tab. Heading positions indicate where the task begins; they do not imply the entire roster fits on one screen.

| Measurement                    |   Before |   After |
| ------------------------------ | -------: | ------: |
| Desktop suggestions heading    | ~1,050px |   615px |
| Desktop roster heading         | ~2,300px |   615px |
| Phone roster heading           | ~3,100px |   638px |
| Phone availability page height | ~4,194px | 1,416px |

The measurements above record the first rendered review. Its ignored `test-results/ui-overhaul/` captures were temporary test output and were replaced by the subsequent browser run. Current administration captures are described below.

Live Discord delivery, authenticated Supabase access, and database policies were not exercised against a real guild. Existing unit/browser coverage and isolated client permission fixtures passed. No backend schema or authorization policy was changed, and no deployment was made.

## Administration continuation — October 13, 2026

- Guild settings now has keyboard-operable **Raid rules**, **Connections**, and **Backups** tabs. The form stays mounted across tab changes, so draft values and the existing leave guard survive. An unsaved-rules notice brings the user back to their draft. Officers can discard edits directly; players see disabled rules without a Save action.
- Invalid inputs inside collapsed settings sections are revealed before native validation focuses them. Reset confirmations can be cancelled and clear when switching settings sections.
- Guild members now shows the selected week, a check-in summary, a date picker that snaps to Monday, compact role/check-in filters, and a clear-filters action with keyboard focus returned to search. Online invitations sit in an expandable section. Players without an active character get an explicit label.
- Visual polish includes a single-line Add player action, search icon, stable numeric counters, balanced headings, and a distinct border for guild reset actions. The directory uses a desktop table and phone cards with the existing class colors.

Validation:

- `npm run check` passed: lint, formatting, 44 unit-test files / 376 tests, and production build. After the final focus changes, all 25 affected component tests passed again; the browser test server rebuilt the final production code.
- Desktop Chromium and Pixel 7 coverage: 42 passing cases and 2 intentional platform skips across the full run and corrected administration rerun. The initial new directory cases used an incorrect label selector; replacing it with the accessible combobox role made both pass. All 8 administration cases passed on rerun.
- Browser checks cover retained drafts, tab keyboard navigation, focus after review/discard/clear actions, invalid collapsed inputs, combined member filters, week changes, backup access in the first viewport, and no horizontal overflow at 320px.
- Reviewed rendered captures at 1440×1000, 390×844, and 320×780. Current artifacts are under ignored `test-results/administration-review/`: `members-viewport.png`, `320-members-viewport.png`, `settings-backups.png`, and `320-settings-*.png` in the corresponding test/project subdirectories. Regenerate with `npx playwright test e2e/administration.spec.js --workers=2 --output=test-results/administration-review`.

This continuation was tested locally with seeded guild data and mocked Discord delivery. Live online services and deployment remain outside this validation.
