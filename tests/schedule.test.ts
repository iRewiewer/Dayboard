import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Task } from '../src/domain.ts'
import { addDays, createRepeat, getTodayTasks, isForToday, localDate, sortTasks } from '../src/schedule.ts'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', key: 'DAY-1', title: 'Test task', description: '', status: 'todo', severity: 'medium',
    assigneeId: 'alex', startDate: null, endDate: null, todayDate: null, repeat: null, dismissedOn: null,
    order: 1, comments: [], createdAt: '2026-10-19T12:00:00Z', ...overrides,
  }
}

test('localDate uses local year, month and day instead of a UTC date', () => {
  const value = new Date(2026, 9, 19, 0, 1)
  assert.equal(localDate(value), '2026-10-19')
  assert.throws(() => localDate(new Date('invalid')), RangeError)
})

test('calendar arithmetic crosses leap day, year boundaries and DST dates', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(addDays('2024-02-28', 2), '2024-03-01')
  assert.equal(addDays('2025-02-28', 1), '2025-03-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2027-01-01', -1), '2026-12-31')
  assert.equal(addDays('2026-03-28', 2), '2026-03-30')
  assert.equal(addDays('2026-10-24', 2), '2026-10-26')
  assert.equal(addDays('2026-10-26', -2), '2026-10-24')
})

test('invalid calendar dates and fractional offsets are rejected', () => {
  for (const value of ['2026-02-29', '2026-13-01', '2026-00-01', '2026-1-01', 'garbage']) {
    assert.throws(() => addDays(value, 1), RangeError)
  }
  for (const value of [0.5, NaN, Infinity]) assert.throws(() => addDays('2026-10-19', value), RangeError)
})

test('repeat duration counts future days, starting tomorrow, and supports forever', () => {
  assert.deepEqual(createRepeat(1, '2026-10-19'), { startsOn: '2026-10-20', endsOn: '2026-10-20' })
  assert.deepEqual(createRepeat(7, '2026-10-19'), { startsOn: '2026-10-20', endsOn: '2026-10-26' })
  assert.deepEqual(createRepeat(3, '2026-12-31'), { startsOn: '2027-01-01', endsOn: '2027-01-03' })
  assert.deepEqual(createRepeat('forever', '2026-10-19'), { startsOn: '2026-10-20', endsOn: null })
  for (const value of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => createRepeat(value, '2026-10-19'), RangeError)
})

test('one-time marks disappear when the calendar day changes', () => {
  const marked = task({ todayDate: '2026-10-19' })
  assert.equal(isForToday(marked, '2026-10-18'), false)
  assert.equal(isForToday(marked, '2026-10-19'), true)
  assert.equal(isForToday(marked, '2026-10-20'), false)
  assert.equal(isForToday(task(), '2026-10-19'), false)
})

test('recurrence includes both boundaries and never starts early', () => {
  const recurring = task({ repeat: createRepeat(3, '2026-10-19') })
  assert.equal(isForToday(recurring, '2026-10-18'), false)
  assert.equal(isForToday(recurring, '2026-10-19'), false)
  assert.equal(isForToday(recurring, '2026-10-20'), true)
  assert.equal(isForToday(recurring, '2026-10-22'), true)
  assert.equal(isForToday(recurring, '2026-10-23'), false)
  const forever = task({ repeat: createRepeat('forever', '2026-10-19') })
  assert.equal(isForToday(forever, '2026-10-19'), false)
  assert.equal(isForToday(forever, '2099-12-31'), true)
})

test('dismissing an occurrence suppresses both its mark and repeat only for that day', () => {
  const recurring = task({
    repeat: createRepeat('forever', '2026-10-19'), todayDate: '2026-10-19', dismissedOn: '2026-10-19',
  })
  assert.equal(isForToday(recurring, '2026-10-19'), false)
  assert.equal(isForToday(recurring, '2026-10-20'), true)
  assert.deepEqual(recurring.repeat, { startsOn: '2026-10-20', endsOn: null })
  const dismissedRepeat = { ...recurring, todayDate: null, dismissedOn: '2026-10-20' }
  assert.equal(isForToday(dismissedRepeat, '2026-10-20'), false)
  assert.equal(isForToday(dismissedRepeat, '2026-10-21'), true)
})

test('severity sorting uses manual order to break ties without changing source', () => {
  const tasks = [
    task({ id: 'medium', severity: 'medium', order: 0 }),
    task({ id: 'high-2', severity: 'high', order: 2 }),
    task({ id: 'critical', severity: 'critical', order: 10 }),
    task({ id: 'high-1', severity: 'high', order: 1 }),
    task({ id: 'low', severity: 'low', order: -1 }),
  ]
  assert.deepEqual(sortTasks(tasks, 'severity').map(value => value.id), ['critical', 'high-1', 'high-2', 'medium', 'low'])
  assert.deepEqual(tasks.map(value => value.id), ['medium', 'high-2', 'critical', 'high-1', 'low'])
  assert.deepEqual(sortTasks(tasks, 'manual').map(value => value.id), ['low', 'medium', 'high-1', 'high-2', 'critical'])
})

test('ties have a deterministic key and ID fallback', () => {
  const tasks = [task({ id: 'z', key: 'DAY-2' }), task({ id: 'b' }), task({ id: 'a' })]
  assert.deepEqual(sortTasks(tasks, 'manual').map(value => value.id), ['a', 'b', 'z'])
})

test('today view applies enabled statuses and configured ordering', () => {
  const tasks = [
    task({ id: 'done', status: 'done', todayDate: '2026-10-19', severity: 'critical' }),
    task({ id: 'low', todayDate: '2026-10-19', severity: 'low', order: 0 }),
    task({ id: 'high', status: 'in-progress', todayDate: '2026-10-19', repeat: createRepeat(2, '2026-10-19'), severity: 'high', order: 1 }),
    task({ id: 'yesterday', todayDate: '2026-10-18' }),
  ]
  const settings = { username: 'You', todayStatuses: ['todo', 'in-progress'] as const, todayOrder: 'severity' as const, theme: { mode: 'dark' as const, color: 'green' as const } }
  assert.deepEqual(getTodayTasks(tasks, { ...settings, todayStatuses: [...settings.todayStatuses] }, '2026-10-19').map(value => value.id), ['high', 'low'])
  assert.deepEqual(getTodayTasks(tasks, { ...settings, todayStatuses: [], todayOrder: 'manual' }, '2026-10-19'), [])
})

test('today filtering accepts user-defined status IDs', () => {
  const tasks = [
    task({ id: 'custom-active', status: 'status-a12', todayDate: '2026-10-19' }),
    task({ id: 'custom-hidden', status: 'status-b34', todayDate: '2026-10-19' }),
  ]
  const settings = { username: 'Taylor', todayStatuses: ['status-a12'], todayOrder: 'manual' as const, theme: { mode: 'dark' as const, color: 'green' as const } }
  assert.deepEqual(getTodayTasks(tasks, settings, '2026-10-19').map(value => value.id), ['custom-active'])
})
