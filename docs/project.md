# BusyCalTimeReplicator

## Goal
Build a simple Google Apps Script that aggregates busy time from all connected calendars in the current account (including subscribed/shared calendars) into a single target calendar -- the primary calendar of the same account -- by creating/updating/deleting Busy placeholder events. The script is meant to make the primary calendar reflect total busy time without details so it can be used as a "public" or "work" view.

## What the script does
1. Periodically (on a schedule) checks for changes in events across all connected calendars in the account (except primary).
2. For each event that should count as busy time, it creates/maintains a Busy placeholder event in the primary calendar with the same time window.
3. If the source event changes (time), the placeholder is updated.
4. If the source event is canceled/deleted or no longer qualifies as busy time, the placeholder is removed.
5. The script does not prevent conflicts. It only reflects busy time.

## Where it runs
The script runs on Google's side (Google Apps Script) within the account.

## Settings (constants)
- RUN_FREQUENCY_MINUTES (trigger interval, e.g., 10)
- WINDOW_PAST_DAYS and WINDOW_FUTURE_DAYS (initial scan window; currently 7 days back and 45 days forward)
- BUSY_SUMMARY (placeholder summary, default "Busy")
- IGNORE_KEYWORD (keyword to ignore, default "ignore-busy")

## Event sources (how calendars are selected)
The script fetches the calendar list from CalendarList in the current account (including subscribed/shared calendars) via Calendar API.
Source calendars = all calendars from CalendarList except the primary one (the target calendar for placeholders).

## Target calendar
Placeholders are created only in the primary calendar of the current account (calendarId "primary").

## Minimum event filtering rules
A source event is not considered busy and must not have a placeholder if:
- all-day (event.start.date exists instead of start.dateTime)
- cancelled (event.status == "cancelled")
- free (event.transparency == "transparent")
- summary or description contains IGNORE_KEYWORD (case-insensitive)

If a placeholder exists for such an event, it is removed.

## Rule: "Invites only block time after Yes"
If an event is an invitation where you can respond Yes/No/Maybe, it counts as busy time only after "Yes".
Definition and rules:
1. If an event has attendees and one attendee has self=true, it is an RSVP event.
2. For RSVP events, busy time is counted only if attendee.self=true has responseStatus == "accepted".
   If responseStatus == "needsAction" (not answered), "declined" (No), or "tentative" (Maybe), busy time is not created and any existing placeholder is removed.
3. If an event has no attendee.self=true (no RSVP context), it is treated as a normal event and, if it passes the base filters (not all-day, not cancelled, not free, and without IGNORE_KEYWORD), it counts as busy time by default.

## Source-to-placeholder linkage
Each Busy placeholder in the primary calendar stores extendedProperties.private:
- managed flag: marker "created by this script"
- source calendarId: the source calendar containing the original event
- source eventId: the original event ID
- source updated timestamp: the original event.updated (for diagnostics)
- fingerprint: hash of fields that affect busy time (start/end/status/transparency + RSVP status when applicable)

With this info, the script finds the placeholder for update/removal and avoids duplicates on repeated runs.

## What a Busy placeholder looks like
The placeholder event is created in the primary calendar with these properties:
- summary: "Busy"
- visibility: "private"
- transparency: "opaque"
- start/end: copied from the source event (dateTime + timeZone)
- attendees: absent (empty array)
- description: copied summary from the source event plus the URL to the event in the original calendar
- extendedProperties.private filled with the service keys (see above)

## Sync algorithm (minimally correct)
The script keeps a syncToken per source calendar (source calendarId) to process only changes.
For each sourceCalId:
1. Get syncToken from PropertiesService using key "syncToken_{sourceCalId}".
2. If syncToken exists:
   - call Calendar.Events.list(sourceCalId) with syncToken and showDeleted=true (incremental changes)
   - process items
   - store nextSyncToken
3. If syncToken does not exist (initial run):
   - compute timeMin = now - WINDOW_PAST_DAYS
   - compute timeMax = now + WINDOW_FUTURE_DAYS
   - call Calendar.Events.list(sourceCalId) with timeMin/timeMax and showDeleted=true
   - process all items (with pagination)
   - store nextSyncToken
4. If the API returns 410 "sync token is no longer valid":
   - delete syncToken_{sourceCalId}
   - stop processing this source in the current run
   - the next run will perform an initial scan

## Processing each source event
For each event:
1. If summary/description contains IGNORE_KEYWORD:
   - delete placeholder (if any)
   - stop processing
2. If event.status == "cancelled":
   - delete placeholder (if any)
   - stop processing
3. If all-day or transparency == "transparent":
   - delete placeholder (if any)
   - stop processing
4. If RSVP event (attendee self=true exists):
   - if responseStatus != "accepted": delete placeholder and stop
   - otherwise (accepted): create/update placeholder
5. If not an RSVP event: create/update placeholder

## Finding an existing placeholder
The placeholder is searched in the primary calendar by extendedProperties.private:
- source calendarId == sourceCalId
- source eventId == event.id

If 0 found -- create.
If 1 found -- compare fingerprint and update only if changed.
If >1 found -- keep one, delete the rest, then bring the remaining one to the correct state.

## Loop protection
The script must not read primary as a source (excluded at calendar selection).
Additionally: if primary is mistakenly included as a source, the script ignores events with managed flag set (its own placeholders) to avoid duplication.

## Parallel runs
Uses LockService. If the lock is not acquired, the run exits without changes.

## Public functions
- init(): creates a time-driven trigger for syncAll() if one does not exist
- syncAll(): main loop that gets the calendar list via CalendarList, excludes primary, and syncs each source
- resetState(): deletes all syncToken_* keys from PropertiesService (full reset)

## Debug/manual function runs
To run manual checks via the Apps Script UI, public debug functions must be parameterless and read values from Script Properties. This is required because the UI does not support passing arguments.
Recommended keys:
- DEBUG_SOURCE_CAL_ID
- DEBUG_EVENT_ID

Available debug functions:
- debugSyncByCalendar()
- debugSync()
- debugSyncByEvent()
- debugListEvents()
- debugCreateDuplicate()
- debugList()

## Recurring events
In this version, singleEvents is not used. The script works with series master events. This was done for simplicity and minimal code. If you need accurate busy time per instance, it requires a separate enhancement.

## API access requirements
1. The Apps Script project must enable Advanced Google Service: Calendar API.
2. On the first run of init()/syncAll(), the user confirms OAuth permissions for calendar access and the calendar list.

## Solution constraints
- Sync delay up to the trigger interval.
- Does not prevent double booking; only reflects busy time.
- With many calendars/events, quota limits may apply. In that case increase RUN_FREQUENCY_MINUTES and/or shrink the initial scan window.
- Without singleEvents, recurring events may be incomplete.

## Readiness criteria
1. RUN_FREQUENCY_MINUTES is set in code.
2. After running init(), a trigger is created.
3. The script finds all connected calendars (except primary) and starts syncing.
4. Busy placeholders appear in the primary calendar for qualifying source events within the WINDOW_PAST_DAYS/WINDOW_FUTURE_DAYS window.
5. Changing the source event time updates the placeholder.
6. Canceling/deleting the source event removes the placeholder.
7. RSVP events block time only when responseStatus == accepted; for tentative/declined/needsAction no placeholders exist.
8. IGNORE_KEYWORD in summary/description prevents placeholder creation and removes existing ones.
9. Repeated runs do not create duplicates.

## Versioning and deploy (required, simple mode)
The project is stored in Git and synced to Apps Script via clasp without build steps or TypeScript.

## Minimal repository structure
- Code.gs
- appsscript.json
- Makefile
- package.json (clasp as devDependency) or clasp installed globally

## Makefile (minimal set)
- make install: install dependencies (if clasp via npm)
- make login: authorize clasp
- make create: create a new Apps Script project and link the repo (get scriptId)
- make push: push Code.gs and appsscript.json to Apps Script
- make pull: pull code from Apps Script into the repo
- make deploy: make push
- make open: open the project in a browser (clasp open)

## Transfer to another account
1. Sign in to the target Google account (clasp login).
2. make create (create a new Apps Script project).
3. make deploy (push the code).
4. Run init() once in the Apps Script UI and approve permissions.
