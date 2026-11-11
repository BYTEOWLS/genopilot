import assert from 'node:assert/strict';
import test from 'node:test';
import {formatLocalDate, formatLocalDateTime} from '../../src/ui/utils.js';

test('date formatting uses the host locale and preserves calendar dates across timezones', () => {
  const previousTimezone = process.env.TZ;
  try {
    for (const timezone of ['America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = timezone;
      const calendarDate = '2025-04-03';
      assert.equal(formatLocalDate(calendarDate), new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium', timeZone: 'UTC',
      }).format(new Date(calendarDate)));
      const timestamp = '2025-04-03T01:02:03Z';
      assert.equal(formatLocalDate(timestamp), new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
      }).format(new Date(timestamp)));
      assert.equal(formatLocalDateTime(timestamp), new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium', timeStyle: 'medium',
      }).format(new Date(timestamp)));
    }
  } finally {
    if (previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimezone;
    }
  }
});

test('invalid dates remain unchanged', () => {
  for (const value of ['', 'not a date']) {
    assert.equal(formatLocalDate(value), value);
    assert.equal(formatLocalDateTime(value), value);
  }
});
