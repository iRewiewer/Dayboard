export const STATUSES = ['backlog', 'todo', 'in-progress', 'in-review', 'done'] as const
export type Status = string

export interface StatusDefinition {
  id: string
  name: string
  color: string
  isDone: boolean
}

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type Severity = (typeof SEVERITIES)[number]

export interface TaskComment {
  id: string
  author: string
  body: string
  createdAt: string
}

/** Both dates are local calendar dates. A null end means repeat forever. */
export interface RepeatSchedule {
  startsOn: string
  endsOn: string | null
}

export interface Task {
  id: string
  key: string
  title: string
  description: string
  status: Status
  severity: Severity
  assigneeId: string
  startDate: string | null
  endDate: string | null
  todayDate: string | null
  repeat: RepeatSchedule | null
  dismissedOn: string | null
  order: number
  comments: TaskComment[]
  createdAt: string
}

export interface Member {
  id: string
  name: string
  initials: string
  color: string
}

export const THEME_COLORS = ['blood-red', 'crimson-red', 'green', 'purple', 'violet', 'pink', 'orange', 'yellow', 'lime', 'fuchsia', 'cyan', 'navy-blue', 'light-blue'] as const
export type ThemeColor = (typeof THEME_COLORS)[number]
export type ThemeMode = 'light' | 'dark'

export interface ThemePreference {
  mode: ThemeMode
  color: ThemeColor
}

export const DEFAULT_THEME: ThemePreference = { mode: 'dark', color: 'green' }

export interface Settings {
  username: string
  todayStatuses: Status[]
  todayOrder: 'severity' | 'manual'
  theme: ThemePreference
}

export interface BoardState {
  tasks: Task[]
  settings: Settings
  members: Member[]
  statuses: StatusDefinition[]
}

export type State = BoardState

export const STATUS_LABELS: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  'in-progress': 'In progress',
  'in-review': 'In review',
  done: 'Done',
}

export const STATUS_COLORS: Record<Status, string> = {
  backlog: '#9298a7',
  todo: '#6e8bd7',
  'in-progress': '#b19aee',
  'in-review': '#e1ae68',
  done: '#72bda0',
}

export const DEFAULT_STATUSES: StatusDefinition[] = STATUSES.map(id => ({
  id, name: STATUS_LABELS[id], color: STATUS_COLORS[id], isDone: id === 'done',
}))

export const DEFAULT_USERNAME = 'You'

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}
