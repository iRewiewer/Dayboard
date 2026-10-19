import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_STATUSES = [
  { id: 'backlog', name: 'Backlog', color: '#9298a7', isDone: false },
  { id: 'todo', name: 'To do', color: '#6e8bd7', isDone: false },
  { id: 'in-progress', name: 'In progress', color: '#b19aee', isDone: false },
  { id: 'in-review', name: 'In review', color: '#e1ae68', isDone: false },
  { id: 'done', name: 'Done', color: '#72bda0', isDone: true },
];
export const UNASSIGNED_MEMBER = { id: 'unassigned', name: 'Unassigned', initials: '?', color: '#8b8e97' };
export const STATUSES = DEFAULT_STATUSES;
export const THEME_COLORS = ['blood-red', 'crimson-red', 'green', 'purple', 'violet', 'pink', 'orange', 'yellow', 'lime', 'fuchsia', 'cyan', 'navy-blue', 'light-blue'];
export const DEFAULT_THEME = { mode: 'dark', color: 'green' };
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const EDITABLE_FIELDS = new Set(['title', 'description', 'status', 'severity', 'assigneeId', 'startDate', 'endDate', 'todayDate', 'repeat', 'dismissedOn', 'order']);
const DEFAULT_SETTINGS = { todayStatuses: DEFAULT_STATUSES.filter(status => !status.isDone).map(status => status.id), todayOrder: 'severity', username: 'You', theme: DEFAULT_THEME };
const BODY_LIMIT = 64 * 1024;
const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value) {
  if (!isObject(value)) throw new HttpError(400, 'Request body must be a JSON object.');
}

function validDate(value, name, nullable = true) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${name} must be a valid date in YYYY-MM-DD format${nullable ? ' or null' : ''}.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${name} must be a valid calendar date.`);
  }
}

function validateText(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new HttpError(400, `${name} must be ${required ? 'a non-empty string' : 'a string'} of at most ${max} characters.`);
  }
  return required ? value.trim() : value;
}

function validateId(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new HttpError(400, `${label} must contain only letters, numbers, hyphens, or underscores (1–100 characters).`);
}

function validateColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new HttpError(400, 'color must be a six-digit hex color, such as #72bda0.');
  return value.toLowerCase();
}

function initialsFor(name) {
  return name.split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase();
}

function validateMembers(members) {
  if (!Array.isArray(members) || members.length > 100) throw new HttpError(400, 'members must be a list of at most 100 assignees.');
  const ids = new Set(['unassigned']);
  const names = new Set(['unassigned']);
  return [structuredClone(UNASSIGNED_MEMBER), ...members.map(member => {
    if (!isObject(member) || Object.keys(member).some(key => !['id', 'name', 'color', 'initials'].includes(key))) throw new HttpError(400, 'Each member must have an id, name, and color.');
    validateId(member.id, 'Member ID');
    if (ids.has(member.id)) throw new HttpError(400, 'Member IDs must be unique. The system Unassigned member cannot be edited.');
    const name = validateText(member.name, 'Member name', 80, true);
    if (names.has(name.toLowerCase())) throw new HttpError(400, 'Assignee names must be unique (ignoring case). Unassigned is reserved.');
    ids.add(member.id);
    names.add(name.toLowerCase());
    return { id: member.id, name, initials: initialsFor(name), color: validateColor(member.color) };
  })];
}

function validateStatuses(statuses) {
  if (!Array.isArray(statuses) || statuses.length < 1 || statuses.length > 100) throw new HttpError(400, 'statuses must contain between 1 and 100 statuses.');
  const ids = new Set();
  const names = new Set();
  const result = statuses.map(status => {
    if (!isObject(status) || Object.keys(status).some(key => !['id', 'name', 'color', 'isDone'].includes(key))) throw new HttpError(400, 'Each status must have an id, name, color, and isDone.');
    validateId(status.id, 'Status ID');
    if (ids.has(status.id)) throw new HttpError(400, 'Status IDs must be unique.');
    const name = validateText(status.name, 'Status name', 80, true);
    if (names.has(name.toLowerCase())) throw new HttpError(400, 'Status names must be unique (ignoring case).');
    if (typeof status.isDone !== 'boolean') throw new HttpError(400, 'Status isDone must be true or false.');
    ids.add(status.id);
    names.add(name.toLowerCase());
    return { id: status.id, name, color: validateColor(status.color), isDone: status.isDone };
  });
  if (result.every(status => status.isDone)) throw new HttpError(400, 'Keep at least one status that is not marked as completed.');
  return result;
}

function validateTaskChanges(body, previous, configuration) {
  assertObject(body);
  const result = { ...body };
  for (const field of Object.keys(body)) {
    if (!EDITABLE_FIELDS.has(field)) throw new HttpError(400, `Unknown or read-only task field: ${field}.`);
  }
  if ('title' in body) result.title = validateText(body.title, 'title', 160, true);
  if ('description' in body) validateText(body.description, 'description', 10000);
  if ('status' in body && !configuration.statuses.some(status => status.id === body.status)) throw new HttpError(400, 'status must identify a configured status.');
  if ('severity' in body && !SEVERITIES.includes(body.severity)) throw new HttpError(400, `severity must be one of: ${SEVERITIES.join(', ')}.`);
  if ('assigneeId' in body && !configuration.members.some(member => member.id === body.assigneeId)) throw new HttpError(400, 'assigneeId must identify an existing member.');
  for (const field of ['startDate', 'endDate', 'todayDate', 'dismissedOn']) {
    if (field in body) validDate(body[field], field);
  }
  if ('order' in body && (!Number.isSafeInteger(body.order) || body.order < 0)) throw new HttpError(400, 'order must be a non-negative safe integer.');
  if ('repeat' in body && body.repeat !== null) {
    if (!isObject(body.repeat) || Object.keys(body.repeat).some(key => !['startsOn', 'endsOn'].includes(key))) {
      throw new HttpError(400, 'repeat must be null or an object with startsOn and endsOn.');
    }
    validDate(body.repeat.startsOn, 'repeat.startsOn', false);
    validDate(body.repeat.endsOn, 'repeat.endsOn');
    if (body.repeat.endsOn && body.repeat.endsOn < body.repeat.startsOn) throw new HttpError(400, 'repeat.endsOn cannot be before repeat.startsOn.');
  }
  const merged = { ...previous, ...result };
  if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) throw new HttpError(400, 'endDate cannot be before startDate.');
  return result;
}

function validateTheme(theme) {
  if (!isObject(theme) || Object.keys(theme).length !== 2 || Object.keys(theme).some(key => !['mode', 'color'].includes(key)) || !['light', 'dark'].includes(theme.mode) || !THEME_COLORS.includes(theme.color)) {
    throw new HttpError(400, `theme must contain only mode (light or dark) and color (${THEME_COLORS.join(', ')}).`);
  }
  return { mode: theme.mode, color: theme.color };
}

function validateSettings(body, previous, statuses) {
  assertObject(body);
  for (const key of Object.keys(body)) {
    if (!['todayStatuses', 'todayOrder', 'username', 'theme'].includes(key)) throw new HttpError(400, `Unknown setting: ${key}.`);
  }
  if ('todayStatuses' in body && (!Array.isArray(body.todayStatuses) || body.todayStatuses.some(id => !statuses.some(status => status.id === id)) || new Set(body.todayStatuses).size !== body.todayStatuses.length)) {
    throw new HttpError(400, 'todayStatuses must be an array of unique valid statuses.');
  }
  if ('todayOrder' in body && !['severity', 'manual'].includes(body.todayOrder)) throw new HttpError(400, 'todayOrder must be severity or manual.');
  return {
    ...previous, ...body,
    ...('username' in body ? { username: validateText(body.username, 'Display name', 80, true) } : {}),
    ...('theme' in body ? { theme: validateTheme(body.theme) } : {}),
  };
}

function highestTaskNumber(tasks) {
  return tasks.reduce((highest, task) => Math.max(highest, Number(task.key.slice(4))), 0);
}

function validateStoredState(state) {
  try {
    if (!isObject(state) || state.version !== 2 || !Array.isArray(state.tasks) || !isObject(state.settings) || !Number.isSafeInteger(state.nextKey) || state.nextKey < 1) {
      throw new Error('Unsupported format, version, or task sequence.');
    }
    validateStatuses(state.statuses);
    if (!Array.isArray(state.members) || state.members.length < 1 || !isObject(state.members[0]) || Object.keys(UNASSIGNED_MEMBER).some(key => state.members[0][key] !== UNASSIGNED_MEMBER[key])) throw new Error('The system Unassigned member must be present and unchanged.');
    const validatedMembers = validateMembers(state.members.slice(1));
    if (state.members.some((member, index) => member.initials !== validatedMembers[index].initials)) throw new Error('Saved assignee initials are invalid.');
    if (!['todayStatuses', 'todayOrder', 'username', 'theme'].every(key => key in state.settings)) throw new Error('Saved settings are incomplete.');
    validateSettings(state.settings, DEFAULT_SETTINGS, state.statuses);
    const taskIds = new Set();
    const taskKeys = new Set();
    const validTimestamp = value => typeof value === 'string' && Number.isFinite(new Date(value).getTime());
    for (const task of state.tasks) {
      if (!isObject(task) || typeof task.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(task.id) || taskIds.has(task.id)) throw new Error('Task IDs must be present and unique.');
      if (typeof task.key !== 'string' || !/^DAY-[1-9]\d*$/.test(task.key) || !Number.isSafeInteger(Number(task.key.slice(4))) || taskKeys.has(task.key)) throw new Error('Task keys must be unique DAY numbers within the positive safe integer range.');
      taskIds.add(task.id);
      taskKeys.add(task.key);
      const editable = {};
      for (const field of EDITABLE_FIELDS) {
        if (!(field in task)) throw new Error(`Task ${task.key} is missing ${field}.`);
        editable[field] = task[field];
      }
      validateTaskChanges(editable, {}, state);
      if (!validTimestamp(task.createdAt) || !Array.isArray(task.comments)) throw new Error(`Task ${task.key} has invalid creation data or comments.`);
      const commentIds = new Set();
      for (const comment of task.comments) {
        if (!isObject(comment) || typeof comment.id !== 'string' || !comment.id || commentIds.has(comment.id) || !validTimestamp(comment.createdAt)) throw new Error(`Task ${task.key} has invalid comments.`);
        commentIds.add(comment.id);
        validateText(comment.author, 'comment author', 100, true);
        validateText(comment.body, 'comment body', 5000, true);
      }
    }
  } catch (error) {
    throw new Error(`dayboard.json is invalid: ${error.message} Restore a valid data file before starting Dayboard.`);
  }
}

async function readBody(request) {
  const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > BODY_LIMIT) throw new HttpError(413, 'Request body exceeds the 64 KB limit.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new HttpError(413, 'Request body exceeds the 64 KB limit.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Request body must contain valid JSON.'); }
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function isInside(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && path !== '..' && !isAbsolute(path));
}

const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

function serveStatic(request, response, pathname, staticDir) {
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new HttpError(400, 'Invalid URL encoding.'); }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) throw new HttpError(400, 'Invalid file path.');
  let target = resolve(staticDir, `.${decoded}`);
  if (!isInside(staticDir, target)) throw new HttpError(400, 'Invalid file path.');
  let info;
  try { info = statSync(target); } catch { /* A page route falls back to the SPA. */ }
  if (!info?.isFile()) {
    if (extname(decoded) && decoded !== '/index.html') throw new HttpError(404, 'File not found.');
    target = resolve(staticDir, 'index.html');
    try { info = statSync(target); }
    catch { throw new HttpError(503, 'The frontend has not been built. Run npm run build first.'); }
  }
  if (!isInside(realpathSync(staticDir), realpathSync(target))) throw new HttpError(403, 'File access denied.');
  response.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  response.end(request.method === 'HEAD' ? undefined : readFileSync(target));
}

export function createApp({ dataDir = process.env.DATA_DIR || resolve(PROJECT_DIR, 'data'), staticDir = resolve(PROJECT_DIR, 'dist'), now = () => new Date() } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const filePath = resolve(dataDir, 'dayboard.json');
  let state;
  const persist = () => {
    const temporaryPath = resolve(dataDir, `.dayboard-${randomUUID()}.tmp`);
    let descriptor;
    try {
      descriptor = openSync(temporaryPath, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, filePath);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      try { unlinkSync(temporaryPath); } catch { /* Keep the original failure. */ }
      throw error;
    }
  };
  if (existsSync(filePath)) {
    state = JSON.parse(readFileSync(filePath, 'utf8'));
    const needsMigration = state?.version === 1;
    if (needsMigration) {
      if (!Array.isArray(state.tasks)) throw new Error('dayboard.json is invalid: Saved tasks must be a list.');
      state = {
        ...state, version: 2,
        tasks: state.tasks.map(task => ({ ...task, assigneeId: 'unassigned' })),
        nextKey: state.tasks.length === 0 ? 1 : state.nextKey,
        statuses: structuredClone(DEFAULT_STATUSES), members: [structuredClone(UNASSIGNED_MEMBER)],
        settings: { ...state.settings, username: 'You' },
      };
    }
    const needsThemeUpgrade = state?.version === 2 && isObject(state.settings) && !('theme' in state.settings);
    if (needsThemeUpgrade) state.settings = { ...state.settings, theme: structuredClone(DEFAULT_THEME) };
    validateStoredState(state);
    if (needsMigration || needsThemeUpgrade) persist();
  } else {
    state = { version: 2, tasks: [], settings: structuredClone(DEFAULT_SETTINGS), nextKey: 1, statuses: structuredClone(DEFAULT_STATUSES), members: [structuredClone(UNASSIGNED_MEMBER)] };
    persist();
  }
  const allTasks = () => structuredClone(state.tasks).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const getTask = id => {
    const task = state.tasks.find(task => task.id === id);
    if (!task) throw new HttpError(404, 'Task not found.');
    return structuredClone(task);
  };
  const putTask = task => {
    const index = state.tasks.findIndex(item => item.id === task.id);
    if (index === -1) state.tasks.push(task);
    else state.tasks[index] = task;
    return task;
  };
  const getMeta = key => structuredClone(state[key]);
  const putMeta = (key, value) => { state[key] = value; };
  const transaction = callback => {
    const previous = state;
    state = structuredClone(previous);
    try {
      const result = callback();
      const highest = highestTaskNumber(state.tasks);
      // Retain this legacy field as a cache; live task keys determine allocation.
      state.nextKey = highest === Number.MAX_SAFE_INTEGER ? highest : highest + 1;
      persist();
      return result;
    }
    catch (error) { state = previous; throw error; }
  };
  const boardState = () => ({ tasks: allTasks(), settings: getMeta('settings'), members: getMeta('members'), statuses: getMeta('statuses') });

  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname;
      const method = request.method;
      if (path === '/api/health' && method === 'GET') return sendJson(response, 200, { status: 'ok' });
      if (path === '/api/state' && method === 'GET') return sendJson(response, 200, boardState());
      if (path === '/api/config' && method === 'PATCH') {
        const body = await readBody(request);
        assertObject(body);
        if (Object.keys(body).some(key => !['members', 'statuses', 'username', 'theme'].includes(key))) throw new HttpError(400, 'Configuration supports members, statuses, username, and theme only.');
        const members = 'members' in body ? validateMembers(body.members) : state.members;
        const statuses = 'statuses' in body ? validateStatuses(body.statuses) : state.statuses;
        const username = 'username' in body ? validateText(body.username, 'Display name', 80, true) : state.settings.username;
        const theme = 'theme' in body ? validateTheme(body.theme) : state.settings.theme;
        const statusIds = new Set(statuses.map(status => status.id));
        const removedInUse = state.statuses.filter(status => !statusIds.has(status.id) && state.tasks.some(task => task.status === status.id));
        if (removedInUse.length) throw new HttpError(400, `Move tasks out of these statuses before removing them: ${removedInUse.map(status => status.name).join(', ')}.`);
        const memberIds = new Set(members.map(member => member.id));
        const previousStatusIds = new Set(state.statuses.map(status => status.id));
        const newlyEnabled = statuses.filter(status => !previousStatusIds.has(status.id) && !status.isDone).map(status => status.id);
        const result = transaction(() => {
          state.members = members;
          state.statuses = statuses;
          state.tasks = state.tasks.map(task => memberIds.has(task.assigneeId) ? task : { ...task, assigneeId: 'unassigned' });
          state.settings = { ...state.settings, username, theme, todayStatuses: [...state.settings.todayStatuses.filter(id => statusIds.has(id)), ...newlyEnabled] };
          return boardState();
        });
        return sendJson(response, 200, result);
      }
      if (path === '/api/settings' && method === 'PATCH') {
        const body = await readBody(request);
        const settings = validateSettings(body, getMeta('settings'), state.statuses);
        transaction(() => putMeta('settings', settings));
        return sendJson(response, 200, settings);
      }
      if (path === '/api/tasks' && method === 'POST') {
        const changes = validateTaskChanges(await readBody(request), {}, state);
        if (!('title' in changes)) throw new HttpError(400, 'title is required.');
        const task = transaction(() => {
          const tasks = allTasks();
          const highest = highestTaskNumber(tasks);
          if (highest === Number.MAX_SAFE_INTEGER) throw new HttpError(409, 'Task numbers have reached the maximum supported value. Delete the task with the highest DAY number before creating another task.');
          const nextKey = highest + 1;
          const result = putTask({
            id: randomUUID(), key: `DAY-${nextKey}`, title: changes.title, description: '', status: state.statuses.find(status => !status.isDone).id, severity: 'medium', assigneeId: 'unassigned',
            startDate: null, endDate: null, todayDate: null, repeat: null, dismissedOn: null,
            order: tasks.length ? Math.max(...tasks.map(item => item.order)) + 1 : 0,
            ...changes, comments: [], createdAt: now().toISOString(),
          });
          return result;
        });
        return sendJson(response, 201, task);
      }
      if (path === '/api/tasks/reorder' && method === 'POST') {
        const body = await readBody(request);
        assertObject(body);
        if (Object.keys(body).some(key => key !== 'ids') || !Array.isArray(body.ids) || body.ids.some(id => typeof id !== 'string') || new Set(body.ids).size !== body.ids.length) {
          throw new HttpError(400, 'ids must be an array of unique task IDs.');
        }
        const tasks = transaction(() => {
          const current = allTasks();
          const byId = new Map(current.map(task => [task.id, task]));
          for (const id of body.ids) if (!byId.has(id)) throw new HttpError(404, `Task not found: ${id}.`);
          // Replace the selected tasks in their existing slots; hidden tasks keep their position.
          const selected = new Set(body.ids);
          let index = 0;
          return current.map((task, order) => putTask({ ...(selected.has(task.id) ? byId.get(body.ids[index++]) : task), order }));
        });
        return sendJson(response, 200, tasks);
      }
      const taskMatch = path.match(/^\/api\/tasks\/([^/]+)(\/comments)?$/);
      if (taskMatch) {
        let id;
        try { id = decodeURIComponent(taskMatch[1]); } catch { throw new HttpError(400, 'Invalid task ID.'); }
        const task = getTask(id);
        if (taskMatch[2] && method === 'POST') {
          const body = await readBody(request);
          assertObject(body);
          if (Object.keys(body).some(key => !['body', 'author'].includes(key))) throw new HttpError(400, 'Comments support body and author fields only.');
          const commentBody = validateText(body.body, 'body', 5000, true);
          const author = 'author' in body ? validateText(body.author, 'author', 100, true) : state.settings.username;
          // Re-read after awaiting the body, so concurrent comments cannot overwrite each other.
          const updated = getTask(id);
          updated.comments.push({ id: randomUUID(), author, body: commentBody, createdAt: now().toISOString() });
          return sendJson(response, 201, transaction(() => putTask(updated)));
        }
        if (!taskMatch[2] && method === 'PATCH') {
          const body = await readBody(request);
          const current = getTask(id);
          const changes = validateTaskChanges(body, current, state);
          return sendJson(response, 200, transaction(() => putTask({ ...current, ...changes })));
        }
        if (!taskMatch[2] && method === 'DELETE') {
          transaction(() => { state.tasks = state.tasks.filter(item => item.id !== task.id); });
          response.writeHead(204);
          return response.end();
        }
        throw new HttpError(405, 'Method not allowed.');
      }
      if (path === '/api' || path.startsWith('/api/')) throw new HttpError(404, 'API route not found.');
      serveStatic(request, response, path, resolve(staticDir));
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('Request failed:', error);
      if (!response.headersSent) sendJson(response, error.status || 500, { error: error.status ? error.message : 'An unexpected server error occurred.' });
      else response.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  let closed = false;
  return {
    server,
    filePath,
    listen(port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0') {
      return new Promise((resolveListen, reject) => {
        const onError = error => reject(error);
        server.once('error', onError);
        server.listen(port, host, () => { server.removeListener('error', onError); resolveListen(server.address()); });
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      if (server.listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    },
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const app = createApp();
  const shutdown = () => { app.close().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  app.listen().then(address => console.log(`Dayboard is ready at http://localhost:${address.port}`)).catch(error => { console.error(error); app.close().finally(() => process.exit(1)); });
}
