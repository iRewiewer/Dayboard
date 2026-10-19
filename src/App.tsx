import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { ArrowDown, ArrowDownWideNarrow, ArrowRight, ArrowUp, Check, ChevronDown, Circle, CircleCheck, Clock3, GripVertical, LayoutGrid, LoaderCircle, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Repeat2, Search, Settings2, SlidersHorizontal, Sun, Sunrise, X } from 'lucide-react';
import { api } from './api';
import { SEVERITY_LABELS } from './domain';
import type { BoardState, Member, Settings, Status, Task, ThemeColor, ThemeMode } from './domain';
import { createRepeat, getTodayTasks, isForToday, localDate, longDateLabel, sortTasks } from './schedule';
import Modal from './Modal';
import TaskDialog from './TaskDialog';
import type { TaskDraft } from './TaskDialog';
import SettingsPage from './SettingsPage';
import type { ConfigDraft } from './SettingsPage';
import { applyTheme, cacheTheme } from './theme';
import SidebarThemeToggle from './SidebarThemeToggle';
import './CompactLayout.css';

type Editor = { id: string | null; status: Status; forToday: boolean };
type View = 'today' | 'board' | 'settings';

function layoutPreference(key: string, fallback: boolean): boolean {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; }
  catch { return fallback; }
}

function dateLabel(value: string | null, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, options) : '';
}

function Avatar({ member, small = false }: { member?: Member; small?: boolean }) {
  return <span className={`avatar ${small ? 'avatar-small' : ''}`} style={{ '--avatar-color': member?.color ?? '#82908c' } as CSSProperties} title={member?.name ?? 'Unassigned'}>{member?.initials ?? '?'}</span>;
}

function SeverityBadge({ severity }: { severity: Task['severity'] }) {
  return <span className={`severity severity-${severity}`}><span className="severity-bars" aria-hidden="true"><i /><i /><i /></span>{SEVERITY_LABELS[severity]}</span>;
}

function RepeatDialog({ task, today, onClose, onSave }: { task: Task; today: string; onClose: () => void; onSave: (repeat: Task['repeat']) => Promise<void> }) {
  const [days, setDays] = useState('3');
  const [forever, setForever] = useState(task.repeat?.endsOn === null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const save = async (schedule: Task['repeat']) => {
    setPending(true); setError('');
    try { await onSave(schedule); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save repeat.'); }
    finally { setPending(false); }
  };
  return <Modal title="Repeat task" subtitle="Choose how long this task appears in Today." onClose={onClose} canClose={!pending}>
    <form onSubmit={(event) => { event.preventDefault(); void save(createRepeat(forever ? 'forever' : Number(days), today)); }}>
      <div className="modal-body repeat-body">
        <div className="repeat-task"><span className="repeat-symbol"><Repeat2 size={21} /></span><div><span>{task.key}</span><strong>{task.title}</strong></div></div>
        <label className="form-field">Repeat for the next<div className={`number-field ${forever ? 'disabled' : ''}`}><input data-autofocus type="number" min="1" max="36500" step="1" value={days} onChange={(event) => setDays(event.target.value)} required={!forever} disabled={forever || pending} /><span>days</span></div></label>
        <label className="checkbox-label forever-option"><input type="checkbox" checked={forever} onChange={(event) => setForever(event.target.checked)} disabled={pending} /><span>Repeat forever<small>Keep it here until you stop the repeat.</small></span></label>
        <div className="repeat-note"><Sun size={17} /><p>{forever ? 'Appears every day starting tomorrow.' : `Appears on the next ${Number(days) || 1} ${Number(days) === 1 ? 'day' : 'days'}, starting tomorrow.`} Today is already included separately.</p></div>
        {task.repeat && <p className="current-repeat">Currently repeating {task.repeat.endsOn ? `through ${dateLabel(task.repeat.endsOn)}` : 'forever'}.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer className="modal-footer">{task.repeat && <button type="button" className="text-button danger-text" disabled={pending} onClick={() => void save(null)}>Stop repeating</button>}<div className="footer-actions"><button type="button" className="button button-secondary" disabled={pending} onClick={onClose}>Cancel</button><button className="button button-primary" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Repeat2 size={16} />} Save repeat</button></div></footer>
    </form>
  </Modal>;
}

export default function App() {
  const [state, setState] = useState<BoardState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<View>(() => { try { const saved = localStorage.getItem('dayboard-view'); return saved === 'board' || saved === 'settings' ? saved : 'today'; } catch { return 'today'; } });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => layoutPreference('dayboard-sidebar-collapsed', false));
  const [today, setToday] = useState(localDate);
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('all');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [repeatId, setRepeatId] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [toast, setToast] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [themeShortcut, setThemeShortcut] = useState<{ mode: ThemeMode; sequence: number } | null>(null);
  const themeToggleBusy = useRef(false);
  const currentView = useRef(view);
  const viewRevision = useRef(0);
  if (currentView.current !== view) {
    currentView.current = view;
    viewRevision.current += 1;
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setLoadError('');
    try { setState(await api<BoardState>('/state')); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Cannot connect to Dayboard.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    try { localStorage.setItem('dayboard-sidebar-collapsed', String(sidebarCollapsed)); } catch { /* Layout preference is optional. */ }
  }, [sidebarCollapsed]);
  useEffect(() => {
    if (!state?.settings.theme) return;
    cacheTheme(state.settings.theme);
    if (view !== 'settings') applyTheme(state.settings.theme);
  }, [state?.settings.theme.mode, state?.settings.theme.color, view]);
  useEffect(() => {
    const interval = setInterval(() => setToday(localDate()), 15000);
    const refreshDate = () => setToday(localDate());
    window.addEventListener('focus', refreshDate);
    return () => { clearInterval(interval); window.removeEventListener('focus', refreshDate); };
  }, []);
  useEffect(() => { try { localStorage.setItem('dayboard-view', view); } catch { /* View preference is optional. */ } document.title = `${view === 'today' ? 'Today' : view === 'settings' ? 'Settings' : 'The board'} · Dayboard`; }, [view]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (view !== 'settings' && event.key === '/' && !editor && !repeatId && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement)) { event.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [editor, repeatId, view]);
  const closeEditor = useCallback(() => setEditor(null), []);
  const closeRepeat = useCallback(() => setRepeatId(null), []);
  const request = async <T,>(path: string, method: string, body?: unknown): Promise<T> => {
    setPending((n) => n + 1);
    try { return await api<T>(path, method, body); } finally { setPending((n) => n - 1); }
  };
  const replaceTask = (task: Task) => setState((current) => current ? { ...current, tasks: current.tasks.map((existing) => existing.id === task.id ? task : existing) } : current);
  const patchTask = async (id: string, values: Partial<Task>) => replaceTask(await request<Task>(`/tasks/${id}`, 'PATCH', values));
  const act = (promise: Promise<unknown>) => { void promise.catch((error: unknown) => setToast(error instanceof Error ? error.message : 'Could not save your changes.')); };
  const updateSettings = async (values: Partial<Settings>) => {
    const settings = await request<Settings>('/settings', 'PATCH', values);
    setState((current) => current ? { ...current, settings } : current);
  };
  const toggleTheme = async (mode: ThemeMode) => {
    if (!state || themeToggleBusy.current || pending > 0) return;
    themeToggleBusy.current = true;
    const previous = {
      mode: document.documentElement.dataset.mode === 'light' ? 'light' as const : 'dark' as const,
      color: (document.documentElement.dataset.accent ?? state.settings.theme.color) as ThemeColor,
    };
    const savedTheme = state.settings.theme;
    const startingViewRevision = viewRevision.current;
    applyTheme({ ...previous, mode });
    setThemeShortcut((current) => ({ mode, sequence: (current?.sequence ?? 0) + 1 }));
    try { await updateSettings({ theme: { ...savedTheme, mode } }); }
    catch (error) {
      const restore = currentView.current === 'settings' && viewRevision.current === startingViewRevision ? previous : savedTheme;
      applyTheme(restore);
      setThemeShortcut((current) => ({ mode: restore.mode, sequence: (current?.sequence ?? 0) + 1 }));
      setToast(error instanceof Error ? error.message : 'Could not save the theme.');
    } finally { themeToggleBusy.current = false; }
  };
  const toggleToday = (task: Task) => act(patchTask(task.id, isForToday(task, today)
    ? { todayDate: null, dismissedOn: today }
    : { todayDate: today, dismissedOn: null }));
  const openTask = (task: Task) => setEditor({ id: task.id, status: task.status, forToday: false });
  const addTask = (status?: Status) => {
    const todayStatus = view === 'today' ? state?.statuses.find((item) => !item.isDone && state.settings.todayStatuses.includes(item.id))?.id : undefined;
    setEditor({ id: null, status: status ?? todayStatus ?? state?.statuses.find((item) => !item.isDone)?.id ?? '', forToday: view === 'today' });
  };
  const saveTask = async (values: TaskDraft, id?: string) => {
    if (id) await patchTask(id, values);
    else {
      const task = await request<Task>('/tasks', 'POST', { ...values, todayDate: editor?.forToday ? today : null });
      setState((current) => current ? { ...current, tasks: [...current.tasks, task] } : current);
    }
  };
  const deleteTask = async (id: string) => {
    await request(`/tasks/${id}`, 'DELETE');
    setState((current) => current ? { ...current, tasks: current.tasks.filter((task) => task.id !== id) } : current);
  };
  const addComment = async (id: string, body: string) => replaceTask(await request<Task>(`/tasks/${id}/comments`, 'POST', { body }));

  const tasks = state?.tasks ?? [];
  const members = state?.members ?? [];
  const statuses = state?.statuses ?? [];
  const statusIds = statuses.map((status) => status.id);
  const statusLabels = Object.fromEntries(statuses.map((status) => [status.id, status.name]));
  const statusColors = Object.fromEntries(statuses.map((status) => [status.id, status.color]));
  const isDone = (task: Task) => statuses.find((status) => status.id === task.status)?.isDone ?? false;
  const openStatusId = statuses.find((status) => !status.isDone)?.id;
  const doneStatusId = statuses.find((status) => status.isDone)?.id;
  const saveConfig = async (config: ConfigDraft) => {
    const updated = await request<BoardState>('/config', 'PATCH', config);
    setState(updated);
    setAssignee('all');
  };
  const todayTasks = state ? getTodayTasks(tasks, state.settings, today) : [];
  const marked = tasks.filter((task) => isForToday(task, today));
  const completed = marked.filter((task) => isDone(task)).length;
  const progress = marked.length ? Math.round(completed / marked.length * 100) : 0;
  const matches = (task: Task) => (assignee === 'all' || task.assigneeId === assignee) && `${task.title} ${task.key} ${task.description} ${members.find((m) => m.id === task.assigneeId)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase());
  const visible = (view === 'today' ? todayTasks : sortTasks(tasks, 'manual')).filter(matches);
  const isManual = state?.settings.todayOrder === 'manual';
  const reorder = async (sourceId: string, targetId: string) => {
    const ordered = sortTasks(tasks, 'manual').map((task) => task.id);
    const source = ordered.indexOf(sourceId), target = ordered.indexOf(targetId);
    if (source < 0 || target < 0 || source === target) return;
    ordered.splice(source, 1); ordered.splice(target, 0, sourceId);
    const updated = await request<Task[]>('/tasks/reorder', 'POST', { ids: ordered });
    setState((current) => current ? { ...current, tasks: updated } : current);
  };
  const startDrag = (event: DragEvent, id: string) => { event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; setDragId(id); };
  const endDrag = () => { setDragId(null); setDropTarget(null); };
  const onCardDrop = (event: DragEvent, target: string) => { event.preventDefault(); const source = event.dataTransfer.getData('text/plain'); if (source) act(reorder(source, target)); endDrag(); };
  const dueLabel = (task: Task) => task.endDate ? <span className={`due-date ${task.endDate < today && !isDone(task) ? 'overdue' : ''}`}><Clock3 size={12} />{task.endDate === today ? 'Today' : dateLabel(task.endDate)}</span> : null;
  const statusControl = (task: Task) => <span className="status-select" style={{ '--status-color': statusColors[task.status] } as CSSProperties}><i /><select aria-label={`Status for ${task.title}`} value={task.status} disabled={pending > 0} onChange={(event) => act(patchTask(task.id, { status: event.target.value as Status }))}>{statusIds.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select><ChevronDown size={12} /></span>;
  const repeatTask = tasks.find((task) => task.id === repeatId);
  const editedTask = tasks.find((task) => task.id === editor?.id) ?? null;

  return <div className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <div className="sidebar-header">
        <a className="brand" href="#" aria-label="Dayboard: Today" title="Dayboard" onClick={(event) => { event.preventDefault(); setView('today'); }}><span className="brand-icon"><Sunrise size={25} strokeWidth={1.8} /></span><span className="brand-name">dayboard<span className="brand-period">.</span></span></a>
        <button type="button" className="sidebar-collapse-button" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} aria-controls="sidebar-navigation" onClick={() => setSidebarCollapsed(current => !current)}>{sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
      </div>
      <nav id="sidebar-navigation" aria-label="Main navigation">
        <button className={`nav-item ${view === 'today' ? 'active' : ''}`} aria-label="Today" title="Today" onClick={() => setView('today')}><Sun size={19} /><span>Today</span><span className="nav-count">{todayTasks.length}</span></button>
        <button className={`nav-item ${view === 'board' ? 'active' : ''}`} aria-label="The board" title="The board" onClick={() => setView('board')}><LayoutGrid size={18} /><span>The board</span><span className="nav-count">{tasks.length}</span></button>
        <button className={`nav-item nav-settings ${view === 'settings' ? 'active' : ''}`} aria-label="Settings" title="Settings" onClick={() => setView('settings')}><Settings2 size={18} /><span>Settings</span></button>
      </nav>
      <SidebarThemeToggle disabled={!state || pending > 0} onToggle={toggleTheme} />
    </aside>

    <div className="main-shell">
      <main onClick={(event) => {
        const target = event.target as HTMLElement;
        const surface = target.closest<HTMLElement>('[data-task-id]');
        if (surface && !target.closest('button, select, input, a')) {
          const task = tasks.find((item) => item.id === surface.dataset.taskId);
          if (task) openTask(task);
        }
      }}>
        {view === 'settings' ? state ? <SettingsPage state={state} onSave={saveConfig} externalBusy={pending > 0} themeShortcut={themeShortcut} /> : <div className="loading-state">{loadError ? <><p role="alert">{loadError}</p><button className="button button-secondary" onClick={() => void load()}>Try again</button></> : <><LoaderCircle className="spin" size={25} /><p>Loading settings…</p></>}</div> : <>
        <div className={`page-heading${view === 'today' ? ' today-heading' : ''}`}><div><div className={`eyebrow${view === 'today' ? ' today-summary' : ''}`}><Sun size={15} />{view === 'today' ? <><span className="today-summary-date">{longDateLabel(today)}</span><span className="today-summary-stat"><span className="today-summary-separator" aria-hidden="true">•</span>{marked.length} planned for today</span><span className="today-summary-stat"><span className="today-summary-separator" aria-hidden="true">•</span>{completed}/{marked.length} completed ({progress}%)</span></> : dateLabel(today, { weekday: 'long', month: 'long', day: 'numeric' })}</div><h1>{view === 'today' ? 'Today' : 'Board'}</h1><p>{view === 'today' ? 'Tasks marked for today.' : 'All tasks grouped by status.'}</p></div><button className="button button-primary new-task" disabled={!state} onClick={() => addTask()}><Plus size={17} />New task</button></div>

        <div className="section-heading"><div><h2>{view === 'today' ? 'Today’s tasks' : 'All tasks'}<span className="count-badge">{visible.length}</span></h2></div>{view === 'board' && <span className="view-hint"><GripVertical size={14} />Drag cards to change status</span>}</div>

        <div className="toolbar"><label className="search-field"><Search size={17} /><input ref={searchRef} placeholder="Search tasks…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search tasks" />{search ? <button aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button> : <kbd>/</kbd>}</label><div className="toolbar-controls"><label className="assignee-filter"><span className="sr-only">Filter by assignee</span><select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="all">Everyone</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><ChevronDown size={13} /></label>{view === 'today' && state && <><details className="status-filter"><summary><SlidersHorizontal size={15} /><span>Statuses</span><span className="filter-count">{state.settings.todayStatuses.length}</span><ChevronDown size={12} /></summary><div className="filter-popover"><h3>Show these statuses</h3><p>Choose what belongs in Today.</p>{statusIds.map((status) => <label key={status} className="checkbox-label"><input type="checkbox" checked={state.settings.todayStatuses.includes(status)} disabled={pending > 0} onChange={(event) => act(updateSettings({ todayStatuses: event.target.checked ? [...state.settings.todayStatuses, status] : state.settings.todayStatuses.filter((s) => s !== status) }))} /><span className="status-dot" style={{ background: statusColors[status] }} />{statusLabels[status]}</label>)}</div></details><label className="sort-select"><ArrowDownWideNarrow size={15} /><span className="sr-only">Today order</span><select value={state.settings.todayOrder} disabled={pending > 0} onChange={(event) => act(updateSettings({ todayOrder: event.target.value as Settings['todayOrder'] }))}><option value="severity">Severity</option><option value="manual">Manual order</option></select><ChevronDown size={12} /></label></>}</div></div>

        {loadError ? <div className="empty-state"><Circle size={30} /><h3>Connection error</h3><p>{loadError}</p><button className="button button-primary" onClick={() => void load()}>Try again</button></div> : !state ? <div className="loading-state"><LoaderCircle className="spin" size={25} /><p>Loading tasks…</p></div> : view === 'today' ? <>
          {isManual && visible.length > 1 && <p className="manual-hint"><GripVertical size={13} />Drag a task to reorder, or use its arrow buttons.</p>}
          <div className="focus-list">{visible.map((task, index) => { const member = members.find((m) => m.id === task.assigneeId); return <article key={task.id} data-task-id={task.id} className={`focus-card ${isDone(task) ? 'task-complete' : ''} ${dragId === task.id ? 'dragging' : ''} ${dropTarget === task.id ? 'drop-over' : ''}`} onDragOver={(event) => { if (isManual && dragId) { event.preventDefault(); setDropTarget(task.id); } }} onDrop={(event) => { if (isManual) onCardDrop(event, task.id); }}>
            {isManual && <div className="reorder-controls"><button className="drag-handle" draggable onDragStart={(event) => startDrag(event, task.id)} onDragEnd={endDrag} aria-label={`Drag ${task.title} to reorder`}><GripVertical size={16} /></button><div><button aria-label={`Move ${task.title} up`} disabled={index === 0 || pending > 0} onClick={() => act(reorder(task.id, visible[index - 1].id))}><ArrowUp size={12} /></button><button aria-label={`Move ${task.title} down`} disabled={index === visible.length - 1 || pending > 0} onClick={() => act(reorder(task.id, visible[index + 1].id))}><ArrowDown size={12} /></button></div></div>}
            <button className={`complete-button ${isDone(task) ? 'checked' : ''}`} disabled={pending > 0 || !doneStatusId} title={isDone(task) ? 'Reopen task' : 'Mark as done'} aria-label={`${isDone(task) ? 'Reopen' : 'Complete'} ${task.title}`} onClick={() => act(patchTask(task.id, { status: isDone(task) ? openStatusId! : doneStatusId! }))}>{isDone(task) && <Check size={15} />}</button>
            <div className="focus-card-content"><div className="task-kicker"><span className="task-key">{task.key}</span><SeverityBadge severity={task.severity} />{dueLabel(task)}</div><button className="task-title" onClick={() => openTask(task)}>{task.title}</button><p className="task-description">{task.description || 'No description.'}</p><div className="task-meta">{statusControl(task)}<span className="meta-divider" /><span className="assignee-name"><Avatar member={member} small />{member?.name ?? 'Unassigned'}</span>{task.comments.length > 0 && <button className="comment-count" aria-label={`Open ${task.comments.length} comments for ${task.title}`} onClick={() => openTask(task)}><MessageSquare size={13} />{task.comments.length}</button>}</div></div>
            <div className="card-actions"><button className={`repeat-button ${task.repeat ? 'is-repeating' : ''}`} aria-label={`Repeat ${task.title}`} onClick={() => setRepeatId(task.id)}><Repeat2 size={14} /><span>{task.repeat ? 'Repeating' : 'Repeat'}</span></button><button className="remove-today icon-button" disabled={pending > 0} title={task.repeat ? 'Skip today; keeps repeat schedule' : 'Remove from Today'} aria-label={`Remove ${task.title} from Today`} onClick={() => toggleToday(task)}><X size={15} /></button></div>
          </article>; })}</div>
          {visible.length === 0 && <div className="empty-state"><span className="empty-sun"><Sun size={32} /></span><h3>{search || assignee !== 'all' ? 'No matching tasks' : todayTasks.length === 0 && marked.length > 0 ? 'No tasks with the selected statuses' : 'No tasks for today'}</h3><p>{search || assignee !== 'all' ? 'Try another search or choose everyone.' : marked.length > 0 ? 'Enable more statuses above to see your planned tasks.' : 'Mark tasks with the sun check on your board, or add something new.'}</p><button className="button button-secondary" onClick={() => { if (search || assignee !== 'all') { setSearch(''); setAssignee('all'); } else setView('board'); }}>{search || assignee !== 'all' ? 'Clear filters' : 'Go to the board'}<ArrowRight size={15} /></button></div>}
          <button className="add-focus" onClick={() => addTask()}><Plus size={16} />Add a task to today<span></span></button>
        </> : <div className="board-columns">{statusIds.map((status) => { const column = visible.filter((task) => task.status === status); return <section key={status} aria-label={`${statusLabels[status]} column`} className={`board-column ${dropTarget === status ? 'column-drop-over' : ''}`} onDragOver={(event) => { if (dragId) { event.preventDefault(); setDropTarget(status); } }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (tasks.some((task) => task.id === id)) act(patchTask(id, { status })); endDrag(); }}><div className="column-header"><span className="status-dot" style={{ background: statusColors[status] }} /><h3>{statusLabels[status]}</h3><span>{column.length}</span><button className="icon-button" aria-label={`Add a task to ${statusLabels[status]}`} onClick={() => addTask(status)}><Plus size={16} /></button></div><div className="column-tasks">{column.map((task) => <article key={task.id} data-task-id={task.id} draggable onDragStart={(event) => startDrag(event, task.id)} onDragEnd={endDrag} className={`board-card ${dragId === task.id ? 'dragging' : ''}`}><div className="board-card-top"><span className="task-key">{task.key}</span><button className={`today-toggle ${isForToday(task, today) ? 'selected' : ''}`} title={isForToday(task, today) ? 'Remove from Today' : 'Mark for Today'} aria-label={`${isForToday(task, today) ? 'Remove' : 'Add'} ${task.title} ${isForToday(task, today) ? 'from' : 'to'} Today`} aria-pressed={isForToday(task, today)} disabled={pending > 0} onClick={() => toggleToday(task)}>{isForToday(task, today) ? <CircleCheck size={17} /> : <Sun size={17} />}</button></div><button className="task-title" onClick={() => openTask(task)}>{task.title}</button><p className="board-description">{task.description}</p><div className="board-card-footer"><Avatar member={members.find((m) => m.id === task.assigneeId)} small /><SeverityBadge severity={task.severity} /><span className="board-due">{dueLabel(task)}</span>{task.repeat && <Repeat2 size={12} className="green-text" />}{task.comments.length > 0 && <button className="comment-count" aria-label={`Open comments for ${task.title}`} onClick={() => openTask(task)}><MessageSquare size={12} />{task.comments.length}</button>}</div></article>)}{column.length === 0 && <p className="empty-column">No tasks</p>}</div><button className="column-add" onClick={() => addTask(status)}><Plus size={14} />Add task</button></section>; })}</div>}
        <footer className="page-footer"><span className="footer-today">{visible.length} {visible.length === 1 ? 'task' : 'tasks'}</span>{pending > 0 && <span role="status">Saving…</span>}</footer>
        </>}
      </main>
    </div>
    {editor && <TaskDialog task={editedTask} defaultStatus={editor.status} defaultAssigneeId={state?.settings.defaultAssigneeId ?? 'unassigned'} members={members} statuses={statuses} onClose={closeEditor} onSave={saveTask} onDelete={deleteTask} onComment={addComment} />}
    {repeatTask && <RepeatDialog task={repeatTask} today={today} onClose={closeRepeat} onSave={(repeat) => patchTask(repeatTask.id, repeat ? { repeat, todayDate: today, dismissedOn: null } : { repeat: null })} />}
    {toast && <div className="toast" role="alert"><span>{toast}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setToast('')}><X size={16} /></button></div>}
  </div>;
}
