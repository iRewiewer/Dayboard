import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { createApp, DEFAULT_STATUSES, UNASSIGNED_MEMBER, DEFAULT_THEME, THEME_COLORS } from './index.mjs';

function taskRecord(overrides = {}) {
  return {
    id: 'test-task', key: 'DAY-1', title: 'A task of my own', description: 'Keep my details.', status: 'todo', severity: 'medium', assigneeId: 'unassigned',
    startDate: '2026-10-19', endDate: '2026-10-21', todayDate: '2026-10-19', repeat: { startsOn: '2026-10-20', endsOn: null }, dismissedOn: null,
    order: 0, comments: [{ id: 'comment-1', author: 'My earlier name', body: 'Keep this comment.', createdAt: '2026-10-19T12:00:00.000Z' }], createdAt: '2026-10-19T11:00:00.000Z',
    ...overrides,
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '.dayboard-test-'));
  const dataDir = join(directory, 'data');
  const staticDir = join(directory, 'dist');
  await mkdir(staticDir);
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><h1>Dayboard test</h1>');
  let app = createApp({ dataDir, staticDir, ...options });
  let address = await app.listen(0, '127.0.0.1');
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = response.status === 204 ? undefined : await response.json();
    return { status: response.status, body: result };
  };
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    api, directory, dataDir, staticDir,
    url: path => `http://127.0.0.1:${address.port}${path}`,
    async restart() { await app.close(); app = createApp({ dataDir, staticDir, ...options }); address = await app.listen(0, '127.0.0.1'); },
  };
}

test('task CRUD, comments, repeat schedules, settings, and persistence', async t => {
  const { api, restart, dataDir } = await fixture(t);
  assert.deepEqual(await api('/api/health'), { status: 200, body: { status: 'ok' } });
  let state = (await api('/api/state')).body;
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.statuses, DEFAULT_STATUSES);
  assert.deepEqual(state.members, [UNASSIGNED_MEMBER]);
  assert.equal(state.settings.username, 'You');
  assert.equal(state.settings.defaultAssigneeId, 'unassigned');
  assert.deepEqual(state.settings.theme, { mode: 'dark', color: 'green' });
  assert.equal((await api('/api/config', 'PATCH', { members: [{ id: 'alex', name: 'Alex Example', color: '#6479d6' }] })).status, 200);
  const created = await api('/api/tasks', 'POST', { title: '  Ship the focus view  ', description: 'Keep daily work focused.', status: 'in-progress', severity: 'high', assigneeId: 'alex', startDate: '2026-10-19', endDate: '2026-10-21', todayDate: '2026-10-19' });
  assert.equal(created.status, 201);
  const task = created.body;
  assert.equal(task.title, 'Ship the focus view');
  assert.equal(task.key, 'DAY-1');
  assert.deepEqual(task.comments, []);
  const updated = await api(`/api/tasks/${task.id}`, 'PATCH', { repeat: { startsOn: '2026-10-19', endsOn: null }, dismissedOn: '2026-10-20', order: 20 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.repeat.endsOn, null);
  assert.equal(updated.body.dismissedOn, '2026-10-20');
  const commented = await api(`/api/tasks/${task.id}/comments`, 'POST', { body: '  Ready to review.  ' });
  assert.equal(commented.status, 201);
  assert.equal(commented.body.comments[0].body, 'Ready to review.');
  assert.equal(commented.body.comments[0].author, 'You');
  assert.ok(commented.body.comments[0].createdAt);
  const settings = await api('/api/settings', 'PATCH', { todayStatuses: ['in-progress', 'done'], todayOrder: 'manual' });
  assert.equal(settings.status, 200);
  await restart();
  state = (await api('/api/state')).body;
  assert.equal(state.tasks.length, 1, 'reopening the file preserves only tasks created by the user');
  assert.deepEqual(state.tasks[0], commented.body);
  assert.deepEqual(state.settings, settings.body);
  const savedState = JSON.parse(await readFile(join(dataDir, 'dayboard.json'), 'utf8'));
  assert.equal(savedState.version, 2);
  assert.deepEqual(savedState.tasks[0], commented.body);
  const second = await api('/api/tasks', 'POST', { title: 'Follow-up' });
  assert.equal(second.body.key, 'DAY-2');
  assert.equal((await api(`/api/tasks/${task.id}`, 'DELETE')).status, 204);
  assert.equal((await api(`/api/tasks/${task.id}`, 'PATCH', { title: 'Missing' })).status, 404);
  assert.equal((await api('/api/state')).body.tasks.length, 1);
});

test('validation rejects malformed fields and leaves stored data intact', async t => {
  const { api, url } = await fixture(t);
  const invalidTasks = [
    {}, { title: '' }, { title: 'x'.repeat(161) }, { title: 'Task', status: 'unknown' },
    { title: 'Task', severity: 'urgent' }, { title: 'Task', assigneeId: 'nobody' },
    { title: 'Task', todayDate: '2026-02-30' }, { title: 'Task', startDate: 'bad' },
    { title: 'Task', startDate: '2026-10-21', endDate: '2026-10-19' },
    { title: 'Task', repeat: { startsOn: '2026-10-21', endsOn: '2026-10-19' } },
    { title: 'Task', repeat: { startsOn: '2026-10-19' } },
    { title: 'Task', order: -1 }, { title: 'Task', id: 'client-id' }, [], null,
  ];
  for (const body of invalidTasks) {
    const result = await api('/api/tasks', 'POST', body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(typeof result.body.error, 'string');
  }
  for (const body of [{ todayStatuses: ['done', 'done'] }, { todayStatuses: ['unknown'] }, { todayOrder: 'name' }, { defaultAssigneeId: 'nobody' }, { mystery: true }]) {
    assert.equal((await api('/api/settings', 'PATCH', body)).status, 400);
  }
  assert.equal((await api('/api/settings', 'PATCH', { todayStatuses: [] })).status, 200, 'all statuses can be unchecked');
  const task = (await api('/api/tasks', 'POST', { title: 'Valid', startDate: '2026-10-19' })).body;
  assert.equal((await api(`/api/tasks/${task.id}`, 'PATCH', { endDate: '2026-10-18' })).status, 400);
  assert.equal((await api(`/api/tasks/${task.id}/comments`, 'POST', { body: ' ' })).status, 400);
  assert.equal((await api(`/api/tasks/${task.id}/comments`, 'POST', { body: 'Fine', author: '' })).status, 400);
  assert.equal((await api('/api/state')).body.tasks[0].endDate, null);
  const malformed = await fetch(url('/api/tasks'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ broken' });
  assert.equal(malformed.status, 400);
  const unsupported = await fetch(url('/api/tasks'), { method: 'POST', body: 'plain text' });
  assert.equal(unsupported.status, 415);
  const oversized = await fetch(url('/api/tasks'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Task', description: 'x'.repeat(70000) }) });
  assert.equal(oversized.status, 413);
});

test('task numbers follow the highest remaining key without renumbering surviving tasks', async t => {
  const { api, restart, dataDir } = await fixture(t);
  const created = [];
  for (let index = 1; index <= 5; index++) created.push((await api('/api/tasks', 'POST', { title: `Task ${index}` })).body);
  assert.deepEqual(created.map(task => task.key), ['DAY-1', 'DAY-2', 'DAY-3', 'DAY-4', 'DAY-5']);
  assert.equal((await api(`/api/tasks/${created[4].id}`, 'DELETE')).status, 204);
  const reused = (await api('/api/tasks', 'POST', { title: 'Reuse the top number' })).body;
  assert.equal(reused.key, 'DAY-5');
  assert.notEqual(reused.id, created[4].id, 'a reused display number still gets a new UUID');
  assert.equal((await api(`/api/tasks/${created[1].id}`, 'DELETE')).status, 204);
  const afterMiddleDeletion = (await api('/api/tasks', 'POST', { title: 'After a middle deletion' })).body;
  assert.equal(afterMiddleDeletion.key, 'DAY-6', 'a middle gap is not filled while higher tasks remain');
  const survivingOriginals = created.filter((_, index) => index !== 1 && index !== 4);
  const current = (await api('/api/state')).body.tasks;
  for (const task of survivingOriginals) assert.deepEqual(current.find(item => item.id === task.id), task);
  await api(`/api/tasks/${afterMiddleDeletion.id}`, 'DELETE');
  await api(`/api/tasks/${reused.id}`, 'DELETE');
  await restart();
  assert.equal((await api('/api/tasks', 'POST', { title: 'Reuse after restart' })).body.key, 'DAY-5');
  const remaining = (await api('/api/state')).body.tasks;
  for (const task of remaining) assert.equal((await api(`/api/tasks/${task.id}`, 'DELETE')).status, 204);
  assert.equal(JSON.parse(await readFile(join(dataDir, 'dayboard.json'), 'utf8')).nextKey, 1);
  await restart();
  const firstAgain = (await api('/api/tasks', 'POST', { title: 'Fresh start after deleting all' })).body;
  assert.equal(firstAgain.key, 'DAY-1');
  assert.ok(created.every(task => task.id !== firstAgain.id));
});

test('old persisted nextKey counters never override the remaining task numbers', async t => {
  const { api, dataDir, restart } = await fixture(t);
  const ownTask = (await api('/api/tasks', 'POST', { title: 'Keep this UUID and key' })).body;
  const filePath = join(dataDir, 'dayboard.json');
  const oldState = JSON.parse(await readFile(filePath, 'utf8'));
  oldState.tasks[0].key = 'DAY-3';
  oldState.nextKey = 5000;
  await writeFile(filePath, JSON.stringify(oldState, null, 2));
  await restart();
  assert.deepEqual((await api('/api/state')).body.tasks, [{ ...ownTask, key: 'DAY-3' }]);
  let next = (await api('/api/tasks', 'POST', { title: 'After an inflated counter' })).body;
  assert.equal(next.key, 'DAY-4');
  assert.equal(JSON.parse(await readFile(filePath, 'utf8')).nextKey, 5);
  await api(`/api/tasks/${next.id}`, 'DELETE');
  const stale = JSON.parse(await readFile(filePath, 'utf8'));
  stale.nextKey = 1;
  await writeFile(filePath, JSON.stringify(stale, null, 2));
  await restart();
  next = (await api('/api/tasks', 'POST', { title: 'After a stale counter' })).body;
  assert.equal(next.key, 'DAY-4', 'a stale smaller cache cannot allocate a duplicate key');
  await api(`/api/tasks/${next.id}`, 'DELETE');
  await api(`/api/tasks/${ownTask.id}`, 'DELETE');
  const empty = JSON.parse(await readFile(filePath, 'utf8'));
  empty.nextKey = Number.MAX_SAFE_INTEGER;
  await writeFile(filePath, JSON.stringify(empty, null, 2));
  await restart();
  assert.equal((await api('/api/tasks', 'POST', { title: 'Empty legacy board' })).body.key, 'DAY-1');
});

test('safe task number bounds reject overflow without changing state or disk', async t => {
  const { api, dataDir, restart } = await fixture(t);
  const filePath = join(dataDir, 'dayboard.json');
  const state = JSON.parse(await readFile(filePath, 'utf8'));
  state.tasks = [taskRecord({ key: `DAY-${Number.MAX_SAFE_INTEGER - 1}` })];
  state.nextKey = Number.MAX_SAFE_INTEGER;
  await writeFile(filePath, JSON.stringify(state, null, 2));
  await restart();
  const maximum = await api('/api/tasks', 'POST', { title: 'Last safe task number' });
  assert.equal(maximum.status, 201);
  assert.equal(maximum.body.key, `DAY-${Number.MAX_SAFE_INTEGER}`);
  await restart();
  const before = (await api('/api/state')).body;
  const saved = await readFile(filePath, 'utf8');
  const overflow = await api('/api/tasks', 'POST', { title: 'Cannot overflow' });
  assert.equal(overflow.status, 409);
  assert.match(overflow.body.error, /maximum supported value/);
  assert.deepEqual((await api('/api/state')).body, before);
  assert.equal(await readFile(filePath, 'utf8'), saved);
  await api(`/api/tasks/${maximum.body.id}`, 'DELETE');
  const reused = (await api('/api/tasks', 'POST', { title: 'Reuse the last safe number' })).body;
  assert.equal(reused.key, maximum.body.key);
  assert.notEqual(reused.id, maximum.body.id);
});

test('concurrent creates after deleting the highest task allocate distinct remaining numbers', async t => {
  const { api } = await fixture(t);
  await api('/api/tasks', 'POST', { title: 'First' });
  const highest = (await api('/api/tasks', 'POST', { title: 'Delete this top task' })).body;
  await api(`/api/tasks/${highest.id}`, 'DELETE');
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => api('/api/tasks', 'POST', { title: `Concurrent ${index}` })));
  assert.ok(responses.every(response => response.status === 201));
  assert.deepEqual(responses.map(response => Number(response.body.key.slice(4))).sort((a, b) => a - b), [2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(responses.map(response => response.body.id)).size, 6);
});

test('failed deletes and creates preserve the highest number and only successful deletion enables reuse', async t => {
  const { api, dataDir } = await fixture(t);
  await api('/api/tasks', 'POST', { title: 'First' });
  const highest = (await api('/api/tasks', 'POST', { title: 'Highest task' })).body;
  const before = (await api('/api/state')).body;
  const filePath = join(dataDir, 'dayboard.json');
  const backupPath = join(dataDir, 'backup.json');
  const originalFile = await readFile(filePath, 'utf8');
  await rename(filePath, backupPath);
  await mkdir(filePath);
  const logger = t.mock.method(console, 'error', () => {});
  assert.equal((await api(`/api/tasks/${highest.id}`, 'DELETE')).status, 500);
  assert.deepEqual((await api('/api/state')).body, before);
  assert.equal((await api('/api/tasks', 'POST', { title: 'Cannot persist a new number' })).status, 500);
  assert.deepEqual((await api('/api/state')).body, before);
  assert.equal(await readFile(backupPath, 'utf8'), originalFile);
  assert.ok((await readdir(dataDir)).every(name => !name.endsWith('.tmp')));
  await rm(filePath, { recursive: true });
  await rename(backupPath, filePath);
  logger.mock.restore();
  const afterFailure = (await api('/api/tasks', 'POST', { title: 'First successful new task' })).body;
  assert.equal(afterFailure.key, 'DAY-3', 'the failed delete did not release DAY-2');
  await api(`/api/tasks/${afterFailure.id}`, 'DELETE');
  await api(`/api/tasks/${highest.id}`, 'DELETE');
  assert.equal((await api('/api/tasks', 'POST', { title: 'After a successful top deletion' })).body.key, 'DAY-2');
});

test('manual reordering preserves hidden task positions and rejects invalid lists atomically', async t => {
  const { api, restart } = await fixture(t);
  const tasks = [];
  for (const title of ['First', 'Hidden', 'Third', 'Fourth']) tasks.push((await api('/api/tasks', 'POST', { title })).body);
  const reordered = await api('/api/tasks/reorder', 'POST', { ids: [tasks[3].id, tasks[0].id, tasks[2].id] });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.map(task => task.title), ['Fourth', 'Hidden', 'First', 'Third']);
  assert.deepEqual(reordered.body.map(task => task.order), [0, 1, 2, 3]);
  assert.equal((await api('/api/tasks/reorder', 'POST', { ids: [tasks[0].id, tasks[0].id] })).status, 400);
  assert.equal((await api('/api/tasks/reorder', 'POST', { ids: [tasks[0].id, 'missing'] })).status, 404);
  assert.equal((await api('/api/tasks/reorder', 'POST', { ids: [4] })).status, 400);
  assert.equal((await api('/api/tasks/reorder', 'POST', { ids: [] })).status, 200);
  await restart();
  assert.deepEqual((await api('/api/state')).body.tasks.map(task => task.id), reordered.body.map(task => task.id));
});

test('concurrent comments and patches preserve each submitted change', async t => {
  const { api } = await fixture(t);
  const task = (await api('/api/tasks', 'POST', { title: 'Concurrent task' })).body;
  const responses = await Promise.all([
    api(`/api/tasks/${task.id}/comments`, 'POST', { body: 'First comment', author: 'Alex' }),
    api(`/api/tasks/${task.id}/comments`, 'POST', { body: 'Second comment', author: 'Morgan' }),
    api(`/api/tasks/${task.id}`, 'PATCH', { severity: 'critical' }),
    api(`/api/tasks/${task.id}`, 'PATCH', { status: 'in-review' }),
  ]);
  assert.ok(responses.every(response => [200, 201].includes(response.status)));
  const final = (await api('/api/state')).body.tasks[0];
  assert.equal(final.comments.length, 2);
  assert.equal(final.severity, 'critical');
  assert.equal(final.status, 'in-review');
});

test('a failed atomic save preserves previous memory, disk data, and task sequence', async t => {
  const { api, dataDir } = await fixture(t);
  const original = (await api('/api/tasks', 'POST', { title: 'Keep this task' })).body;
  const filePath = join(dataDir, 'dayboard.json');
  const backupPath = join(dataDir, 'backup.json');
  const originalFile = await readFile(filePath, 'utf8');
  await rename(filePath, backupPath);
  await mkdir(filePath);
  const logger = t.mock.method(console, 'error', () => {});
  const failed = await api('/api/tasks', 'POST', { title: 'Cannot persist' });
  assert.equal(failed.status, 500);
  assert.deepEqual((await api('/api/state')).body.tasks, [original]);
  assert.equal(await readFile(backupPath, 'utf8'), originalFile);
  assert.ok((await readdir(dataDir)).every(name => !name.endsWith('.tmp')), 'failed writes clean up their temporary file');
  await rm(filePath, { recursive: true });
  await rename(backupPath, filePath);
  logger.mock.restore();
  const next = await api('/api/tasks', 'POST', { title: 'Can persist again' });
  assert.equal(next.status, 201);
  assert.equal(next.body.key, 'DAY-2');
});

test('startup rejects corrupt persisted state without overwriting the original file', async t => {
  const directory = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '.dayboard-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = createApp({ dataDir: directory });
  await app.close();
  const filePath = join(directory, 'dayboard.json');
  const original = JSON.parse(await readFile(filePath, 'utf8'));
  original.tasks = [taskRecord()];
  original.nextKey = 2;
  const invalidStates = [
    { ...original, tasks: [{}] },
    { ...original, tasks: [original.tasks[0], original.tasks[0]] },
    { ...original, settings: {} },
    { ...original, nextKey: 0 },
    { ...original, nextKey: Number.MAX_SAFE_INTEGER + 1 },
    ...['DAY-0', 'DAY-01', 'DAY--1', 'DAY-1.5', 'DAY-1e3', `DAY-${Number.MAX_SAFE_INTEGER + 1}`].map(key => ({ ...original, tasks: [taskRecord({ key })] })),
    { ...original, tasks: [{ ...original.tasks[0], comments: [{ id: 'broken', author: 'You', body: 'Missing timestamp' }] }] },
  ];
  for (const state of invalidStates) {
    const contents = JSON.stringify(state, null, 2);
    await writeFile(filePath, contents);
    assert.throws(() => createApp({ dataDir: directory }), /dayboard\.json is invalid/);
    assert.equal(await readFile(filePath, 'utf8'), contents);
  }
  await writeFile(filePath, '{ broken JSON');
  assert.throws(() => createApp({ dataDir: directory }), SyntaxError);
  assert.equal(await readFile(filePath, 'utf8'), '{ broken JSON');
});

test('fresh installs and restarts have no example tasks or fabricated members', async t => {
  const { api, restart } = await fixture(t);
  const state = (await api('/api/state')).body;
  assert.deepEqual(state.tasks, []);
  assert.deepEqual(state.members, [UNASSIGNED_MEMBER]);
  assert.equal(state.settings.username, 'You');
  await restart();
  assert.deepEqual((await api('/api/state')).body, state);
  const created = (await api('/api/tasks', 'POST', { title: 'My first task' })).body;
  assert.equal(created.key, 'DAY-1');
  assert.equal(created.status, state.statuses.find(status => !status.isDone).id);
});

test('custom assignees, statuses, and display name persist and author only future comments', async t => {
  const { api, restart, dataDir } = await fixture(t);
  const configured = await api('/api/config', 'PATCH', {
    username: '  Riley O’Neil  ',
    members: [{ id: 'own-person', name: '  Riley O’Neil  ', color: '#A1B2C3', initials: 'ignored' }],
    statuses: [
      { id: 'waiting', name: 'Ready to begin', color: '#123ABC', isDone: false },
      { id: 'accepted', name: 'Accepted', color: '#239f6a', isDone: true },
    ],
  });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.settings.username, 'Riley O’Neil');
  assert.deepEqual(configured.body.members, [UNASSIGNED_MEMBER, { id: 'own-person', name: 'Riley O’Neil', initials: 'RO', color: '#a1b2c3' }]);
  assert.equal(configured.body.statuses[0].color, '#123abc');
  assert.deepEqual(configured.body.settings.todayStatuses, ['waiting'], 'only newly added unfinished statuses are enabled');
  const created = (await api('/api/tasks', 'POST', { title: 'My own workflow', assigneeId: 'own-person' })).body;
  assert.equal(created.status, 'waiting');
  let task = (await api(`/api/tasks/${created.id}/comments`, 'POST', { body: 'Written with my chosen name.' })).body;
  assert.equal(task.comments[0].author, 'Riley O’Neil');
  assert.equal((await api('/api/config', 'PATCH', { username: 'Riley' })).status, 200);
  task = (await api(`/api/tasks/${created.id}/comments`, 'POST', { body: 'Written after changing my name.' })).body;
  assert.deepEqual(task.comments.map(comment => comment.author), ['Riley O’Neil', 'Riley']);
  const renamed = await api('/api/config', 'PATCH', {
    members: [{ id: 'own-person', name: 'Riley Updated', color: '#445566' }],
    statuses: [{ id: 'waiting', name: 'In development', color: '#123abc', isDone: false }, { id: 'accepted', name: 'Shipped', color: '#239f6a', isDone: true }],
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.tasks[0].status, 'waiting', 'renaming keeps stable task status IDs');
  assert.equal(renamed.body.tasks[0].assigneeId, 'own-person');
  assert.deepEqual(renamed.body.tasks[0].comments.map(comment => comment.author), ['Riley O’Neil', 'Riley']);
  await restart();
  assert.deepEqual((await api('/api/state')).body, renamed.body);
  const stored = JSON.parse(await readFile(join(dataDir, 'dayboard.json'), 'utf8'));
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.members, renamed.body.members);
  assert.deepEqual(stored.statuses, renamed.body.statuses);
});

test('status removal is guarded, removed assignees are reassigned, and Today filters stay valid', async t => {
  const { api, restart } = await fixture(t);
  const initial = (await api('/api/config', 'PATCH', { members: [{ id: 'person-1', name: 'My teammate', color: '#112233' }] })).body;
  const task = (await api('/api/tasks', 'POST', { title: 'Do not discard this task', status: 'todo', assigneeId: 'person-1' })).body;
  await api('/api/settings', 'PATCH', { todayStatuses: ['backlog', 'todo'], todayOrder: 'manual' });
  const removeTodo = initial.statuses.filter(status => status.id !== 'todo');
  const before = (await api('/api/state')).body;
  const rejected = await api('/api/config', 'PATCH', { statuses: removeTodo, members: [], username: 'Should not change' });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /Move tasks.*To do/);
  assert.deepEqual((await api('/api/state')).body, before, 'all config fields remain unchanged when removal is blocked');
  await api(`/api/tasks/${task.id}`, 'PATCH', { status: 'in-progress' });
  const added = [
    ...removeTodo,
    { id: 'blocked', name: 'Blocked', color: '#bb6655', isDone: false },
    { id: 'archived', name: 'Archived', color: '#559988', isDone: true },
  ];
  const saved = await api('/api/config', 'PATCH', { statuses: added, members: [] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.members, [UNASSIGNED_MEMBER]);
  assert.equal(saved.body.tasks.length, 1);
  assert.equal(saved.body.tasks[0].id, task.id);
  assert.equal(saved.body.tasks[0].assigneeId, 'unassigned');
  assert.deepEqual(saved.body.settings.todayStatuses, ['backlog', 'blocked'], 'removed statuses are pruned; new unfinished statuses are added');
  assert.equal(saved.body.settings.todayOrder, 'manual');
  assert.equal((await api('/api/tasks', 'POST', { title: 'Invalid old assignee', assigneeId: 'person-1' })).status, 400);
  assert.equal((await api('/api/settings', 'PATCH', { todayStatuses: ['todo'] })).status, 400);
  assert.equal((await api(`/api/tasks/${task.id}`, 'PATCH', { status: 'todo' })).status, 400);
  await restart();
  assert.deepEqual((await api('/api/state')).body, saved.body);
});

test('completion flags and task defaults use configured semantics rather than built-in IDs', async t => {
  const { api } = await fixture(t);
  const statuses = [
    { id: 'todo', name: 'Finished work', color: '#559988', isDone: true },
    { id: 'done', name: 'New work', color: '#556699', isDone: false },
  ];
  const configured = await api('/api/config', 'PATCH', { statuses });
  assert.equal(configured.status, 200);
  const task = (await api('/api/tasks', 'POST', { title: 'Start in the first unfinished status' })).body;
  assert.equal(task.status, 'done');
  assert.equal((await api(`/api/tasks/${task.id}`, 'PATCH', { status: 'todo' })).status, 200);
  assert.equal((await api('/api/state')).body.statuses.find(status => status.id === 'todo').isDone, true);
  const noDoneStatuses = [{ id: 'todo', name: 'Active', color: '#556699', isDone: false }];
  assert.equal((await api('/api/config', 'PATCH', { statuses: noDoneStatuses })).status, 200, 'a workflow may have no completed status');
  assert.equal((await api('/api/tasks', 'POST', { title: 'Another task' })).body.status, 'todo');
});

test('configuration validation is atomic and protects system entries', async t => {
  const { api, dataDir } = await fixture(t);
  const state = (await api('/api/state')).body;
  const originalFile = await readFile(join(dataDir, 'dayboard.json'), 'utf8');
  const status = { id: 'custom', name: 'Custom', color: '#123456', isDone: false };
  const member = { id: 'mine', name: 'My assignee', color: '#123456' };
  const invalid = [
    { statuses: [] }, { statuses: [{ ...status, isDone: true }] },
    { statuses: [{ ...status, isDone: 'false' }] }, { statuses: [{ ...status, name: ' ' }] },
    { statuses: [{ ...status, name: 'x'.repeat(81) }] }, { statuses: [{ ...status, id: '../outside' }] },
    { statuses: [{ ...status, color: '#fff' }] }, { statuses: [status, status] },
    { statuses: [status, { ...status, id: 'different', name: '  cUsToM  ' }] },
    { statuses: Array.from({ length: 101 }, (_, i) => ({ ...status, id: `s-${i}`, name: `Status ${i}` })) },
    { members: [{ ...member, id: 'unassigned' }] }, { members: [{ ...member, name: 'UNASSIGNED' }] },
    { members: [{ ...member, id: 'bad/id' }] }, { members: [{ ...member, color: 'blue' }] },
    { members: [{ ...member, name: '' }] }, { members: [member, member] },
    { members: [member, { ...member, id: 'other', name: '  MY ASSIGNEE  ' }] },
    { members: Array.from({ length: 101 }, (_, i) => ({ ...member, id: `m-${i}`, name: `Member ${i}` })) },
    { username: '' }, { username: 'x'.repeat(81) }, { accounts: [] }, null, [],
    { username: 'Valid new name', members: [member], statuses: [] },
  ];
  for (const body of invalid) {
    const result = await api('/api/config', 'PATCH', body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual((await api('/api/state')).body, state);
    assert.equal(await readFile(join(dataDir, 'dayboard.json'), 'utf8'), originalFile);
  }
});

test('v1 migration preserves existing tasks and comments while removing fabricated membership', async t => {
  const { api, dataDir, restart } = await fixture(t);
  const legacyTasks = [taskRecord({ id: 'my-legacy-task', key: 'DAY-101', assigneeId: 'alex' }), taskRecord({ id: 'another-legacy-task', key: 'DAY-102', title: 'Another personal task', assigneeId: 'unassigned', status: 'done', order: 1 })];
  const legacy = { version: 1, tasks: legacyTasks, settings: { todayStatuses: ['todo', 'done'], todayOrder: 'manual' }, nextKey: 103 };
  await writeFile(join(dataDir, 'dayboard.json'), JSON.stringify(legacy, null, 2));
  await restart();
  const migrated = (await api('/api/state')).body;
  assert.deepEqual(migrated.tasks, legacyTasks.map(task => ({ ...task, assigneeId: 'unassigned' })));
  assert.deepEqual(migrated.members, [UNASSIGNED_MEMBER]);
  assert.deepEqual(migrated.statuses, DEFAULT_STATUSES);
  assert.deepEqual(migrated.settings, { ...legacy.settings, username: 'You', defaultAssigneeId: 'unassigned', theme: DEFAULT_THEME });
  const saved = JSON.parse(await readFile(join(dataDir, 'dayboard.json'), 'utf8'));
  assert.equal(saved.version, 2);
  assert.equal(saved.nextKey, 103);
  assert.deepEqual(saved.tasks, migrated.tasks);
  assert.equal((await api('/api/tasks', 'POST', { title: 'After migration' })).body.key, 'DAY-103');
  await restart();
  assert.equal((await api('/api/state')).body.tasks.length, 3);
});

test('an empty v1 board migrates to an empty v2 board starting with DAY-1', async t => {
  const { api, dataDir, restart } = await fixture(t);
  await writeFile(join(dataDir, 'dayboard.json'), JSON.stringify({ version: 1, tasks: [], settings: { todayStatuses: ['todo'], todayOrder: 'severity' }, nextKey: 113 }));
  await restart();
  assert.deepEqual((await api('/api/state')).body.tasks, []);
  assert.equal((await api('/api/tasks', 'POST', { title: 'First personal task' })).body.key, 'DAY-1');
});

test('all 26 theme combinations roundtrip through settings, config, and restart without changing board data', async t => {
  const { api, dataDir, restart } = await fixture(t);
  await api('/api/config', 'PATCH', {
    username: 'My display name',
    members: [{ id: 'mine', name: 'My assignee', color: '#123456' }],
    statuses: [{ id: 'working', name: 'Working', color: '#456789', isDone: false }, { id: 'finished', name: 'Finished', color: '#56789a', isDone: true }],
  });
  const task = (await api('/api/tasks', 'POST', { title: 'Keep my whole task', assigneeId: 'mine', description: 'Preserve details.', todayDate: '2026-10-19', repeat: { startsOn: '2026-10-20', endsOn: null } })).body;
  await api(`/api/tasks/${task.id}/comments`, 'POST', { body: 'Preserve my comment.' });
  await api('/api/settings', 'PATCH', { todayStatuses: ['working', 'finished'], todayOrder: 'manual' });
  const before = (await api('/api/state')).body;
  assert.equal(THEME_COLORS.length, 13);
  for (const mode of ['light', 'dark']) {
    for (const color of THEME_COLORS) {
      const theme = { mode, color };
      const expected = { ...before, settings: { ...before.settings, theme } };
      const settings = await api('/api/settings', 'PATCH', { theme });
      assert.equal(settings.status, 200);
      assert.deepEqual(settings.body, expected.settings);
      const config = await api('/api/config', 'PATCH', { theme });
      assert.equal(config.status, 200);
      assert.deepEqual(config.body, expected);
      assert.deepEqual((await api('/api/state')).body, expected);
      assert.deepEqual(JSON.parse(await readFile(join(dataDir, 'dayboard.json'), 'utf8')).settings.theme, theme);
      await restart();
      assert.deepEqual((await api('/api/state')).body, expected);
    }
  }
});

test('existing version 2 files without newer settings gain only their defaults', async t => {
  const { api, dataDir, restart } = await fixture(t);
  await api('/api/config', 'PATCH', {
    username: 'Preserved name', members: [{ id: 'owner', name: 'My own name', color: '#112233' }],
    statuses: [{ id: 'my-status', name: 'My status', color: '#334455', isDone: false }],
  });
  const task = (await api('/api/tasks', 'POST', { title: 'Preserve across upgrade', assigneeId: 'owner', todayDate: '2026-10-19' })).body;
  await api(`/api/tasks/${task.id}/comments`, 'POST', { body: 'Keep my history.' });
  await api('/api/settings', 'PATCH', { todayOrder: 'manual', todayStatuses: [] });
  const filePath = join(dataDir, 'dayboard.json');
  const previous = JSON.parse(await readFile(filePath, 'utf8'));
  delete previous.settings.theme;
  delete previous.settings.defaultAssigneeId;
  await writeFile(filePath, JSON.stringify(previous, null, 2));
  await restart();
  const expected = { ...previous, settings: { ...previous.settings, defaultAssigneeId: 'unassigned', theme: DEFAULT_THEME } };
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), expected);
  assert.deepEqual((await api('/api/state')).body, { tasks: expected.tasks, members: expected.members, statuses: expected.statuses, settings: expected.settings });
  const upgradedContents = await readFile(filePath, 'utf8');
  await restart();
  assert.equal(await readFile(filePath, 'utf8'), upgradedContents, 'opening an upgraded file does not rewrite it again');
});

test('invalid theme updates reject atomically through both settings and config', async t => {
  const { api, dataDir } = await fixture(t);
  await api('/api/tasks', 'POST', { title: 'Keep existing task' });
  const original = (await api('/api/state')).body;
  const filePath = join(dataDir, 'dayboard.json');
  const originalContents = await readFile(filePath, 'utf8');
  const invalidThemes = [
    null, [], 'dark', {}, { mode: 'dark' }, { color: 'green' },
    { mode: 'system', color: 'green' }, { mode: null, color: 'green' },
    { mode: 'dark', color: 'red' }, { mode: 'dark', color: 'GREEN' },
    { mode: 'dark', color: null }, { mode: 'light', color: 1 },
    { mode: 'dark', color: 'green', extra: true },
  ];
  for (const path of ['/api/settings', '/api/config']) {
    for (const theme of invalidThemes) {
      const response = await api(path, 'PATCH', { theme, username: 'Must stay unchanged' });
      assert.equal(response.status, 400, `${path}: ${JSON.stringify(theme)}`);
      assert.match(response.body.error, /theme/);
      assert.deepEqual((await api('/api/state')).body, original);
      assert.equal(await readFile(filePath, 'utf8'), originalContents);
    }
  }
});

test('a present invalid saved theme fails startup without modifying the file', async t => {
  const directory = await mkdtemp(join(dirname(fileURLToPath(import.meta.url)), '.dayboard-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = createApp({ dataDir: directory });
  await app.close();
  const filePath = join(directory, 'dayboard.json');
  const original = JSON.parse(await readFile(filePath, 'utf8'));
  original.tasks = [taskRecord()];
  original.nextKey = 2;
  for (const theme of [null, {}, { mode: 'dark', color: 'missing' }, { mode: 'dark', color: 'green', extra: 1 }]) {
    const contents = JSON.stringify({ ...original, settings: { ...original.settings, theme } }, null, 2);
    await writeFile(filePath, contents);
    assert.throws(() => createApp({ dataDir: directory }), /dayboard\.json is invalid:.*theme/);
    assert.equal(await readFile(filePath, 'utf8'), contents);
  }
});

test('static SPA routes, asset content types, API boundaries, and traversal protection', async t => {
  const { api, url, staticDir } = await fixture(t);
  await mkdir(join(staticDir, 'assets'));
  await writeFile(join(staticDir, 'assets', 'app.js'), 'console.log("Dayboard")');
  for (const path of ['/', '/board', '/today?view=list']) {
    const response = await fetch(url(path));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /Dayboard test/);
  }
  const asset = await fetch(url('/assets/app.js'));
  assert.match(asset.headers.get('content-type'), /text\/javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(url('/assets/missing.js'))).status, 404);
  const head = await fetch(url('/'), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await api('/api/missing')).status, 404);
  assert.equal((await api('/api/tasks/missing', 'DELETE')).status, 404);
  assert.equal((await api('/api/tasks/reorder', 'POST', { ids: 'bad' })).status, 400);
  const rawGet = path => new Promise((resolveRequest, reject) => {
    const parsed = new URL(url('/'));
    const request = httpRequest({ hostname: parsed.hostname, port: parsed.port, path, method: 'GET' }, response => {
      response.resume(); response.on('end', () => resolveRequest(response.statusCode));
    });
    request.on('error', reject); request.end();
  });
  assert.equal(await rawGet('/%2e%2e%5csecret.txt'), 400);
  assert.equal(await rawGet('/%00secret'), 400);
  assert.equal(await rawGet('/%notvalid'), 400);
});

test('a default assignee applies to new tasks, persists, validates, and falls back when removed', async t => {
  const { api, restart } = await fixture(t);
  const members = [
    { id: 'owner', name: 'Owner', color: '#112233' },
    { id: 'backup', name: 'Backup', color: '#445566' },
  ];
  const configured = await api('/api/config', 'PATCH', { members, defaultAssigneeId: 'owner' });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.settings.defaultAssigneeId, 'owner');
  assert.equal((await api('/api/tasks', 'POST', { title: 'Uses the config default' })).body.assigneeId, 'owner');

  const settings = await api('/api/settings', 'PATCH', { defaultAssigneeId: 'backup' });
  assert.equal(settings.status, 200);
  assert.equal((await api('/api/tasks', 'POST', { title: 'Uses the settings default' })).body.assigneeId, 'backup');
  assert.equal((await api('/api/tasks', 'POST', { title: 'Explicit choice wins', assigneeId: 'unassigned' })).body.assigneeId, 'unassigned');
  await restart();
  assert.equal((await api('/api/state')).body.settings.defaultAssigneeId, 'backup');
  assert.equal((await api('/api/tasks', 'POST', { title: 'Uses the restored default' })).body.assigneeId, 'backup');

  const beforeInvalid = (await api('/api/state')).body;
  assert.equal((await api('/api/settings', 'PATCH', { defaultAssigneeId: 'missing' })).status, 400);
  assert.equal((await api('/api/config', 'PATCH', { defaultAssigneeId: 'missing', username: 'Must not change' })).status, 400);
  assert.deepEqual((await api('/api/state')).body, beforeInvalid);

  const removed = await api('/api/config', 'PATCH', { members: [members[0]] });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.settings.defaultAssigneeId, 'unassigned');
  assert.equal(removed.body.tasks.find(task => task.title === 'Uses the settings default').assigneeId, 'unassigned');
  assert.equal((await api('/api/tasks', 'POST', { title: 'Falls back safely' })).body.assigneeId, 'unassigned');
});
