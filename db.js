// ===== db.js — データ永続化層 =====
// Phase1: LocalStorage / Phase2: IndexedDB対応準備済み

const KEYS = {
  TASKS: 'sf_tasks',
  DAILY: 'sf_daily',
  REPEAT: 'sf_repeat',         // Phase2
  TIMETABLE: 'sf_timetable',   // Phase2
  SUBJECT_COLORS: 'sf_subject_colors', // Phase2
  SETTINGS: 'sf_settings',
};

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}
function loadObj(key, def = {}) {
  try { return JSON.parse(localStorage.getItem(key)) || def; }
  catch { return def; }
}
function save(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

// ===== Tasks =====
export function getTasks() { return load(KEYS.TASKS); }
export function saveTasks(tasks) { save(KEYS.TASKS, tasks); }

export function addTask(task) {
  const tasks = getTasks();
  tasks.push(task);
  saveTasks(tasks);
}
export function updateTask(id, patch) {
  const tasks = getTasks().map(t => t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t);
  saveTasks(tasks);
}
export function deleteTask(id) {
  saveTasks(getTasks().filter(t => t.id !== id));
  // 関連DailyTaskも削除
  saveDailyTasks(getDailyTasks().filter(d => d.taskId !== id));
}

// ===== DailyTasks =====
export function getDailyTasks() { return load(KEYS.DAILY); }
export function saveDailyTasks(list) { save(KEYS.DAILY, list); }

export function getDailyTasksForDate(date) {
  return getDailyTasks().filter(d => d.date === date);
}
export function upsertDailyTask(dt) {
  const list = getDailyTasks();
  const idx = list.findIndex(d => d.id === dt.id);
  if (idx >= 0) list[idx] = dt; else list.push(dt);
  saveDailyTasks(list);
}

// ===== Repeat Tasks (Phase2) =====
export function getRepeatTasks() { return load(KEYS.REPEAT); }
export function saveRepeatTasks(list) { save(KEYS.REPEAT, list); }
export function addRepeatTask(rt) {
  const list = getRepeatTasks();
  list.push(rt);
  saveRepeatTasks(list);
}
export function deleteRepeatTask(id) {
  saveRepeatTasks(getRepeatTasks().filter(r => r.id !== id));
}

// ===== Timetable (Phase2) =====
export function getTimetable() { return load(KEYS.TIMETABLE); }
export function saveTimetable(list) { save(KEYS.TIMETABLE, list); }
export function addPeriod(p) {
  const list = getTimetable();
  // 同じ曜日・時限があれば上書き
  const idx = list.findIndex(x => x.day === p.day && x.slot === p.slot);
  if (idx >= 0) list[idx] = p; else list.push(p);
  saveTimetable(list);
}
export function deletePeriod(id) {
  saveTimetable(getTimetable().filter(p => p.id !== id));
}

// ===== Subject Colors (Phase2) =====
export function getSubjectColors() { return loadObj(KEYS.SUBJECT_COLORS, {}); }
export function setSubjectColor(subject, color) {
  const map = getSubjectColors();
  map[subject] = color;
  save(KEYS.SUBJECT_COLORS, map);
}
export function deleteSubjectColor(subject) {
  const map = getSubjectColors();
  delete map[subject];
  save(KEYS.SUBJECT_COLORS, map);
}

// ===== Settings =====
export function getSettings() { return loadObj(KEYS.SETTINGS, { theme: 'light', notifications: false }); }
export function saveSettings(s) { save(KEYS.SETTINGS, s); }

// ===== Export / Import (Phase2) =====
export function exportAll() {
  return {
    tasks: getTasks(),
    daily: getDailyTasks(),
    repeat: getRepeatTasks(),
    timetable: getTimetable(),
    subjectColors: getSubjectColors(),
    settings: getSettings(),
    exportedAt: new Date().toISOString(),
    version: '2.0',
  };
}
export function importAll(data) {
  if (data.tasks) saveTasks(data.tasks);
  if (data.daily) saveDailyTasks(data.daily);
  if (data.repeat) saveRepeatTasks(data.repeat);
  if (data.timetable) saveTimetable(data.timetable);
  if (data.subjectColors) save(KEYS.SUBJECT_COLORS, data.subjectColors);
  if (data.settings) saveSettings(data.settings);
}
export function clearAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
}

// ===== Utilities =====
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
export function todayStr() {
  return new Date().toISOString().split('T')[0];
}
