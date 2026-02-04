# Busy Cal Time Replicator

Simple script that mirrors busy time from all connected calendars into your
primary calendar using "Busy" placeholders.

This helps BusyCal (or other calendar tools) show a single, accurate view of
your availability even when you have multiple calendars.

## Quick Start (for use)

1. Open https://script.google.com and create **New project**.
2. Rename the project (example: "Busy Cal Time Replicator").
3. Open `Code.gs` in this [repo](https://github.com/henryh/busy-cal-time-replicator/blob/main/Code.gs), copy all contents, and paste into the editor.
4. Click plus in the **Services** tab (left sidebar) and enable **Google Calendar API** with default params.
7. Save the project.
8. Run `init()` once (top dropdown) and approve permissions and add exception. That is it. The script will sync every 10 minutes automatically.
9. In 10 minutes check the script runs successfully on the **Executions** tab (left sidebar) and busy events are visible in Calendar.

## What you will see

- Your primary calendar will get "Busy" placeholder events.
- They mirror busy time from your other calendars.
- If an event changes or is removed, the placeholder updates or disappears.

## Implemented Features

- Busy placeholders created/updated in primary calendar with metadata in
  `extendedProperties.private`.
- Filters: all-day, cancelled, free (transparent), RSVP not accepted, and
  `ignore-busy` keyword in summary/description are ignored (no Busy placeholder;
  existing placeholders removed).
- Dedupe: if multiple placeholders match the same source event, extras are
  deleted and the remaining one is updated.

## Supported

- Google Calendar + Apps Script (this repository).
- BusyCal or any calendar client that reads your Google primary calendar.

## Not supported

- Direct sync to third-party calendars (Outlook, iCloud, etc.).
- Two-way sync or conflict resolution between calendars.
- Custom UI or web app interface.

## Privacy / Data access

- The script runs in your Google account.
- It reads events from your non-primary calendars and writes Busy placeholders
  to your primary calendar only.
- No data leaves Google; this repo does not run any external servers.

## Requirements

- Node.js + npm (for clasp).
- Google account with access to Calendar API.
- Advanced Google Service enabled in Apps Script: Calendar API.

## Install (first time, with clasp)

1. Install deps:
   - `make install`
2. Authenticate clasp:
   - `make login`
3. Create a new Apps Script project and bind this repo:
   - `make create`
4. Push code to Apps Script:
   - `make push`
5. Open the script in the browser:
   - `make open`
6. In Apps Script UI:
   - Open **Services** (left sidebar) -> **+** -> enable **Calendar API**.
   - Click **Project Settings** -> ensure it is linked to a Google Cloud Project.
   - Open that Cloud Project in **Google Cloud Console** and enable **Google Calendar API**.
7. In Apps Script UI, run `init()` once and accept permissions.

For local development and debugging via `clasp`, you must enable the Apps Script API for your Google account first. `https://script.google.com/home/usersettings`

## Permissions (what to approve)

The script needs access to:
- Read your calendar list and events (to detect busy time).
- Create/update/delete events in your **primary** calendar (to manage Busy placeholders).

When prompted, approve Google Calendar permissions for the account that owns the calendars.

## Run / Operate

- `init()` creates the time-driven trigger for `syncAll()` if it doesn't exist.
- `syncAll()` runs periodically and syncs busy placeholders from all calendars
  (except primary) into the primary calendar.
- `resetState()` clears stored sync tokens; use when you need a full resync.

## Troubleshooting (common issues)

- "Authorization required" or permissions prompt keeps appearing:
  - Run `init()` once manually and approve **all** requested permissions.
  - The first manual run is required so Google can grant access.
- "Calendar API has not been used" or "API disabled":
  - In Apps Script, ensure **Services -> Calendar API** is enabled.
  - In Google Cloud Console for the linked project, enable **Google Calendar API**.
- Nothing syncs / no Busy events appear:
  - Wait 10 minutes after running `init()`, or run `syncAll()` manually once.
  - Confirm you have at least one non-primary calendar with busy events.

## Working with the script

- Edit `Code.gs` locally.
- Push changes with `make push`.
- Pull remote changes with `make pull` if needed.

## Commands

- `make install` - install dependencies (clasp).
- `make login` - authenticate clasp.
- `make create` - create and bind a new Apps Script project.
- `make push` - upload local code to Apps Script.
- `make pull` - download remote code into the repo.
- `make deploy` - deploy the script.
- `make open` - open the Apps Script project in the browser.

## Debug

Debug functions can auto-pick a source calendar/event. You can optionally set
Script Properties to force the selection:
- `DEBUG_SOURCE_CAL_ID` (calendar ID, not primary)
- `DEBUG_EVENT_ID` (event ID)

Available functions:
- `debugListCalendars` - list available source calendars.
- `debugSync` - run sync for a source calendar (auto or `DEBUG_SOURCE_CAL_ID`).
- `debugSyncByCalendar` - run sync only for `DEBUG_SOURCE_CAL_ID`.
- `debugSyncByEvent` - apply create/update/remove logic for one event (auto or
  `DEBUG_SOURCE_CAL_ID` + `DEBUG_EVENT_ID`).
- `debugListEvents` - list recent events in a source calendar (auto or
  `DEBUG_SOURCE_CAL_ID`).
- `debugCreateDuplicate` - create a duplicate Busy placeholder for the current
  source event (useful to verify deduplication).
- `debugList` - list managed Busy placeholders in the primary calendar for a
  short time window.

## Issues and contributing

- Use GitHub Issues for bugs or feature requests.
- Pull requests are welcome; keep changes focused and small.
