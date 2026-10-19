import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Check, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import type { BoardState, StatusDefinition, ThemeMode, ThemePreference } from './domain';
import AppearancePanel from './AppearancePanel';
import { applyTheme } from './theme';
import './SettingsPage.css';

export interface ConfigDraft {
  members: { id: string; name: string; color: string }[];
  statuses: StatusDefinition[];
  username: string;
  theme: ThemePreference;
}

interface SettingsPageProps {
  state: BoardState;
  onSave: (config: ConfigDraft) => Promise<void>;
  externalBusy?: boolean;
  themeShortcut?: { mode: ThemeMode; sequence: number } | null;
}

function readConfig(state: BoardState): ConfigDraft {
  return {
    username: state.settings.username,
    theme: { ...state.settings.theme },
    members: state.members.filter(member => member.id !== 'unassigned').map(({ id, name, color }) => ({ id, name, color })),
    statuses: state.statuses.map(status => ({ ...status })),
  };
}

function taskCount(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

function createId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function SettingsPage({ state, onSave, externalBusy = false, themeShortcut }: SettingsPageProps) {
  const storedConfig = JSON.stringify(readConfig(state));
  const [draft, setDraft] = useState<ConfigDraft>(() => readConfig(state));
  const [memberName, setMemberName] = useState('');
  const [memberColor, setMemberColor] = useState('#6479d6');
  const [statusName, setStatusName] = useState('');
  const [statusColor, setStatusColor] = useState('#6479d6');
  const [pending, setPending] = useState(false);
  const busy = pending || externalBusy;
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const id = useId();
  const savedTheme = useRef(state.settings.theme);
  const previousStoredConfig = useRef(storedConfig);
  const appliedShortcut = useRef(themeShortcut?.sequence);
  savedTheme.current = state.settings.theme;
  const dirty = JSON.stringify(draft) !== storedConfig;
  const openStatusCount = draft.statuses.filter(status => !status.isDone).length;

  useEffect(() => {
    const next = JSON.parse(storedConfig) as ConfigDraft;
    const previous = JSON.parse(previousStoredConfig.current) as ConfigDraft;
    previousStoredConfig.current = storedConfig;
    const { theme: previousTheme, ...previousFields } = previous;
    const { theme: nextTheme, ...nextFields } = next;
    if (JSON.stringify(previousFields) === JSON.stringify(nextFields)) {
      setDraft(current => ({ ...current, theme: {
        mode: nextTheme.mode !== previousTheme.mode ? nextTheme.mode : current.theme.mode,
        color: nextTheme.color !== previousTheme.color ? nextTheme.color : current.theme.color,
      } }));
    } else setDraft(next);
  }, [storedConfig]);

  useLayoutEffect(() => {
    if (themeShortcut && themeShortcut.sequence !== appliedShortcut.current) {
      appliedShortcut.current = themeShortcut.sequence;
      setDraft(current => ({ ...current, theme: { ...current.theme, mode: themeShortcut.mode } }));
    }
  }, [themeShortcut]);

  useLayoutEffect(() => { applyTheme(draft.theme); }, [draft.theme.mode, draft.theme.color]);
  useLayoutEffect(() => () => { applyTheme(savedTheme.current, true); }, []);

  function updateDraft(update: (current: ConfigDraft) => ConfigDraft) {
    setDraft(update);
    setError('');
    setSaved(false);
  }

  function addMember() {
    const name = memberName.trim();
    if (!name || busy) return;
    updateDraft(current => ({ ...current, members: [...current.members, { id: createId(), name, color: memberColor }] }));
    setMemberName('');
  }

  function addStatus() {
    const name = statusName.trim();
    if (!name || busy) return;
    updateDraft(current => ({ ...current, statuses: [...current.statuses, { id: createId(), name, color: statusColor, isDone: false }] }));
    setStatusName('');
  }

  function addOnEnter(event: KeyboardEvent<HTMLInputElement>, add: () => void) {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    }
  }

  function moveStatus(index: number, direction: -1 | 1) {
    updateDraft(current => {
      const statuses = [...current.statuses];
      const next = index + direction;
      if (next < 0 || next >= statuses.length) return current;
      [statuses[index], statuses[next]] = [statuses[next], statuses[index]];
      return { ...current, statuses };
    });
  }

  function reset() {
    setDraft(readConfig(state));
    setMemberName('');
    setStatusName('');
    setMemberColor('#6479d6');
    setStatusColor('#6479d6');
    setError('');
    setSaved(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const config: ConfigDraft = {
      username: draft.username.trim(),
      theme: { ...draft.theme },
      members: draft.members.map(member => ({ ...member, name: member.name.trim() })),
      statuses: draft.statuses.map(status => ({ ...status, name: status.name.trim() })),
    };
    if (!config.username) { setError('Enter the name you want to use for comments.'); return; }
    if (config.members.some(member => !member.name)) { setError('Give each assignee a name, or remove the empty assignee.'); return; }
    if (config.statuses.some(status => !status.name)) { setError('Give each status a name.'); return; }
    if (!config.statuses.length || config.statuses.every(status => status.isDone)) {
      setError('Keep at least one status that is not marked as completed.');
      return;
    }
    setPending(true);
    setError('');
    setSaved(false);
    try {
      await onSave(config);
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save settings. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return <form className="settings-page" onSubmit={event => void save(event)} aria-label="Board settings" aria-busy={busy}>
    <div className="page-heading"><div><h1>Settings</h1><p>Appearance, names, and board statuses.</p></div><div className="settings-header-actions"><span className="settings-save-status" role="status">{saved && <><Check size={16} />Saved</>}</span><button type="submit" className="button button-primary" disabled={busy || !dirty}>{pending ? 'Saving…' : 'Save settings'}</button></div></div>
    <fieldset className="settings-fields" disabled={busy}>
      <AppearancePanel value={draft.theme} onChange={theme => updateDraft(current => ({ ...current, theme }))} />
      <section className="settings-section" aria-labelledby={`${id}-name-heading`}>
        <div className="settings-section-heading">
          <h2 id={`${id}-name-heading`}>Your name</h2>
          <p>This name appears on new comments. It is a label, with no account or sign-in.</p>
        </div>
        <label className="form-field settings-username">Name
          <input name="username" autoComplete="nickname" required maxLength={80} value={draft.username} onChange={event => updateDraft(current => ({ ...current, username: event.target.value }))} />
        </label>
      </section>

      <section className="settings-section" aria-labelledby={`${id}-assignees-heading`}>
        <div className="settings-section-heading">
          <h2 id={`${id}-assignees-heading`}>Assignees</h2>
          <p>Add the names you want to assign tasks to. Removing a name makes its tasks unassigned.</p>
        </div>
        <div className="settings-rows">
          {draft.members.map((member, index) => {
            const count = state.tasks.filter(task => task.assigneeId === member.id).length;
            return <div className="settings-edit-row settings-member-row" key={member.id}>
              <label className="form-field settings-row-name">Name
                <input aria-label={`Assignee ${index + 1} name`} required maxLength={80} value={member.name} onChange={event => updateDraft(current => ({ ...current, members: current.members.map(item => item.id === member.id ? { ...item, name: event.target.value } : item) }))} />
              </label>
              <label className="form-field settings-color">Color
                <input type="color" aria-label={`Color for assignee ${member.name || index + 1}`} value={member.color} onChange={event => updateDraft(current => ({ ...current, members: current.members.map(item => item.id === member.id ? { ...item, color: event.target.value } : item) }))} />
              </label>
              <span className="settings-task-count">{taskCount(count)}</span>
              <button type="button" className="button button-secondary settings-remove" aria-label={`Remove assignee ${member.name || index + 1}`} onClick={() => updateDraft(current => ({ ...current, members: current.members.filter(item => item.id !== member.id) }))}><Trash2 size={14} />Remove</button>
            </div>;
          })}
          {!draft.members.length && <p className="settings-empty">No assignees yet. Tasks can stay unassigned.</p>}
        </div>
        <div className="settings-add-row">
          <label className="form-field settings-row-name">New assignee
            <input aria-label="New assignee name" maxLength={80} placeholder="Name" value={memberName} onChange={event => setMemberName(event.target.value)} onKeyDown={event => addOnEnter(event, addMember)} />
          </label>
          <label className="form-field settings-color">Color
            <input type="color" aria-label="New assignee color" value={memberColor} onChange={event => setMemberColor(event.target.value)} />
          </label>
          <button type="button" className="button button-secondary" disabled={!memberName.trim()} onClick={addMember}><Plus size={15} />Add assignee</button>
        </div>
      </section>

      <section className="settings-section" aria-labelledby={`${id}-statuses-heading`}>
        <div className="settings-section-heading">
          <h2 id={`${id}-statuses-heading`}>Statuses</h2>
          <p>Set your board columns and their order. Mark statuses as completed to count their tasks as done.</p>
        </div>
        <div className="settings-rows">
          {draft.statuses.map((status, index) => {
            const count = state.tasks.filter(task => task.status === status.id).length;
            const lastOpen = !status.isDone && openStatusCount === 1;
            const removeReason = count > 0 ? 'Move its tasks to another status before removing it.' : lastOpen ? 'Keep at least one status that is not completed.' : '';
            const label = status.name || `status ${index + 1}`;
            return <div className="settings-status-entry" key={status.id}>
              <div className="settings-edit-row settings-status-row">
                <div className="settings-reorder" role="group" aria-label={`Order for ${label}`}>
                  <button type="button" className="icon-button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => moveStatus(index, -1)}><ArrowUp size={15} /></button>
                  <button type="button" className="icon-button" aria-label={`Move ${label} down`} disabled={index === draft.statuses.length - 1} onClick={() => moveStatus(index, 1)}><ArrowDown size={15} /></button>
                </div>
                <label className="form-field settings-row-name">Name
                  <input aria-label={`Status ${index + 1} name`} required maxLength={80} value={status.name} onChange={event => updateDraft(current => ({ ...current, statuses: current.statuses.map(item => item.id === status.id ? { ...item, name: event.target.value } : item) }))} />
                </label>
                <label className="form-field settings-color">Color
                  <input type="color" aria-label={`Color for ${label}`} value={status.color} onChange={event => updateDraft(current => ({ ...current, statuses: current.statuses.map(item => item.id === status.id ? { ...item, color: event.target.value } : item) }))} />
                </label>
                <label className="checkbox-label settings-completed"><input type="checkbox" aria-label={`Completed status: ${label}`} checked={status.isDone} disabled={lastOpen} onChange={event => updateDraft(current => ({ ...current, statuses: current.statuses.map(item => item.id === status.id ? { ...item, isDone: event.target.checked } : item) }))} />Completed</label>
                <span className="settings-task-count">{taskCount(count)}</span>
                <button type="button" className="button button-secondary settings-remove" aria-label={`Remove status ${label}`} disabled={Boolean(removeReason)} title={removeReason || undefined} aria-describedby={removeReason ? `${id}-status-${status.id}-note` : undefined} onClick={() => updateDraft(current => ({ ...current, statuses: current.statuses.filter(item => item.id !== status.id) }))}><Trash2 size={14} />Remove</button>
              </div>
              {removeReason && <p className="settings-row-note" id={`${id}-status-${status.id}-note`}>{removeReason}</p>}
            </div>;
          })}
        </div>
        <div className="settings-add-row">
          <label className="form-field settings-row-name">New status
            <input aria-label="New status name" maxLength={80} placeholder="Status name" value={statusName} onChange={event => setStatusName(event.target.value)} onKeyDown={event => addOnEnter(event, addStatus)} />
          </label>
          <label className="form-field settings-color">Color
            <input type="color" aria-label="New status color" value={statusColor} onChange={event => setStatusColor(event.target.value)} />
          </label>
          <button type="button" className="button button-secondary" disabled={!statusName.trim()} onClick={addStatus}><Plus size={15} />Add status</button>
        </div>
      </section>
    </fieldset>

    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="settings-footer">
      <div className="settings-save-status" role="status" aria-live="polite">{saved && <><Check size={16} />Saved</>}</div>
      <button type="button" className="button button-secondary" onClick={reset} disabled={busy}>Reset changes</button>
      <button className="button button-primary" type="submit" disabled={busy || !dirty}>{pending && <LoaderCircle className="spin" size={15} />}{pending ? 'Saving…' : 'Save settings'}</button>
    </div>
  </form>;
}
