# QA: Manual Checklist

Prerequisites
- Confirm that Calendar API is enabled in Apps Script (Advanced Google Service).
- Optional: set `DEBUG_SOURCE_CAL_ID` or `DEBUG_EVENT_ID` in Script Properties if you need an explicit calendar/event selection.

Run tools
- `debugListCalendars()` -- list available source calendars.
- `debugSync()` -- run sync for a source (auto-selected, or `DEBUG_SOURCE_CAL_ID`).
- `debugSyncByCalendar()` -- run sync only for `DEBUG_SOURCE_CAL_ID`.
- `debugListEvents()` -- list recent events in the source (auto-selected, or `DEBUG_SOURCE_CAL_ID`).
- `debugSyncByEvent()` -- process a single event (auto-selected, or `DEBUG_SOURCE_CAL_ID` + `DEBUG_EVENT_ID`).

Checks
1) Create event -> Busy appears
   - Create a normal (not all-day, not free) event in the source within the 7/45 day window.
   - Run `debugSyncByCalendar()`.
   - Expectation: a Busy slot appears in primary at the same time.

2) Time change -> Busy updates
   - Change the time of an existing event.
   - Run `debugSyncByCalendar()`.
   - Expectation: the Busy slot updates to the new time.

3) Cancel/delete -> Busy removed
   - Cancel or delete the event.
   - Run `debugSyncByCalendar()`.
   - Expectation: the matching Busy slot is removed.

4) RSVP statuses
   - Create an event that invites you and set the status:
     - accepted -> Busy is created
     - declined / needsAction / tentative -> Busy is not created
   - Run `debugSyncByCalendar()` for each status.

5) All-day and free do not create Busy
   - Create an all-day event and a separate event with transparency=transparent.
   - Run `debugSyncByCalendar()`.
   - Expectation: Busy slots are not created (or removed if they existed).

6) Repeat runs without duplicates
   - Run `debugSyncByCalendar()` 2-3 times.
   - Expectation: exactly one Busy slot per event (no duplicates).

7) IGNORE_KEYWORD ignores an event
   - Add the keyword `ignore-busy` to the event summary or description (case-insensitive).
   - Run `debugSyncByEvent()` or `debugSyncByCalendar()`.
   - Expectation: Busy is not created; if it existed, it is removed.
   - Remove the keyword and rerun.
   - Expectation: Busy is created again.
