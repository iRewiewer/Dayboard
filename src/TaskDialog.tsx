import { useEffect, useId, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import Modal from './Modal';
import { SEVERITIES, SEVERITY_LABELS } from './domain';
import type { Member, Status, StatusDefinition, Task } from './domain';

export type TaskDraft = Pick<Task, 'title' | 'description' | 'status' | 'severity' | 'assigneeId' | 'startDate' | 'endDate'>;

interface TaskDialogProps {
  task: Task | null;
  defaultStatus?: Status;
  statuses: StatusDefinition[];
  members: Member[];
  onClose: () => void;
  onSave: (values: TaskDraft, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onComment: (id: string, body: string) => Promise<void>;
}

function initialDraft(task: Task | null, defaultStatus: Status): TaskDraft {
  return {
    title: task?.title ?? '', description: task?.description ?? '', status: task?.status ?? defaultStatus,
    severity: task?.severity ?? 'medium', assigneeId: task?.assigneeId ?? 'unassigned',
    startDate: task?.startDate ?? null, endDate: task?.endDate ?? null,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function commentDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
    : value;
}

export default function TaskDialog({ task, defaultStatus, statuses, members, onClose, onSave, onDelete, onComment }: TaskDialogProps) {
  const initialStatus = defaultStatus ?? statuses.find(status => !status.isDone)?.id ?? statuses[0]?.id ?? '';
  const [draft, setDraft] = useState<TaskDraft>(() => initialDraft(task, initialStatus));
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState<'save' | 'delete' | 'comment' | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const errorId = useId();
  const commentId = useId();
  const busy = pending !== null;

  useEffect(() => {
    setDraft(initialDraft(task, initialStatus));
    setComment('');
    setError('');
    setConfirmDelete(false);
    // A comments update must not replace in-progress edits to the same task.
  }, [task?.id, initialStatus]);

  function update<Key extends keyof TaskDraft>(key: Key, value: TaskDraft[Key]) {
    setDraft(previous => ({ ...previous, [key]: value }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const values = { ...draft, startDate: String(fields.get('startDate') ?? '') || null, endDate: String(fields.get('endDate') ?? '') || null };
    if (!values.title.trim()) { setError('Give this task a title.'); return; }
    if (values.startDate && values.endDate && values.endDate < values.startDate) {
      setError('The end date must be on or after the start date.');
      return;
    }
    setError('');
    setPending('save');
    try {
      await onSave({ ...values, title: values.title.trim() }, task?.id);
      onClose();
    } catch (failure) { setError(message(failure)); }
    finally { setPending(null); }
  }

  async function remove() {
    if (!task || busy) return;
    setError('');
    setPending('delete');
    try { await onDelete(task.id); onClose(); }
    catch (failure) { setError(message(failure)); }
    finally { setPending(null); }
  }

  async function postComment() {
    if (!task || !comment.trim() || busy) return;
    setError('');
    setPending('comment');
    try { await onComment(task.id, comment.trim()); setComment(''); }
    catch (failure) { setError(message(failure)); }
    finally { setPending(null); }
  }

  return <Modal title={task?.key ?? 'New task'} subtitle={task ? 'Edit task details and comments.' : 'Enter task details.'} onClose={onClose} canClose={!busy} wide>
    <form className="task-form" onSubmit={save} aria-busy={busy} aria-describedby={error ? errorId : undefined}>
      <div className="modal-body">
        <label className="form-field">Task title <span aria-hidden="true">*</span>
          <input data-autofocus required maxLength={160} value={draft.title} onChange={event => update('title', event.target.value)} placeholder="What needs to get done?" disabled={busy} />
        </label>
        <label className="form-field">Description
          <textarea value={draft.description} maxLength={10000} onChange={event => update('description', event.target.value)} placeholder="Add context, a useful link, or what done looks like…" rows={4} disabled={busy} />
        </label>
        <div className="form-grid">
          <label className="form-field">Status
            <select required value={draft.status} onChange={event => update('status', event.target.value)} disabled={busy}>
              {statuses.map(status => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
          </label>
          <label className="form-field">Severity
            <select value={draft.severity} onChange={event => update('severity', event.target.value as TaskDraft['severity'])} disabled={busy}>
              {SEVERITIES.map(severity => <option key={severity} value={severity}>{SEVERITY_LABELS[severity]}</option>)}
            </select>
          </label>
          <label className="form-field">Assignee
            <select value={draft.assigneeId} onChange={event => update('assigneeId', event.target.value)} disabled={busy}>
              <option value="unassigned">Unassigned</option>
              {members.filter(member => member.id !== 'unassigned').map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
          <label className="form-field">Start date
            <input name="startDate" type="date" value={draft.startDate ?? ''} onInput={event => update('startDate', event.currentTarget.value || null)} onChange={event => update('startDate', event.target.value || null)} disabled={busy} />
          </label>
          <label className="form-field">End date
            <input name="endDate" type="date" min={draft.startDate ?? undefined} value={draft.endDate ?? ''} onInput={event => update('endDate', event.currentTarget.value || null)} onChange={event => update('endDate', event.target.value || null)} disabled={busy} />
          </label>
        </div>
        {task && <section className="task-comments" aria-labelledby={`${commentId}-heading`}>
          <h3 id={`${commentId}-heading`}><MessageSquare size={16} aria-hidden="true" /> Comments <span className="comment-count">{task.comments.length}</span></h3>
          <div className="comment-list" aria-live="polite" aria-relevant="additions">
            {task.comments.length === 0 && <p className="empty-comments">No comments yet. Start the conversation.</p>}
            {task.comments.map(entry => {
              const member = members.find(value => value.id === entry.author || value.name === entry.author);
              const name = member?.name ?? entry.author;
              const initials = member?.initials ?? name.split(/\s+/).filter(Boolean).slice(0, 2).map(value => value[0]).join('').toUpperCase();
              return <article className="comment" key={entry.id}>
                <span className="avatar comment-avatar" style={{ '--avatar-color': member?.color ?? 'var(--muted)' } as CSSProperties} aria-hidden="true">{initials || '?'}</span>
                <div className="comment-content"><div className="comment-meta"><strong>{name}</strong><time dateTime={entry.createdAt} title={entry.createdAt}>{commentDate(entry.createdAt)}</time></div>
                  <p className="comment-body" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.body}</p>
                </div>
              </article>;
            })}
          </div>
          <div className="comment-compose">
            <label className="form-field" htmlFor={commentId}>Add a comment</label>
            <textarea id={commentId} value={comment} onChange={event => setComment(event.target.value)} placeholder="Share an update…" rows={2} maxLength={5000} disabled={busy} />
            <button type="button" className="button button-secondary" onClick={postComment} disabled={busy || !comment.trim()}><Send size={14} aria-hidden="true" />{pending === 'comment' ? 'Posting…' : 'Post comment'}</button>
          </div>
        </section>}
        {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
        {confirmDelete && <div className="delete-confirmation" role="alert">
          <p>Delete this task and its comments? This cannot be undone.</p>
          <div className="button-group">
            <button type="button" className="button button-secondary" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep task</button>
            <button type="button" className="button button-danger" onClick={remove} disabled={busy}>{pending === 'delete' ? 'Deleting…' : 'Delete task'}</button>
          </div>
        </div>}
      </div>
      <footer className="modal-footer">
        <div>{task && !confirmDelete && <button type="button" className="text-button delete-task" onClick={() => setConfirmDelete(true)} disabled={busy}><Trash2 size={15} aria-hidden="true" /> Delete task</button>}</div>
        <div className="button-group"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={busy || confirmDelete}>{pending === 'save' ? 'Saving…' : task ? 'Save changes' : 'Create task'}</button></div>
      </footer>
    </form>
  </Modal>;
}
