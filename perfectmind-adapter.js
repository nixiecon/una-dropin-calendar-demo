/* ========================================================================
 * PerfectMind → UNA Calendar Adapter
 * Transforms raw PerfectMind event data (as served by WordPress/PHP)
 * into the schema expected by calendar.js.
 *
 * Usage:
 *   const calendarPrograms = window.PerfectMindAdapter.transform(rawEvents);
 *
 * Input shape (PerfectMind PHP array):
 *   { Subject, CourseID, ExactTime, EndTime, LocationName, Remaining,
 *     CalendarCategory, MinimumAge, MaximumAge, SportDropIn,
 *     FamilySportsDropIn, RegisteredSports, ProgramswithDropInOptions,
 *     SocialProgramDropIn, ... }
 *
 * Output shape (calendar.js schema):
 *   { id, name, programType, ageCategory, ageRange, dayOfWeek,
 *     startTime, endTime, location, spotsLeft }
 * ====================================================================== */

(function () {
  'use strict';

  // ----- Program type derivation -----
  // PerfectMind uses boolean flags; we pick the first truthy one.
  // Order matches the filter dropdown in index.html.
  var TYPE_FLAGS = [
    { key: 'SportDropIn',                label: 'Sport Drop-In' },
    { key: 'SocialProgramDropIn',        label: 'Social Program Drop-In' },
    { key: 'RegisteredSports',           label: 'Registered Sports' },
    { key: 'ProgramswithDropInOptions',  label: 'Programs with Drop-In Options' },
    { key: 'FamilySportsDropIn',         label: 'Family Sports Drop In' },
  ];

  function deriveProgramType(raw) {
    for (var i = 0; i < TYPE_FLAGS.length; i++) {
      // PerfectMind sometimes sends booleans, sometimes strings ("true"/"false")
      var val = raw[TYPE_FLAGS[i].key];
      if (val === true || val === 'true' || val === 1 || val === '1') {
        return TYPE_FLAGS[i].label;
      }
    }
    return 'Drop-In';  // fallback if no flag is set
  }

  // ----- Age range builder -----

  function buildAgeRange(minAge, maxAge) {
    var min = parseAge(minAge);
    var max = parseAge(maxAge);

    if (min === null && max === null) return 'All Ages';
    if (min !== null && max === null) return 'Ages ' + min + '+';
    if (min === null && max !== null) return 'Ages up to ' + max;
    if (min === max) return 'Ages ' + min;
    return 'Ages ' + min + ' to ' + max;
  }

  function parseAge(val) {
    if (val === null || val === undefined || val === '' || val === 'null') return null;
    var n = Number(val);
    return isNaN(n) ? null : n;
  }

  // ----- Time parsing -----

  // ExactTime format: "2026-04-07 09:25AM" or "2026-04-07 09:25 AM"
  // Returns { dayOfWeek: 0-6, startTime: "HH:MM" (24h), dateObj: Date }
  function parseExactTime(exactTime) {
    if (!exactTime) return null;

    // Try native Date parse first (handles most formats)
    var d = new Date(exactTime);
    if (!isNaN(d.getTime())) {
      return {
        dayOfWeek: d.getDay(),
        startTime: pad2(d.getHours()) + ':' + pad2(d.getMinutes()),
        dateObj: d,
      };
    }

    // Manual parse for "YYYY-MM-DD HH:MMAM/PM" without space before AM/PM
    var match = exactTime.match(
      /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
    );
    if (match) {
      var year = Number(match[1]);
      var month = Number(match[2]) - 1;
      var day = Number(match[3]);
      var hours = Number(match[4]);
      var minutes = Number(match[5]);
      var ampm = match[6].toUpperCase();

      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      d = new Date(year, month, day, hours, minutes);
      return {
        dayOfWeek: d.getDay(),
        startTime: pad2(hours) + ':' + pad2(minutes),
        dateObj: d,
      };
    }

    return null;
  }

  // EndTime format: "10:25AM" or "1:00PM" (no date — same day as ExactTime)
  // Returns "HH:MM" in 24h
  function parseEndTime(endTime) {
    if (!endTime) return null;

    var match = endTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;

    var hours = Number(match[1]);
    var minutes = Number(match[2]);
    var ampm = match[3].toUpperCase();

    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    return pad2(hours) + ':' + pad2(minutes);
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // ----- Main transform -----

  function transform(rawEvents) {
    if (!Array.isArray(rawEvents)) return [];

    return rawEvents
      .map(function (raw) {
        var parsed = parseExactTime(raw.ExactTime);
        if (!parsed) return null;  // skip unparseable events

        var endTime24 = parseEndTime(raw.EndTime);
        if (!endTime24) return null;

        var remaining = Number(raw.Remaining);

        return {
          id:          String(raw.CourseID || raw.ID || ''),
          name:        String(raw.Subject || ''),
          programType: deriveProgramType(raw),
          ageCategory: String(raw.CalendarCategory || ''),
          ageRange:    buildAgeRange(raw.MinimumAge, raw.MaximumAge),
          dayOfWeek:   parsed.dayOfWeek,
          startTime:   parsed.startTime,
          endTime:     endTime24,
          location:    String(raw.LocationName || ''),
          spotsLeft:   isNaN(remaining) ? 0 : Math.max(0, remaining),
        };
      })
      .filter(function (e) { return e !== null; });
  }

  // ----- Export -----

  window.PerfectMindAdapter = {
    transform: transform,
    // Exposed for testing / debugging:
    _parseExactTime: parseExactTime,
    _parseEndTime: parseEndTime,
    _deriveProgramType: deriveProgramType,
    _buildAgeRange: buildAgeRange,
  };

})();
