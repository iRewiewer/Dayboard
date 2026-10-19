import { SEVERITY_RANK } from './domain.ts'
import type { RepeatSchedule, Settings, Task } from './domain.ts'

/** The viewer's local calendar date, without UTC conversion. */
export function localDate(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid date')
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new RangeError('Expected a date in YYYY-MM-DD format')
  const [, year, month, day] = match
  // Noon avoids midnight DST transitions, and setFullYear handles years 00–99.
  const result = new Date(0)
  result.setHours(12, 0, 0, 0)
  result.setFullYear(Number(year), Number(month) - 1, Number(day))
  if (localDate(result) !== value) throw new RangeError('Invalid calendar date')
  return result
}

/** Format a calendar date for the Today heading with an English ordinal day. */
export function longDateLabel(value: string): string {
  const date = parseCalendarDate(value)
  const day = date.getDate()
  const lastTwoDigits = day % 100
  const suffix = lastTwoDigits >= 11 && lastTwoDigits <= 13
    ? 'th'
    : day % 10 === 1
      ? 'st'
      : day % 10 === 2
        ? 'nd'
        : day % 10 === 3 ? 'rd' : 'th'
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(date)
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(date)
  return `${weekday} ${day}${suffix} ${month}`
}

/** Add calendar days, even when the local day has 23 or 25 hours. */
export function addDays(date: string, amount: number): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError('Days must be an integer')
  const value = parseCalendarDate(date)
  value.setDate(value.getDate() + amount)
  const result = localDate(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new RangeError('Date is outside the supported range')
  return result
}

/** Repeat on future days. Today is selected separately via the task's todayDate. */
export function createRepeat(days: number | 'forever', today = localDate()): RepeatSchedule {
  const startsOn = addDays(today, 1)
  if (days === 'forever') return { startsOn, endsOn: null }
  if (!Number.isSafeInteger(days) || days < 1) throw new RangeError('Repeat duration must be at least one day')
  return { startsOn, endsOn: addDays(today, days) }
}

/** Dismissing today's occurrence leaves the recurring schedule intact. */
export function isForToday(task: Task, date = localDate()): boolean {
  if (task.dismissedOn === date) return false
  if (task.todayDate === date) return true
  return task.repeat !== null
    && task.repeat.startsOn <= date
    && (task.repeat.endsOn === null || date <= task.repeat.endsOn)
}

/** Return a copy; equal priorities retain their manual order, then a stable ID order. */
export function sortTasks(tasks: readonly Task[], order: Settings['todayOrder']): Task[] {
  return [...tasks].sort((a, b) => {
    const severity = order === 'severity' ? SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] : 0
    return severity || a.order - b.order || a.key.localeCompare(b.key) || a.id.localeCompare(b.id)
  })
}

export function getTodayTasks(tasks: readonly Task[], settings: Settings, date = localDate()): Task[] {
  const statuses = new Set(settings.todayStatuses)
  return sortTasks(tasks.filter(task => statuses.has(task.status) && isForToday(task, date)), settings.todayOrder)
}
