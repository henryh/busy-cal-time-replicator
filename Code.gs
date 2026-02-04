// =============================================================================
// TABLE OF CONTENTS
// 1) Constants
// 2) Entrypoints
// 3) Sync (state, windows, source selection, main flow)
// 4) Filters & decisions
// 5) Busy placeholders (create/update/remove/cleanup)
// 6) Debug entrypoints
// 7) Debug helpers (Debug object)
// 8) Error helpers
// =============================================================================

// =============================================================================
// Constants
// =============================================================================
const RUN_FREQUENCY_MINUTES = 10;
const WINDOW_PAST_DAYS = 7;
const WINDOW_FUTURE_DAYS = 45;
const TARGET_CALENDAR_ID = 'primary';
const BUSY_SUMMARY = 'Busy';
const IGNORE_KEYWORD = 'ignore-busy';
const SYNC_TOKEN_PREFIX = 'syncToken_';
const PRIVATE_PROP_MANAGED = 'bctr_managed';
const PRIVATE_PROP_SOURCE_CAL_ID = 'bctr_source_cal_id';
const PRIVATE_PROP_SOURCE_EVENT_ID = 'bctr_source_event_id';
const PRIVATE_PROP_SOURCE_UPDATED = 'bctr_source_updated';
const PRIVATE_PROP_FINGERPRINT = 'bctr_fingerprint';

// =============================================================================
// Entrypoints
// =============================================================================
function init() {
  ensureSyncTrigger();
}

function ensureSyncTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var trigger = triggers[i];
    if (
      trigger.getHandlerFunction &&
      trigger.getHandlerFunction() === 'syncAll' &&
      trigger.getEventType &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK
    ) {
      return;
    }
  }
  ScriptApp.newTrigger('syncAll')
    .timeBased()
    .everyMinutes(RUN_FREQUENCY_MINUTES)
    .create();
}

function syncAll() {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(30000);
    if (!locked) {
      Logger.log('syncAll: lock not acquired, exiting');
      return;
    }
    Logger.log('syncAll: start');
    var sourceCalIds = listSourceCalendarIds();
    for (var i = 0; i < sourceCalIds.length; i++) {
      var sourceCalId = sourceCalIds[i];
      Logger.log('syncAll: source start=%s', sourceCalId);
      try {
        var result = syncSourceCalendar(sourceCalId);
        Logger.log(
          'syncAll: source end=%s, status=%s, reason=%s, processed=%s, nextSyncToken=%s',
          sourceCalId,
          result && result.status ? result.status : '',
          result && result.reason ? result.reason : '',
          String(result && result.processed ? result.processed : 0),
          result && result.nextSyncToken ? result.nextSyncToken : ''
        );
      } catch (error) {
        Logger.log(
          'syncAll: source error=%s, message=%s',
          sourceCalId,
          summarizeError(error)
        );
      }
    }
    Logger.log('syncAll: end');
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

function resetState() {
  var props = PropertiesService.getScriptProperties();
  var entries = props.getProperties();
  var keys = Object.keys(entries);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (key.indexOf(SYNC_TOKEN_PREFIX) === 0) {
      props.deleteProperty(key);
    }
  }
}

// =============================================================================
// Sync (state, windows, source selection, main flow)
// =============================================================================
function listSourceCalendarIds() {
  var primaryId = TARGET_CALENDAR_ID;
  var pageToken;
  var ids = [];
  var seen = {};
  do {
    var response = Calendar.CalendarList.list({
      maxResults: 250,
      pageToken: pageToken,
    });
    var items = response && response.items ? response.items : [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || !item.id) {
        continue;
      }
      if (item.primary === true || item.id === primaryId) {
        continue;
      }
      if (!seen[item.id]) {
        ids.push(item.id);
        seen[item.id] = true;
      }
    }
    pageToken = response && response.nextPageToken;
  } while (pageToken);
  return ids;
}

function getWindowStart(now) {
  return new Date(now.getTime() - WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
}

function getWindowEnd(now) {
  return new Date(now.getTime() + WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);
}

function getSyncTokenKey(sourceCalId) {
  return SYNC_TOKEN_PREFIX + sourceCalId;
}

function getSyncToken(sourceCalId) {
  if (!sourceCalId) {
    return '';
  }
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(getSyncTokenKey(sourceCalId)) || '';
}

function setSyncToken(sourceCalId, token) {
  if (!sourceCalId || !token) {
    return;
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty(getSyncTokenKey(sourceCalId), token);
}

function clearSyncToken(sourceCalId) {
  if (!sourceCalId) {
    return;
  }
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(getSyncTokenKey(sourceCalId));
}

function processEventForSync(sourceCalId, event) {
  if (sourceCalId === TARGET_CALENDAR_ID && isManagedPlaceholder(event)) {
    return { action: 'skip', reason: 'managed_placeholder' };
  }
  var decision = evaluateBusyAction(event);
  if (decision.action === 'remove') {
    removeBusyPlaceholders(sourceCalId, event);
  } else if (decision.action === 'upsert') {
    upsertBusyPlaceholder(sourceCalId, event);
  }
  return decision;
}

function syncSourceCalendar(sourceCalId) {
  if (!sourceCalId) {
    return { status: 'noop', reason: 'missing_source' };
  }
  var token = getSyncToken(sourceCalId);
  if (token) {
    Logger.log('syncSourceCalendar: source=%s, mode=incremental', sourceCalId);
    return runIncrementalSync(sourceCalId, token);
  }
  Logger.log('syncSourceCalendar: source=%s, mode=initial', sourceCalId);
  return runInitialSync(sourceCalId);
}

function runIncrementalSync(sourceCalId, syncToken) {
  Logger.log('runIncrementalSync: source=%s, start', sourceCalId);
  var pageToken;
  var processed = 0;
  var nextSyncToken = '';
  var recurringMasterIds = {};
  try {
    do {
      var response = Calendar.Events.list(sourceCalId, {
        syncToken: syncToken,
        showDeleted: true,
        pageToken: pageToken,
        maxResults: 250,
        singleEvents: true,
      });
      var items = response && response.items ? response.items : [];
      for (var i = 0; i < items.length; i++) {
        recordRecurringMasterId(recurringMasterIds, items[i]);
        processEventForSync(sourceCalId, items[i]);
        processed += 1;
      }
      pageToken = response && response.nextPageToken;
      if (!pageToken && response && response.nextSyncToken) {
        nextSyncToken = response.nextSyncToken;
      }
    } while (pageToken);
  } catch (error) {
    if (isSyncTokenGone(error)) {
      clearSyncToken(sourceCalId);
      return {
        status: 'reset',
        reason: 'sync_token_expired',
        processed: processed,
      };
    }
    throw error;
  }
  if (nextSyncToken) {
    setSyncToken(sourceCalId, nextSyncToken);
  }
  removeRecurringMasterPlaceholders(sourceCalId, recurringMasterIds);
  cleanupOrphanedBusyPlaceholders(sourceCalId);
  Logger.log(
    'runIncrementalSync: source=%s, end, processed=%s, nextSyncToken=%s',
    sourceCalId,
    String(processed),
    nextSyncToken ? 'saved' : ''
  );
  return {
    status: 'incremental',
    processed: processed,
    nextSyncToken: nextSyncToken ? 'saved' : '',
  };
}

function runInitialSync(sourceCalId) {
  Logger.log('runInitialSync: source=%s, start', sourceCalId);
  var now = new Date();
  var timeMin = getWindowStart(now).toISOString();
  var timeMax = getWindowEnd(now).toISOString();
  var pageToken;
  var processed = 0;
  var nextSyncToken = '';
  var recurringMasterIds = {};
  do {
    var response = Calendar.Events.list(sourceCalId, {
      timeMin: timeMin,
      timeMax: timeMax,
      showDeleted: true,
      pageToken: pageToken,
      maxResults: 250,
      singleEvents: true,
    });
    var items = response && response.items ? response.items : [];
    for (var i = 0; i < items.length; i++) {
      recordRecurringMasterId(recurringMasterIds, items[i]);
      processEventForSync(sourceCalId, items[i]);
      processed += 1;
    }
    pageToken = response && response.nextPageToken;
    if (!pageToken && response && response.nextSyncToken) {
      nextSyncToken = response.nextSyncToken;
    }
  } while (pageToken);
  if (nextSyncToken) {
    setSyncToken(sourceCalId, nextSyncToken);
  }
  removeRecurringMasterPlaceholders(sourceCalId, recurringMasterIds);
  cleanupOrphanedBusyPlaceholders(sourceCalId);
  Logger.log(
    'runInitialSync: source=%s, end, processed=%s, nextSyncToken=%s',
    sourceCalId,
    String(processed),
    nextSyncToken ? 'saved' : ''
  );
  return {
    status: 'initial',
    processed: processed,
    nextSyncToken: nextSyncToken ? 'saved' : '',
  };
}

function isSyncTokenGone(error) {
  var message = '';
  try {
    message = error && error.message ? error.message : String(error);
  } catch (err) {
    message = String(error);
  }
  return message.indexOf('410') !== -1;
}

// =============================================================================
// Filters & decisions
// =============================================================================
function isAllDayEvent(event) {
  return Boolean(event && event.start && event.start.date);
}

function isCancelledEvent(event) {
  return Boolean(event && event.status === 'cancelled');
}

function isFreeEvent(event) {
  return Boolean(event && event.transparency === 'transparent');
}

function isRecurringSeriesMaster(event) {
  if (!event) {
    return false;
  }
  if (event.recurringEventId) {
    return false;
  }
  return Array.isArray(event.recurrence) && event.recurrence.length > 0;
}

function recordRecurringMasterId(masterIds, event) {
  if (!masterIds || !event) {
    return;
  }
  if (event.recurringEventId) {
    masterIds[event.recurringEventId] = true;
    return;
  }
  if (isRecurringSeriesMaster(event) && event.id) {
    masterIds[event.id] = true;
  }
}

function getSelfAttendee(event) {
  if (!event || !Array.isArray(event.attendees)) {
    return null;
  }
  for (var i = 0; i < event.attendees.length; i++) {
    if (event.attendees[i] && event.attendees[i].self === true) {
      return event.attendees[i];
    }
  }
  return null;
}

function isRsvpEvent(event) {
  return Boolean(getSelfAttendee(event));
}

function isAcceptedRsvp(event) {
  var selfAttendee = getSelfAttendee(event);
  if (!selfAttendee) {
    return true;
  }
  return selfAttendee.responseStatus === 'accepted';
}

function containsIgnoreKeyword(event) {
  var keyword = (IGNORE_KEYWORD || '').toLowerCase().trim();
  if (!keyword) {
    return false;
  }
  var summary = event && event.summary ? event.summary : '';
  var description = event && event.description ? event.description : '';
  var haystack = (summary + ' ' + description).toLowerCase();
  return haystack.indexOf(keyword) !== -1;
}

function shouldCreateBusyPlaceholder(event) {
  if (isCancelledEvent(event) || isAllDayEvent(event) || isFreeEvent(event)) {
    return false;
  }
  if (isRsvpEvent(event) && !isAcceptedRsvp(event)) {
    return false;
  }
  return true;
}

function evaluateBusyAction(event) {
  if (isRecurringSeriesMaster(event)) {
    return { action: 'remove', reason: 'recurring_master' };
  }
  if (containsIgnoreKeyword(event)) {
    return { action: 'remove', reason: 'ignore_keyword' };
  }
  if (shouldCreateBusyPlaceholder(event)) {
    return { action: 'upsert' };
  }
  return { action: 'remove' };
}

// =============================================================================
// Busy placeholders (create/update/remove/cleanup)
// =============================================================================
function upsertBusyPlaceholder(sourceCalId, event) {
  if (!sourceCalId || !event || !event.id) {
    return { action: 'noop', reason: 'missing_input', matched: 0, deduped: 0 };
  }
  var primaryId = TARGET_CALENDAR_ID;
  var matches = findBusyPlaceholders(primaryId, sourceCalId, event.id);
  var deduped = 0;
  if (matches.length > 1) {
    for (var i = 1; i < matches.length; i++) {
      if (matches[i] && matches[i].id) {
        Calendar.Events.remove(primaryId, matches[i].id);
        deduped += 1;
      }
    }
  }
  var fingerprint = buildFingerprint(event);
  var payload = buildBusyPlaceholderPayload(sourceCalId, event, fingerprint);
  if (matches.length === 0) {
    var created = Calendar.Events.insert(payload, primaryId);
    return {
      action: 'created',
      matched: 0,
      deduped: deduped,
      targetId: created && created.id ? created.id : '',
    };
  }
  var existing = matches[0];
  var existingFingerprint = getPrivateProp(existing, PRIVATE_PROP_FINGERPRINT);
  if (existingFingerprint === fingerprint) {
    return {
      action: 'noop',
      reason: 'fingerprint_match',
      matched: matches.length,
      deduped: deduped,
      targetId: existing.id,
    };
  }
  var updated = Calendar.Events.patch(payload, primaryId, existing.id);
  return {
    action: 'updated',
    matched: matches.length,
    deduped: deduped,
    targetId: updated && updated.id ? updated.id : existing.id,
  };
}

function findBusyPlaceholders(primaryId, sourceCalId, sourceEventId) {
  var privateProps = [
    PRIVATE_PROP_MANAGED + '=true',
    PRIVATE_PROP_SOURCE_CAL_ID + '=' + sourceCalId,
    PRIVATE_PROP_SOURCE_EVENT_ID + '=' + sourceEventId,
  ];
  var matches = [];
  var pageToken;
  do {
    var response = Calendar.Events.list(primaryId, {
      privateExtendedProperty: privateProps,
      maxResults: 50,
      pageToken: pageToken,
    });
    if (response && Array.isArray(response.items)) {
      matches = matches.concat(response.items);
    }
    pageToken = response && response.nextPageToken;
  } while (pageToken);
  return matches;
}

function buildBusyPlaceholderPayload(sourceCalId, event, fingerprint) {
  return {
    summary: BUSY_SUMMARY,
    visibility: 'private',
    transparency: 'opaque',
    start: event.start,
    end: event.end,
    attendees: [],
    reminders: {
      useDefault: false,
      overrides: [],
    },
    description: buildBusyDescription(event),
    extendedProperties: {
      private: {
        [PRIVATE_PROP_MANAGED]: 'true',
        [PRIVATE_PROP_SOURCE_CAL_ID]: sourceCalId,
        [PRIVATE_PROP_SOURCE_EVENT_ID]: event.id,
        [PRIVATE_PROP_SOURCE_UPDATED]: event.updated || '',
        [PRIVATE_PROP_FINGERPRINT]: fingerprint,
      },
    },
  };
}

function buildBusyDescription(event) {
  var summary = event && event.summary ? event.summary : '';
  var link = event && event.htmlLink ? event.htmlLink : '';
  if (summary && link) {
    return summary + '\n' + link;
  }
  return summary || link || '';
}

function buildFingerprint(event) {
  var startKey = buildTimeKey(event && event.start);
  var endKey = buildTimeKey(event && event.end);
  var status = event && event.status ? event.status : '';
  var transparency = event && event.transparency ? event.transparency : '';
  var rsvpStatus = '';
  var selfAttendee = getSelfAttendee(event);
  if (selfAttendee && selfAttendee.responseStatus) {
    rsvpStatus = selfAttendee.responseStatus;
  }
  return [startKey, endKey, status, transparency, rsvpStatus].join('||');
}

function buildTimeKey(time) {
  if (!time) {
    return '||';
  }
  var dateTime = time.dateTime ? time.dateTime : '';
  var date = time.date ? time.date : '';
  var tz = time.timeZone ? time.timeZone : '';
  return [dateTime, date, tz].join('|');
}

function getPrivateProp(event, key) {
  if (!event || !event.extendedProperties || !event.extendedProperties.private) {
    return '';
  }
  return event.extendedProperties.private[key] || '';
}

function isManagedPlaceholder(event) {
  return getPrivateProp(event, PRIVATE_PROP_MANAGED) === 'true';
}

function removeBusyPlaceholders(sourceCalId, event) {
  if (!sourceCalId || !event || !event.id) {
    return { action: 'noop', removed: 0, matched: 0, reason: 'missing_input' };
  }
  return removeBusyPlaceholdersBySourceEventId(sourceCalId, event.id);
}

function removeBusyPlaceholdersBySourceEventId(sourceCalId, sourceEventId) {
  if (!sourceCalId || !sourceEventId) {
    return { action: 'noop', removed: 0, matched: 0, reason: 'missing_input' };
  }
  var primaryId = TARGET_CALENDAR_ID;
  var privateProps = [
    PRIVATE_PROP_MANAGED + '=true',
    PRIVATE_PROP_SOURCE_CAL_ID + '=' + sourceCalId,
    PRIVATE_PROP_SOURCE_EVENT_ID + '=' + sourceEventId,
  ];
  var removedCount = 0;
  var matchedCount = 0;
  var pageToken;
  do {
    var response = Calendar.Events.list(primaryId, {
      privateExtendedProperty: privateProps,
      maxResults: 50,
      pageToken: pageToken,
    });
    var items = response && response.items ? response.items : [];
    matchedCount += items.length;
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].id) {
        Calendar.Events.remove(primaryId, items[i].id);
        removedCount += 1;
      }
    }
    pageToken = response && response.nextPageToken;
  } while (pageToken);
  if (removedCount > 0) {
    return { action: 'removed', removed: removedCount, matched: matchedCount };
  }
  return { action: 'noop', removed: 0, matched: matchedCount };
}

function removeRecurringMasterPlaceholders(sourceCalId, masterIds) {
  if (!masterIds) {
    return;
  }
  var ids = Object.keys(masterIds);
  if (ids.length === 0) {
    return;
  }
  for (var i = 0; i < ids.length; i++) {
    removeBusyPlaceholdersBySourceEventId(sourceCalId, ids[i]);
  }
}

function cleanupOrphanedBusyPlaceholders(sourceCalId) {
  if (!sourceCalId) {
    return;
  }
  var now = new Date();
  var timeMin = getWindowStart(now).toISOString();
  var timeMax = getWindowEnd(now).toISOString();
  Logger.log(
    'cleanupOrphanedBusyPlaceholders: start sourceCalId=%s, window=%s..%s',
    sourceCalId,
    timeMin,
    timeMax
  );
  var placeholders = listManagedBusyPlaceholdersForSource(
    sourceCalId,
    timeMin,
    timeMax
  );
  if (placeholders.length === 0) {
    return;
  }
  var primaryId = TARGET_CALENDAR_ID;
  var removed = 0;
  var skippedMissingId = 0;
  for (var i = 0; i < placeholders.length; i++) {
    var placeholder = placeholders[i];
    if (!placeholder || !placeholder.id) {
      continue;
    }
    var sourceEventId = getPrivateProp(placeholder, PRIVATE_PROP_SOURCE_EVENT_ID);
    if (!sourceEventId) {
      skippedMissingId += 1;
      continue;
    }
    if (isSourceEventMissing(sourceCalId, sourceEventId)) {
      Calendar.Events.remove(primaryId, placeholder.id);
      removed += 1;
    }
  }
  Logger.log(
    'cleanupOrphanedBusyPlaceholders: sourceCalId=%s, scanned=%s, removed=%s, skippedMissingSourceEventId=%s',
    sourceCalId,
    String(placeholders.length),
    String(removed),
    String(skippedMissingId)
  );
}

function listManagedBusyPlaceholdersForSource(sourceCalId, timeMin, timeMax) {
  if (!sourceCalId) {
    return [];
  }
  var primaryId = TARGET_CALENDAR_ID;
  var privateProps = [
    PRIVATE_PROP_MANAGED + '=true',
    PRIVATE_PROP_SOURCE_CAL_ID + '=' + sourceCalId,
  ];
  var matches = [];
  var pageToken;
  do {
    var response = Calendar.Events.list(primaryId, {
      timeMin: timeMin,
      timeMax: timeMax,
      showDeleted: false,
      maxResults: 250,
      pageToken: pageToken,
      privateExtendedProperty: privateProps,
    });
    if (response && Array.isArray(response.items)) {
      matches = matches.concat(response.items);
    }
    pageToken = response && response.nextPageToken;
  } while (pageToken);
  return matches;
}

function listManagedBusyPlaceholdersInWindow(timeMin, timeMax) {
  var primaryId = TARGET_CALENDAR_ID;
  var matches = [];
  var pageToken;
  do {
    var response = Calendar.Events.list(primaryId, {
      timeMin: timeMin,
      timeMax: timeMax,
      showDeleted: false,
      maxResults: 250,
      pageToken: pageToken,
      privateExtendedProperty: [PRIVATE_PROP_MANAGED + '=true'],
    });
    if (response && Array.isArray(response.items)) {
      matches = matches.concat(response.items);
    }
    pageToken = response && response.nextPageToken;
  } while (pageToken);
  return matches;
}

function clearBusyEvents() {
  var now = new Date();
  var timeMin = getWindowStart(now).toISOString();
  var timeMax = getWindowEnd(now).toISOString();
  var placeholders = listManagedBusyPlaceholdersInWindow(timeMin, timeMax);
  var primaryId = TARGET_CALENDAR_ID;
  var removed = 0;
  for (var i = 0; i < placeholders.length; i++) {
    if (placeholders[i] && placeholders[i].id) {
      Calendar.Events.remove(primaryId, placeholders[i].id);
      removed += 1;
    }
  }
  Logger.log(
    'clearBusyEvents: matched=%s, removed=%s',
    String(placeholders.length),
    String(removed)
  );
}

function isSourceEventMissing(sourceCalId, sourceEventId) {
  try {
    var event = Calendar.Events.get(sourceCalId, sourceEventId);
    return !(event && event.id);
  } catch (error) {
    if (isNotFoundError(error)) {
      return true;
    }
    Logger.log(
      'cleanupOrphanedBusyPlaceholders: unable to verify source event id=%s for sourceCalId=%s, error=%s',
      sourceEventId,
      sourceCalId,
      summarizeError(error)
    );
    return false;
  }
}

// =============================================================================
// Debug entrypoints
// =============================================================================
function debugSyncByEvent() {
  var sourcePick = Debug.resolveSourceCalendarId(true);
  if (!sourcePick) {
    return;
  }
  var eventPick = Debug.resolveEvent(sourcePick.id, true);
  if (!eventPick) {
    return;
  }
  Logger.log(
    'debugSyncByEvent: sourceCalId=%s (via %s), eventId=%s (via %s)',
    sourcePick.id,
    sourcePick.via,
    eventPick.event && eventPick.event.id ? eventPick.event.id : '',
    eventPick.via
  );
  Debug.runSyncEvent(sourcePick.id, eventPick.event.id, eventPick.event);
}

function debugListCalendars() {
  Debug.listSourceCalendars();
}

function debugListEvents() {
  var sourcePick = Debug.resolveSourceCalendarId(true);
  if (!sourcePick) {
    return;
  }
  Logger.log(
    'debugListEvents: sourceCalId=%s (via %s)',
    sourcePick.id,
    sourcePick.via
  );
  Debug.listRecentEvents(sourcePick.id);
}

function debugCreateDuplicate() {
  var sourcePick = Debug.resolveSourceCalendarId(true);
  if (!sourcePick) {
    return;
  }
  var eventPick = Debug.resolveEvent(sourcePick.id, true);
  if (!eventPick) {
    return;
  }
  Logger.log(
    'debugCreateDuplicate: sourceCalId=%s (via %s), eventId=%s (via %s)',
    sourcePick.id,
    sourcePick.via,
    eventPick.event && eventPick.event.id ? eventPick.event.id : '',
    eventPick.via
  );
  Debug.createDuplicateBusy(sourcePick.id, eventPick.event);
}

function debugList() {
  Debug.listManagedInPrimary();
}

function debugSync() {
  var sourcePick = Debug.resolveSourceCalendarId(true);
  if (!sourcePick) {
    return;
  }
  var result = syncSourceCalendar(sourcePick.id);
  Logger.log(
    'debugSync: status=%s, reason=%s, processed=%s, nextSyncToken=%s, sourceCalId=%s (via %s)',
    result.status || '',
    result.reason || '',
    String(result.processed || 0),
    result.nextSyncToken || '',
    sourcePick.id,
    sourcePick.via
  );
}

function debugSyncByCalendar() {
  var sourceCalId = PropertiesService.getScriptProperties().getProperty(
    'DEBUG_SOURCE_CAL_ID'
  );
  if (!sourceCalId) {
    Logger.log(
      'debugSyncByCalendar: set DEBUG_SOURCE_CAL_ID in Script Properties'
    );
    return;
  }
  var result = syncSourceCalendar(sourceCalId);
  Logger.log(
    'debugSyncByCalendar: status=%s, reason=%s, processed=%s, nextSyncToken=%s, sourceCalId=%s',
    result && result.status ? result.status : '',
    result && result.reason ? result.reason : '',
    String(result && result.processed ? result.processed : 0),
    result && result.nextSyncToken ? result.nextSyncToken : '',
    sourceCalId || ''
  );
}

// =============================================================================
// Debug helpers (Debug object)
// =============================================================================
var Debug = {
  runSyncEvent: function (sourceCalId, eventId, event) {
    var eventToSync = event || Calendar.Events.get(sourceCalId, eventId);
    var effectiveEventId =
      eventToSync && eventToSync.id ? eventToSync.id : eventId;
    if (!eventToSync || !effectiveEventId) {
      Logger.log('debugSyncByEvent: unable to load event for source=%s', sourceCalId);
      return;
    }
    var decision = evaluateBusyAction(eventToSync);
    var result;
    if (decision.action === 'remove') {
      result = removeBusyPlaceholders(sourceCalId, eventToSync);
    } else {
      result = upsertBusyPlaceholder(sourceCalId, eventToSync);
    }
    Logger.log(
      'debugSyncByEvent: action=%s, reason=%s, matched=%s, deduped=%s, removed=%s, targetId=%s, sourceCalId=%s, eventId=%s',
      result.action,
      result.reason || '',
      String(result.matched || 0),
      String(result.deduped || 0),
      String(result.removed || 0),
      result.targetId || '',
      sourceCalId,
      effectiveEventId
    );
  },
  listSourceCalendars: function () {
    var primaryId = TARGET_CALENDAR_ID;
    var pageToken;
    var total = 0;
    do {
      var response = Calendar.CalendarList.list({
        maxResults: 250,
        pageToken: pageToken,
      });
      var items = response && response.items ? response.items : [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || !item.id) {
          continue;
        }
        if (item.primary === true || item.id === primaryId) {
          continue;
        }
        Logger.log(
          'source calendar id=%s, summary=%s',
          item.id,
          item.summary || ''
        );
        total += 1;
      }
      pageToken = response && response.nextPageToken;
    } while (pageToken);
    Logger.log('source calendars total=%s', String(total));
  },
  listRecentEvents: function (sourceCalId) {
    var now = new Date();
    var timeMin = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    var timeMax = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    var response = Calendar.Events.list(sourceCalId, {
      timeMin: timeMin,
      timeMax: timeMax,
      showDeleted: false,
      maxResults: 25,
      singleEvents: false,
      orderBy: 'updated',
    });
    var items = response && response.items ? response.items : [];
    if (items.length === 0) {
      Logger.log('debugListEvents: no events found');
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      Logger.log(
        'event id=%s, summary=%s, start=%s, end=%s',
        item.id,
        item.summary || '',
        item.start && (item.start.dateTime || item.start.date) || '',
        item.end && (item.end.dateTime || item.end.date) || ''
      );
    }
  },
  createDuplicateBusy: function (sourceCalId, eventId) {
    var event =
      eventId && eventId.id ? eventId : Calendar.Events.get(sourceCalId, eventId);
    if (!event || !event.id) {
      Logger.log(
        'debugCreateDuplicate: unable to load event for source=%s',
        sourceCalId
      );
      return;
    }
    var fingerprint = buildFingerprint(event);
    var payload = buildBusyPlaceholderPayload(sourceCalId, event, fingerprint);
    var primaryId = TARGET_CALENDAR_ID;
    var created = Calendar.Events.insert(payload, primaryId);
    Logger.log(
      'debugCreateDuplicate: created duplicate busy id=%s for eventId=%s',
      created && created.id ? created.id : '',
      event.id
    );
  },
  listManagedInPrimary: function () {
    var primaryId = TARGET_CALENDAR_ID;
    var now = new Date();
    var timeMin = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    var timeMax = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    var pageToken;
    var total = 0;
    do {
      var resp = Calendar.Events.list(primaryId, {
        timeMin: timeMin,
        timeMax: timeMax,
        showDeleted: false,
        maxResults: 50,
        pageToken: pageToken,
        privateExtendedProperty: [PRIVATE_PROP_MANAGED + '=true'],
      });
      var items = resp && resp.items ? resp.items : [];
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        Logger.log(
          'managed busy id=%s, summary=%s, start=%s, end=%s',
          item.id,
          item.summary || '',
          (item.start && (item.start.dateTime || item.start.date)) || '',
          (item.end && (item.end.dateTime || item.end.date)) || ''
        );
        total += 1;
      }
      pageToken = resp && resp.nextPageToken;
    } while (pageToken);
    Logger.log('managed busy total=%s', String(total));
  },
  resolveSourceCalendarId: function (useProps) {
    var props = PropertiesService.getScriptProperties();
    var fromProps = useProps ? props.getProperty('DEBUG_SOURCE_CAL_ID') : '';
    if (fromProps) {
      return { id: fromProps, via: 'DEBUG_SOURCE_CAL_ID' };
    }
    var ids = listSourceCalendarIds();
    if (!ids || ids.length === 0) {
      Logger.log('debug: no source calendars found');
      return null;
    }
    return { id: ids[0], via: 'auto' };
  },
  resolveEvent: function (sourceCalId, useProps) {
    var props = PropertiesService.getScriptProperties();
    var fromProps = useProps ? props.getProperty('DEBUG_EVENT_ID') : '';
    if (fromProps) {
      try {
        var eventFromProps = Calendar.Events.get(sourceCalId, fromProps);
        if (eventFromProps && eventFromProps.id) {
          return { event: eventFromProps, via: 'DEBUG_EVENT_ID' };
        }
      } catch (err) {
        Logger.log('debug: failed to load DEBUG_EVENT_ID=%s', fromProps);
      }
    }
    var picked = Debug.pickDefaultEvent(sourceCalId);
    if (!picked) {
      Logger.log('debug: no events found for source=%s', sourceCalId);
      return null;
    }
    return { event: picked, via: 'auto' };
  },
  pickDefaultEvent: function (sourceCalId) {
    var now = new Date();
    var response = Calendar.Events.list(sourceCalId, {
      timeMin: getWindowStart(now).toISOString(),
      timeMax: getWindowEnd(now).toISOString(),
      showDeleted: false,
      maxResults: 25,
      singleEvents: true,
      orderBy: 'startTime',
    });
    var items = response && response.items ? response.items : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].id) {
        return items[i];
      }
    }
    return null;
  },
};

// =============================================================================
// Error helpers
// =============================================================================
function isNotFoundError(error) {
  var message = summarizeError(error).toLowerCase();
  return message.indexOf('404') !== -1 || message.indexOf('not found') !== -1;
}

function summarizeError(error) {
  try {
    if (error && error.message) {
      return String(error.message);
    }
  } catch (err) {
    return String(error);
  }
  return String(error);
}
