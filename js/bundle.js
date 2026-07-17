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
function getTasks() { return load(KEYS.TASKS); }
function saveTasks(tasks) { save(KEYS.TASKS, tasks); }

function addTask(task) {
  const tasks = getTasks();
  tasks.push(task);
  saveTasks(tasks);
}
function updateTask(id, patch) {
  const tasks = getTasks().map(t => t.id === id ? { ...t, ...patch, updatedAt: new Date().toISOString() } : t);
  saveTasks(tasks);
}
function deleteTask(id) {
  saveTasks(getTasks().filter(t => t.id !== id));
  // 関連DailyTaskも削除
  saveDailyTasks(getDailyTasks().filter(d => d.taskId !== id));
}

// ===== DailyTasks =====
function getDailyTasks() { return load(KEYS.DAILY); }
function saveDailyTasks(list) { save(KEYS.DAILY, list); }

function getDailyTasksForDate(date) {
  return getDailyTasks().filter(d => d.date === date);
}
function upsertDailyTask(dt) {
  const list = getDailyTasks();
  const idx = list.findIndex(d => d.id === dt.id);
  if (idx >= 0) list[idx] = dt; else list.push(dt);
  saveDailyTasks(list);
}

// ===== Repeat Tasks (Phase2) =====
function getRepeatTasks() { return load(KEYS.REPEAT); }
function saveRepeatTasks(list) { save(KEYS.REPEAT, list); }
function addRepeatTask(rt) {
  const list = getRepeatTasks();
  list.push(rt);
  saveRepeatTasks(list);
}
function deleteRepeatTask(id) {
  saveRepeatTasks(getRepeatTasks().filter(r => r.id !== id));
}

// ===== Timetable (Phase2) =====
function getTimetable() { return load(KEYS.TIMETABLE); }
function saveTimetable(list) { save(KEYS.TIMETABLE, list); }
function addPeriod(p) {
  const list = getTimetable();
  // 同じ曜日・時限があれば上書き
  const idx = list.findIndex(x => x.day === p.day && x.slot === p.slot);
  if (idx >= 0) list[idx] = p; else list.push(p);
  saveTimetable(list);
}
function deletePeriod(id) {
  saveTimetable(getTimetable().filter(p => p.id !== id));
}

// ===== Subject Colors (Phase2) =====
function getSubjectColors() { return loadObj(KEYS.SUBJECT_COLORS, {}); }
function setSubjectColor(subject, color) {
  const map = getSubjectColors();
  map[subject] = color;
  save(KEYS.SUBJECT_COLORS, map);
}
function deleteSubjectColor(subject) {
  const map = getSubjectColors();
  delete map[subject];
  save(KEYS.SUBJECT_COLORS, map);
}

// ===== Settings =====
function getSettings() { return loadObj(KEYS.SETTINGS, { theme: 'light', notifications: false }); }
function saveSettings(s) { save(KEYS.SETTINGS, s); }

// ===== Export / Import (Phase2) =====
function exportAll() {
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
function importAll(data) {
  if (data.tasks) saveTasks(data.tasks);
  if (data.daily) saveDailyTasks(data.daily);
  if (data.repeat) saveRepeatTasks(data.repeat);
  if (data.timetable) saveTimetable(data.timetable);
  if (data.subjectColors) save(KEYS.SUBJECT_COLORS, data.subjectColors);
  if (data.settings) saveSettings(data.settings);
}
function clearAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
}

// ===== Utilities =====
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function todayStr() {
  return new Date().toISOString().split('T')[0];
}


// ===== app.js — メインアプリケーション =====
// ===== State =====
let editingTaskId = null;
let progressTaskId = null;
let calView = 'month';
let calDate = new Date();
let statsPeriod = 'week';

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  applySettings();
  setupNav();
  setupModals();
  setupSettings();
  setupCalendar();
  setupStats();
  setupRepeat();
  setupTimetable();
  generateTodayDailyTasks();
  renderHome();
  renderTasks();
  updateDateBadge();
  initTaskFilters();
  // 通知許可済みなら起動時チェック
  if (Notification.permission === 'granted') scheduleNotifications();
});

// ===== Settings =====
function applySettings() {
  const s = getSettings();
  if (s.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  const toggle = document.getElementById('darkModeToggle');
  if (toggle) toggle.checked = s.theme === 'dark';
}

function setupSettings() {
  document.getElementById('darkModeToggle').addEventListener('change', (e) => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    const s = getSettings(); s.theme = theme; saveSettings(s);
  });

  const notifBtn = document.getElementById('notifBtn');
  // 初期状態
  if (Notification.permission === 'granted') {
    notifBtn.textContent = '許可済み ✓';
    notifBtn.classList.add('btn-notif-granted');
    notifBtn.disabled = true;
  }
  notifBtn.addEventListener('click', () => {
    Notification.requestPermission().then(p => {
      if (p === 'granted') {
        notifBtn.textContent = '許可済み ✓';
        notifBtn.classList.add('btn-notif-granted');
        notifBtn.disabled = true;
        scheduleNotifications();
      }
      showToast(p === 'granted' ? '通知を許可しました' : '通知が許可されませんでした', p === 'granted' ? 'success' : 'danger');
    });
  });

  // Export
  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studyflow_backup_${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('データをエクスポートしました', 'success');
  });

  // Import
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        importAll(data);
        showToast('データをインポートしました', 'success');
        setTimeout(() => location.reload(), 800);
      } catch {
        showToast('ファイルの読み込みに失敗しました', 'danger');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // Clear
  document.getElementById('clearDataBtn').addEventListener('click', () => {
    if (confirm('全データを削除しますか？この操作は元に戻せません。')) {
      clearAll();
      showToast('データを削除しました', 'danger');
      setTimeout(() => location.reload(), 800);
    }
  });

  // Subject Colors (Phase2)
  document.getElementById('addSubjectColorBtn').addEventListener('click', () => {
    document.getElementById('scSubject').value = '';
    document.getElementById('scColor').value = '#4f46e5';
    openModal('subjectColorModal');
  });
  document.getElementById('scModalClose').addEventListener('click', () => closeModal('subjectColorModal'));
  document.getElementById('scModalCancel').addEventListener('click', () => closeModal('subjectColorModal'));
  document.getElementById('scModalSave').addEventListener('click', () => {
    const subj = document.getElementById('scSubject').value.trim();
    const color = document.getElementById('scColor').value;
    if (!subj) { showToast('科目名を入力してください', 'danger'); return; }
    setSubjectColor(subj, color);
    renderSubjectColors();
    closeModal('subjectColorModal');
    showToast('カラーを設定しました', 'success');
  });

  renderSubjectColors();
}

function renderSubjectColors() {
  const map = getSubjectColors();
  const container = document.getElementById('subjectColors');
  container.innerHTML = '';
  Object.entries(map).forEach(([subj, color]) => {
    const row = document.createElement('div');
    row.className = 'subject-color-item';
    row.innerHTML = `
      <div class="subject-color-swatch" style="background:${color}"></div>
      <span style="flex:1">${subj}</span>
      <button class="btn btn-icon btn-sm" data-subj="${subj}" title="削除">✕</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      deleteSubjectColor(subj);
      renderSubjectColors();
      renderTasks();
    });
    container.appendChild(row);
  });
}

// ===== Navigation =====
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
      if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
    });
  });

  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });

  // Close sidebar when clicking outside
  document.getElementById('main').addEventListener('click', () => {
    if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
  });
}

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  if (page === 'home') { renderHome(); generateTodayDailyTasks(); }
  if (page === 'tasks') renderTasks();
  if (page === 'calendar') renderCalendar();
  if (page === 'stats') renderStats();
  if (page === 'repeat') renderRepeat();
  if (page === 'timetable') renderTimetable();
}

// ===== Task Modal =====
function setupModals() {
  const addBtns = [document.getElementById('addTaskBtn'), document.getElementById('addTaskBtn2')];
  addBtns.forEach(btn => btn?.addEventListener('click', () => openTaskModal()));
  document.getElementById('modalClose').addEventListener('click', () => closeModal('taskModal'));
  document.getElementById('modalCancel').addEventListener('click', () => closeModal('taskModal'));
  document.getElementById('modalSave').addEventListener('click', saveTaskFromModal);

  // Click outside to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // Progress modal
  document.getElementById('progressModalClose').addEventListener('click', () => closeModal('progressModal'));
  document.getElementById('progressModalCancel').addEventListener('click', () => closeModal('progressModal'));
  document.getElementById('progressModalSave').addEventListener('click', saveProgress);
}

function openTaskModal(id = null) {
  editingTaskId = id;
  const modal = document.getElementById('taskModal');
  document.getElementById('modalTitle').textContent = id ? 'タスク編集' : 'タスク追加';

  // Reset
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskSubject').value = '';
  document.getElementById('taskPriority').value = 'medium';
  document.getElementById('taskTotal').value = '';
  document.getElementById('taskUnit').value = '';
  document.getElementById('taskDeadline').value = '';
  document.getElementById('taskMemo').value = '';

  if (id) {
    const task = getTasks().find(t => t.id === id);
    if (task) {
      document.getElementById('taskTitle').value = task.title;
      document.getElementById('taskSubject').value = task.subject || '';
      document.getElementById('taskPriority').value = task.priority;
      document.getElementById('taskTotal').value = task.totalAmount || '';
      document.getElementById('taskUnit').value = task.unit || '';
      document.getElementById('taskDeadline').value = task.deadline || '';
      document.getElementById('taskMemo').value = task.memo || '';
    }
  }

  // Populate subject datalist
  const subjects = [...new Set(getTasks().map(t => t.subject).filter(Boolean))];
  const dl = document.getElementById('subjectList');
  dl.innerHTML = subjects.map(s => `<option value="${s}">`).join('');

  openModal('taskModal');
}

function saveTaskFromModal() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { showToast('タイトルを入力してください', 'danger'); return; }

  const totalAmount = parseFloat(document.getElementById('taskTotal').value) || 0;
  const deadline = document.getElementById('taskDeadline').value;
  const now = new Date().toISOString();

  if (editingTaskId) {
    updateTask(editingTaskId, {
      title,
      subject: document.getElementById('taskSubject').value.trim(),
      priority: document.getElementById('taskPriority').value,
      totalAmount,
      unit: document.getElementById('taskUnit').value.trim(),
      deadline,
      memo: document.getElementById('taskMemo').value.trim(),
    });
    // 既存DailyTask再計算
    redistributeDailyTasks(editingTaskId);
    showToast('タスクを更新しました', 'success');
  } else {
    const task = {
      id: generateId(),
      title,
      subject: document.getElementById('taskSubject').value.trim(),
      priority: document.getElementById('taskPriority').value,
      totalAmount,
      completedAmount: 0,
      unit: document.getElementById('taskUnit').value.trim(),
      deadline,
      memo: document.getElementById('taskMemo').value.trim(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    addTask(task);
    if (totalAmount && deadline) createDailyTasks(task);
    showToast('タスクを追加しました', 'success');
  }

  closeModal('taskModal');
  renderHome();
  renderTasks();
  if (document.getElementById('page-calendar').classList.contains('active')) renderCalendar();
}

// ===== Daily Task Auto-Split =====
function createDailyTasks(task) {
  if (!task.totalAmount || !task.deadline) return;
  const today = todayStr();
  const days = dateDiffDays(today, task.deadline) + 1;
  if (days <= 0) return;

  const perDay = Math.floor(task.totalAmount / days);
  const remainder = task.totalAmount - perDay * days;
  const existing = getDailyTasks();

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const amount = i === days - 1 ? perDay + remainder : perDay;
    if (amount <= 0) continue;
    existing.push({
      id: generateId(),
      taskId: task.id,
      date,
      plannedAmount: amount,
      completedAmount: 0,
      status: 'pending',
    });
  }
  saveDailyTasks(existing);
}

function redistributeDailyTasks(taskId) {
  const task = getTasks().find(t => t.id === taskId);
  if (!task) return;
  const today = todayStr();

  // 今日以降のDailyTaskを削除
  const list = getDailyTasks().filter(d => !(d.taskId === taskId && d.date >= today));
  saveDailyTasks(list);

  // 完了済み量を計算
  const completed = getDailyTasks()
    .filter(d => d.taskId === taskId)
    .reduce((s, d) => s + (d.completedAmount || 0), 0);

  const remaining = (task.totalAmount || 0) - completed;
  if (remaining <= 0 || !task.deadline) return;

  const days = dateDiffDays(today, task.deadline) + 1;
  if (days <= 0) return;

  const perDay = Math.floor(remaining / days);
  const rem2 = remaining - perDay * days;
  const newList = getDailyTasks();

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const amount = i === days - 1 ? perDay + rem2 : perDay;
    if (amount <= 0) continue;
    newList.push({ id: generateId(), taskId, date, plannedAmount: amount, completedAmount: 0, status: 'pending' });
  }
  saveDailyTasks(newList);
}

function generateTodayDailyTasks() {
  // 繰り返しタスクから今日分を生成 (Phase2)
  const today = todayStr();
  const todayDow = new Date().getDay();
  const repeatTasks = getRepeatTasks();
  const existing = getDailyTasks();

  repeatTasks.forEach(rt => {
    if (!rt.days.includes(todayDow)) return;
    const alreadyExists = existing.some(d => d.taskId === rt.id && d.date === today);
    if (alreadyExists) return;
    existing.push({
      id: generateId(),
      taskId: rt.id,
      date: today,
      plannedAmount: rt.amount,
      completedAmount: 0,
      status: 'pending',
      isRepeat: true,
    });
  });
  saveDailyTasks(existing);
}

// ===== Home Render =====
function renderHome() {
  const today = todayStr();
  const allTasks = getTasks();
  const dailyToday = getDailyTasksForDate(today);

  // Stats
  const activeTasks = allTasks.filter(t => t.status === 'active');
  const completedToday = dailyToday.filter(d => d.status === 'done' || d.completedAmount >= d.plannedAmount);
  const rate = dailyToday.length ? Math.round(completedToday.length / dailyToday.length * 100) : 0;

  document.getElementById('todayRate').textContent = rate + '%';
  document.getElementById('todayProgress').style.width = rate + '%';
  document.getElementById('completedCount').textContent = completedToday.length;
  document.getElementById('remainingCount').textContent = dailyToday.length - completedToday.length;
  document.getElementById('todayTaskCount').textContent = dailyToday.length + '件';

  // Week rate
  const weekRate = calcWeekRate();
  document.getElementById('weekRate').textContent = weekRate + '%';

  // Streak (Phase2)
  const streak = renderStreakWidget();
  const streakEl = document.getElementById('streakCount');
  if (streakEl) streakEl.innerHTML = `${streak}<span class="stat-unit">日</span>`;

  // Today tasks
  const container = document.getElementById('todayTasks');
  const empty = document.getElementById('todayEmpty');
  container.innerHTML = '';

  if (dailyToday.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    dailyToday.forEach(dt => {
      const task = allTasks.find(t => t.id === dt.taskId);
      if (!task) return;
      container.appendChild(createTodayTaskCard(task, dt));
    });
  }

  // Urgent tasks (3日以内)
  const urgentContainer = document.getElementById('urgentTasks');
  const urgentEmpty = document.getElementById('urgentEmpty');
  const urgentTasks = activeTasks
    .filter(t => t.deadline && dateDiffDays(today, t.deadline) <= 3 && dateDiffDays(today, t.deadline) >= 0)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  urgentContainer.innerHTML = '';
  if (urgentTasks.length === 0) {
    urgentEmpty.classList.remove('hidden');
  } else {
    urgentEmpty.classList.add('hidden');
    urgentTasks.forEach(t => urgentContainer.appendChild(createTaskCard(t)));
  }
}

function createTodayTaskCard(task, dt) {
  const div = document.createElement('div');
  const isDone = dt.status === 'done' || (dt.completedAmount >= dt.plannedAmount && dt.plannedAmount > 0);
  div.className = 'task-card' + (isDone ? ' completed' : '');

  const color = getSubjectColor(task.subject);
  const pct = dt.plannedAmount ? Math.min(100, Math.round(dt.completedAmount / dt.plannedAmount * 100)) : 0;
  const deadlineText = task.deadline ? formatDeadline(task.deadline) : '';

  div.innerHTML = `
    <div class="task-subject-bar" style="background:${color}"></div>
    <div class="task-main">
      <div class="task-title">${task.title}</div>
      <div class="task-meta">
        ${task.subject ? `<span class="task-tag tag-subject" style="background:${color}20;color:${color}">${task.subject}</span>` : ''}
        ${task.unit ? `<span class="task-tag">今日: ${dt.completedAmount}/${dt.plannedAmount}${task.unit}</span>` : ''}
        ${deadlineText ? `<span class="task-tag tag-deadline">📅 ${deadlineText}</span>` : ''}
        <span class="task-tag tag-${task.priority}">${priorityLabel(task.priority)}</span>
      </div>
      ${dt.plannedAmount ? `
      <div class="task-progress">
        <div class="task-progress-text">${pct}% 完了</div>
        <div class="task-progress-bar"><div class="task-progress-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>` : ''}
    </div>
    <div class="task-actions">
      ${!isDone ? `<button class="btn btn-icon" title="進捗を記録" data-dtid="${dt.id}" data-tid="${task.id}">✏️</button>` : ''}
      <button class="btn btn-icon" title="${isDone ? '未完了に戻す' : '完了にする'}" data-complete="${dt.id}" data-done="${isDone}">
        ${isDone ? '↩️' : '✅'}
      </button>
    </div>
  `;

  div.querySelector('[data-complete]')?.addEventListener('click', (e) => {
    const done = e.currentTarget.dataset.done === 'true';
    const dtId = e.currentTarget.dataset.complete;
    toggleDailyTaskDone(dtId, !done);
    renderHome();
  });
  div.querySelector('[data-dtid]')?.addEventListener('click', (e) => {
    openProgressModal(e.currentTarget.dataset.tid, e.currentTarget.dataset.dtid);
  });

  return div;
}

function toggleDailyTaskDone(dtId, done) {
  const list = getDailyTasks();
  const dt = list.find(d => d.id === dtId);
  if (!dt) return;
  dt.status = done ? 'done' : 'pending';
  if (done) dt.completedAmount = dt.plannedAmount;
  else dt.completedAmount = 0;
  saveDailyTasks(list);

  // タスク全体の進捗も更新
  const taskDailyList = list.filter(d => d.taskId === dt.taskId);
  const totalCompleted = taskDailyList.reduce((s, d) => s + (d.completedAmount || 0), 0);
  const task = getTasks().find(t => t.id === dt.taskId);
  if (task) {
    updateTask(dt.taskId, {
      completedAmount: totalCompleted,
      status: totalCompleted >= task.totalAmount ? 'completed' : 'active',
    });
    if (done && totalCompleted >= task.totalAmount) showToast(`🎉 「${task.title}」を完了しました！`, 'success');
  }
}

// ===== Progress Modal =====
function openProgressModal(taskId, dtId) {
  progressTaskId = { taskId, dtId };
  const task = getTasks().find(t => t.id === taskId);
  const dt = getDailyTasks().find(d => d.id === dtId);
  if (!task || !dt) return;

  document.getElementById('progressTaskTitle').textContent = task.title;
  document.getElementById('progressAmount').value = dt.completedAmount || '';
  document.getElementById('progressUnit').textContent = task.unit || '';

  const remaining = (task.totalAmount || 0) - (task.completedAmount || 0);
  document.getElementById('progressInfo').innerHTML = `
    今日の目標: ${dt.plannedAmount}${task.unit || ''}<br>
    全体の残り: ${remaining}${task.unit || ''} / ${task.totalAmount}${task.unit || ''}
  `;
  openModal('progressModal');
}

function saveProgress() {
  if (!progressTaskId) return;
  const { taskId, dtId } = progressTaskId;
  const amount = parseFloat(document.getElementById('progressAmount').value) || 0;
  const list = getDailyTasks();
  const dt = list.find(d => d.id === dtId);
  if (!dt) return;
  dt.completedAmount = amount;
  dt.status = amount >= dt.plannedAmount ? 'done' : 'pending';
  saveDailyTasks(list);

  // タスク全体の完了量を再計算
  const totalCompleted = list.filter(d => d.taskId === taskId).reduce((s, d) => s + (d.completedAmount || 0), 0);
  const task = getTasks().find(t => t.id === taskId);
  updateTask(taskId, { completedAmount: totalCompleted, status: totalCompleted >= (task?.totalAmount || 0) ? 'completed' : 'active' });

  // 未完了分を残り日数で再配分
  redistributeDailyTasks(taskId);

  closeModal('progressModal');
  renderHome();
  showToast('進捗を更新しました', 'success');
}

// ===== Task List Render =====
function renderTasks() {
  const search = document.getElementById('searchInput')?.value.toLowerCase() || '';
  const subjectFilter = document.getElementById('filterSubject')?.value || '';
  const statusFilter = document.getElementById('filterStatus')?.value || '';
  const sortBy = document.getElementById('sortBy')?.value || 'deadline';

  let tasks = getTasks();
  if (search) tasks = tasks.filter(t => t.title.toLowerCase().includes(search) || (t.subject || '').toLowerCase().includes(search));
  if (subjectFilter) tasks = tasks.filter(t => t.subject === subjectFilter);
  if (statusFilter === 'active') tasks = tasks.filter(t => t.status === 'active');
  if (statusFilter === 'completed') tasks = tasks.filter(t => t.status === 'completed');

  tasks.sort((a, b) => {
    if (sortBy === 'deadline') return (a.deadline || '9999').localeCompare(b.deadline || '9999');
    if (sortBy === 'priority') return priorityOrder(a.priority) - priorityOrder(b.priority);
    return b.createdAt.localeCompare(a.createdAt);
  });

  // Update subject filter options
  const subjects = [...new Set(getTasks().map(t => t.subject).filter(Boolean))];
  const sel = document.getElementById('filterSubject');
  const cur = sel.value;
  sel.innerHTML = '<option value="">科目：すべて</option>' + subjects.map(s => `<option value="${s}" ${s === cur ? 'selected' : ''}>${s}</option>`).join('');

  const container = document.getElementById('allTasks');
  container.innerHTML = '';
  tasks.forEach(t => container.appendChild(createTaskCard(t, true)));
  initTaskFilters();
}

function createTaskCard(task, showActions = false) {
  const div = document.createElement('div');
  div.className = 'task-card' + (task.status === 'completed' ? ' completed' : '');
  const color = getSubjectColor(task.subject);
  const pct = task.totalAmount ? Math.min(100, Math.round((task.completedAmount || 0) / task.totalAmount * 100)) : 0;
  const deadlineText = task.deadline ? formatDeadline(task.deadline) : '';
  const isOverdue = task.deadline && task.deadline < todayStr() && task.status !== 'completed';

  div.innerHTML = `
    <div class="task-subject-bar" style="background:${color}"></div>
    <div class="task-main">
      <div class="task-title">${task.title}</div>
      <div class="task-meta">
        ${task.subject ? `<span class="task-tag tag-subject" style="background:${color}20;color:${color}">${task.subject}</span>` : ''}
        ${task.totalAmount ? `<span class="task-tag">${task.completedAmount || 0}/${task.totalAmount}${task.unit || ''}</span>` : ''}
        ${deadlineText ? `<span class="task-tag ${isOverdue ? 'tag-overdue' : 'tag-deadline'}">📅 ${deadlineText}</span>` : ''}
        <span class="task-tag tag-${task.priority}">${priorityLabel(task.priority)}</span>
      </div>
      ${task.totalAmount ? `
      <div class="task-progress">
        <div class="task-progress-text">${pct}% 完了</div>
        <div class="task-progress-bar"><div class="task-progress-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>` : ''}
      ${task.memo ? `<div class="task-tag" style="margin-top:6px;max-width:400px;white-space:normal;">📝 ${task.memo}</div>` : ''}
    </div>
    ${showActions ? `
    <div class="task-actions">
      <button class="btn btn-icon btn-sm" data-edit="${task.id}" title="編集">✏️</button>
      <button class="btn btn-icon btn-sm" data-toggle="${task.id}" title="${task.status === 'completed' ? '未完了' : '完了'}">
        ${task.status === 'completed' ? '↩️' : '✅'}
      </button>
      <button class="btn btn-icon btn-sm" data-del="${task.id}" title="削除">🗑️</button>
    </div>` : ''}
  `;

  if (showActions) {
    div.querySelector('[data-edit]')?.addEventListener('click', () => openTaskModal(task.id));
    div.querySelector('[data-toggle]')?.addEventListener('click', () => {
      const newStatus = task.status === 'completed' ? 'active' : 'completed';
      updateTask(task.id, { status: newStatus });
      renderTasks(); renderHome();
      showToast(newStatus === 'completed' ? '✅ 完了にしました' : '↩️ 未完了に戻しました', 'success');
    });
    div.querySelector('[data-del]')?.addEventListener('click', () => {
      if (confirm(`「${task.title}」を削除しますか？`)) {
        deleteTask(task.id);
        renderTasks(); renderHome();
        showToast('タスクを削除しました', 'danger');
      }
    });
  }
  return div;
}

// ===== Calendar =====
function setupCalendar() {
  document.getElementById('calPrev').addEventListener('click', () => {
    if (calView === 'month') calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1);
    else if (calView === 'week') calDate = addDaysDate(calDate, -7);
    else calDate = addDaysDate(calDate, -1);
    renderCalendar();
  });
  document.getElementById('calNext').addEventListener('click', () => {
    if (calView === 'month') calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1);
    else if (calView === 'week') calDate = addDaysDate(calDate, 7);
    else calDate = addDaysDate(calDate, 1);
    renderCalendar();
  });
  document.getElementById('calToday').addEventListener('click', () => { calDate = new Date(); renderCalendar(); });

  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      calView = btn.dataset.view;
      renderCalendar();
    });
  });
}

function renderCalendar() {
  const container = document.getElementById('calendarView');
  const title = document.getElementById('calTitle');
  container.innerHTML = '';

  if (calView === 'month') renderMonthCalendar(container, title);
  else if (calView === 'week') renderWeekCalendar(container, title);
  else renderDayCalendar(container, title);
}

function renderMonthCalendar(container, title) {
  const year = calDate.getFullYear(), month = calDate.getMonth();
  title.textContent = `${year}年${month + 1}月`;

  const grid = document.createElement('div');
  grid.className = 'cal-month-grid';

  const days = ['日', '月', '火', '水', '木', '金', '土'];
  days.forEach(d => { const h = document.createElement('div'); h.className = 'cal-header'; h.textContent = d; grid.appendChild(h); });

  const first = new Date(year, month, 1).getDay();
  const last = new Date(year, month + 1, 0).getDate();
  const today = todayStr();
  const dailyTasks = getDailyTasks();
  const tasks = getTasks();

  // Pad before
  for (let i = 0; i < first; i++) {
    const prevLast = new Date(year, month, 0).getDate();
    const d = document.createElement('div');
    d.className = 'cal-day other-month';
    d.innerHTML = `<div class="cal-day-num">${prevLast - first + i + 1}</div>`;
    grid.appendChild(d);
  }

  for (let day = 1; day <= last; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = dailyTasks.filter(d => d.date === dateStr);
    const d = document.createElement('div');
    d.className = 'cal-day' + (dateStr === today ? ' today' : '');

    const chips = dayTasks.slice(0, 3).map(dt => {
      const task = tasks.find(t => t.id === dt.taskId);
      if (!task) return '';
      const color = getSubjectColor(task.subject);
      return `<div class="cal-task-chip" style="background:${color}20;color:${color}">${task.title}</div>`;
    }).join('');

    d.innerHTML = `<div class="cal-day-num">${day}</div>${chips}`;
    grid.appendChild(d);
  }

  container.appendChild(grid);
}

function renderWeekCalendar(container, title) {
  const dow = calDate.getDay();
  const weekStart = addDaysDate(calDate, -dow);
  const weekEnd = addDaysDate(weekStart, 6);
  title.textContent = `${weekStart.getMonth() + 1}/${weekStart.getDate()} 〜 ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;

  const grid = document.createElement('div');
  grid.className = 'cal-week-grid';

  // Headers
  const emptyH = document.createElement('div');
  emptyH.className = 'cal-week-header';
  grid.appendChild(emptyH);

  const today = todayStr();
  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  for (let i = 0; i < 7; i++) {
    const d = addDaysDate(weekStart, i);
    const dStr = dateToStr(d);
    const h = document.createElement('div');
    h.className = 'cal-week-header' + (dStr === today ? ' today' : '');
    h.textContent = `${dayLabels[d.getDay()]} ${d.getDate()}`;
    grid.appendChild(h);
  }

  const dailyTasks = getDailyTasks();
  const tasks = getTasks();

  // Rows (simplified: no time slots, just task list per day)
  for (let h = 0; h < 3; h++) {
    const timeLabel = document.createElement('div');
    timeLabel.className = 'cal-time-label';
    timeLabel.textContent = h === 0 ? '午前' : h === 1 ? '午後' : '夜';
    grid.appendChild(timeLabel);
    for (let i = 0; i < 7; i++) {
      const d = addDaysDate(weekStart, i);
      const dStr = dateToStr(d);
      const cell = document.createElement('div');
      cell.className = 'cal-week-cell';
      const dayTs = dailyTasks.filter(dt => dt.date === dStr);
      if (h === 0) {
        dayTs.slice(0, 2).forEach(dt => {
          const task = tasks.find(t => t.id === dt.taskId);
          if (!task) return;
          const color = getSubjectColor(task.subject);
          const chip = document.createElement('div');
          chip.className = 'cal-week-task';
          chip.style.cssText = `background:${color}20;color:${color}`;
          chip.textContent = task.title;
          cell.appendChild(chip);
        });
      }
      grid.appendChild(cell);
    }
  }

  container.appendChild(grid);
}

function renderDayCalendar(container, title) {
  const dStr = dateToStr(calDate);
  title.textContent = `${calDate.getFullYear()}年${calDate.getMonth() + 1}月${calDate.getDate()}日`;

  const dailyTasks = getDailyTasksForDate(dStr);
  const tasks = getTasks();

  const list = document.createElement('div');
  list.className = 'task-list';

  if (dailyTasks.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>この日のタスクはありません</p></div>';
  } else {
    dailyTasks.forEach(dt => {
      const task = tasks.find(t => t.id === dt.taskId);
      if (!task) return;
      list.appendChild(createTodayTaskCard(task, dt));
    });
  }
  container.appendChild(list);
}

// ===== Stats =====
function setupStats() {
  document.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      statsPeriod = btn.dataset.period;
      renderStats();
    });
  });
}

function renderStats() {
  const today = todayStr();
  const days = statsPeriod === 'week' ? 7 : 30;
  const dates = Array.from({ length: days }, (_, i) => addDays(today, -(days - 1 - i)));
  const dailyTasks = getDailyTasks();
  const tasks = getTasks();

  let totalPlanned = 0, totalDone = 0, totalAmount = 0;
  dates.forEach(date => {
    const dts = dailyTasks.filter(d => d.date === date);
    totalPlanned += dts.length;
    const done = dts.filter(d => d.status === 'done' || d.completedAmount >= d.plannedAmount);
    totalDone += done.length;
    totalAmount += done.reduce((s, d) => s + (d.completedAmount || 0), 0);
  });

  const rate = totalPlanned ? Math.round(totalDone / totalPlanned * 100) : 0;
  document.getElementById('statsRate').textContent = rate + '%';
  document.getElementById('statsCompleted').textContent = totalDone;
  document.getElementById('statsAmount').textContent = totalAmount;

  // Subject stats
  const subjectMap = {};
  tasks.forEach(t => {
    if (!t.subject) return;
    if (!subjectMap[t.subject]) subjectMap[t.subject] = { total: 0, completed: 0 };
    subjectMap[t.subject].total++;
    if (t.status === 'completed') subjectMap[t.subject].completed++;
  });

  const subjectContainer = document.getElementById('subjectStats');
  subjectContainer.innerHTML = '';
  const colors = ['#4f46e5','#7c3aed','#db2777','#059669','#d97706','#0284c7'];
  Object.entries(subjectMap).forEach(([subj, data], i) => {
    const pct = data.total ? Math.round(data.completed / data.total * 100) : 0;
    const color = getSubjectColor(subj) || colors[i % colors.length];
    const row = document.createElement('div');
    row.className = 'subject-stat-row';
    row.innerHTML = `
      <div class="subject-stat-name">${subj}</div>
      <div class="subject-stat-bar"><div class="subject-stat-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="subject-stat-pct">${pct}%</div>
    `;
    subjectContainer.appendChild(row);
  });

  // Daily chart
  const chartContainer = document.getElementById('dailyChart');
  chartContainer.innerHTML = '';
  const max = Math.max(1, ...dates.map(date => dailyTasks.filter(d => d.date === date).length));

  dates.forEach(date => {
    const dts = dailyTasks.filter(d => d.date === date);
    const done = dts.filter(d => d.status === 'done' || d.completedAmount >= d.plannedAmount).length;
    const height = dts.length ? Math.round(done / dts.length * 100) : 0;
    const bar = document.createElement('div');
    bar.className = 'daily-bar';
    const d = new Date(date);
    bar.innerHTML = `
      <div class="daily-bar-fill" style="height:${height}%;background:var(--accent);opacity:${0.4 + height / 100 * 0.6}"></div>
      <div class="daily-bar-label">${d.getMonth() + 1}/${d.getDate()}</div>
    `;
    chartContainer.appendChild(bar);
  });
}

// ===== Repeat Tasks (Phase2) =====
function setupRepeat() {
  document.getElementById('addRepeatBtn').addEventListener('click', () => openModal('repeatModal'));
  document.getElementById('repeatModalClose').addEventListener('click', () => closeModal('repeatModal'));
  document.getElementById('repeatModalCancel').addEventListener('click', () => closeModal('repeatModal'));

  document.querySelectorAll('.weekday-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  document.getElementById('repeatModalSave').addEventListener('click', () => {
    const title = document.getElementById('repeatTitle').value.trim();
    if (!title) { showToast('タイトルを入力してください', 'danger'); return; }

    const days = [...document.querySelectorAll('.weekday-btn.active')].map(b => parseInt(b.dataset.day));
    if (days.length === 0) { showToast('曜日を選択してください', 'danger'); return; }

    addRepeatTask({
      id: generateId(),
      title,
      subject: document.getElementById('repeatSubject').value.trim(),
      amount: parseFloat(document.getElementById('repeatAmount').value) || 1,
      unit: document.getElementById('repeatUnit').value.trim(),
      memo: document.getElementById('repeatMemo').value.trim(),
      days,
      createdAt: new Date().toISOString(),
    });

    closeModal('repeatModal');
    renderRepeat();
    showToast('繰り返しタスクを追加しました', 'success');

    // Reset
    document.querySelectorAll('.weekday-btn').forEach(b => b.classList.remove('active'));
  });
}

function renderRepeat() {
  const list = getRepeatTasks();
  const container = document.getElementById('repeatTasks');
  const empty = document.getElementById('repeatEmpty');
  container.innerHTML = '';

  if (list.length === 0) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    list.forEach(rt => {
      const color = getSubjectColor(rt.subject);
      const card = document.createElement('div');
      card.className = 'task-card';
      card.innerHTML = `
        <div class="task-subject-bar" style="background:${color}"></div>
        <div class="task-main">
          <div class="task-title">🔁 ${rt.title}</div>
          <div class="task-meta">
            ${rt.subject ? `<span class="task-tag tag-subject" style="background:${color}20;color:${color}">${rt.subject}</span>` : ''}
            ${rt.amount ? `<span class="task-tag">${rt.amount}${rt.unit || ''}/回</span>` : ''}
            <span class="task-tag">${rt.days.map(d => dayNames[d]).join('・')}</span>
          </div>
        </div>
        <div class="task-actions">
          <button class="btn btn-icon btn-sm" data-del="${rt.id}" title="削除">🗑️</button>
        </div>
      `;
      card.querySelector('[data-del]').addEventListener('click', () => {
        if (confirm(`「${rt.title}」を削除しますか？`)) {
          deleteRepeatTask(rt.id);
          renderRepeat();
          showToast('削除しました', 'danger');
        }
      });
      container.appendChild(card);
    });
  }
}

// ===== Timetable (Phase2) =====
function setupTimetable() {
  document.getElementById('addPeriodBtn').addEventListener('click', () => openModal('periodModal'));
  document.getElementById('periodModalClose').addEventListener('click', () => closeModal('periodModal'));
  document.getElementById('periodModalCancel').addEventListener('click', () => closeModal('periodModal'));
  document.getElementById('periodModalSave').addEventListener('click', () => {
    const subject = document.getElementById('periodSubject').value.trim();
    if (!subject) { showToast('科目名を入力してください', 'danger'); return; }
    addPeriod({
      id: generateId(),
      day: parseInt(document.getElementById('periodDay').value),
      slot: parseInt(document.getElementById('periodSlot').value),
      subject,
      room: document.getElementById('periodRoom').value.trim(),
      teacher: document.getElementById('periodTeacher').value.trim(),
    });
    closeModal('periodModal');
    renderTimetable();
    showToast('時間割を追加しました', 'success');
  });
}

function renderTimetable() {
  const grid = document.getElementById('timetableGrid');
  grid.innerHTML = '';
  const timetable = getTimetable();
  const dayLabels = ['月', '火', '水', '木', '金', '土'];
  const slotTimes = ['8:50', '10:40', '12:50', '14:40', '16:30', '18:20'];

  // Headers
  const corner = document.createElement('div');
  corner.className = 'tt-header';
  grid.appendChild(corner);
  dayLabels.forEach(d => {
    const h = document.createElement('div');
    h.className = 'tt-header';
    h.textContent = d;
    grid.appendChild(h);
  });

  for (let slot = 1; slot <= 6; slot++) {
    const timeEl = document.createElement('div');
    timeEl.className = 'tt-time';
    timeEl.innerHTML = `<div>${slot}限<br><small>${slotTimes[slot - 1]}</small></div>`;
    grid.appendChild(timeEl);

    for (let day = 1; day <= 6; day++) {
      const cell = document.createElement('div');
      cell.className = 'tt-cell';
      const period = timetable.find(p => p.day === day && p.slot === slot);
      if (period) {
        const color = getSubjectColor(period.subject);
        cell.innerHTML = `
          <div class="tt-subject" style="background:${color}20;color:${color};border-color:${color}">
            <strong>${period.subject}</strong>
            ${period.room ? `<div class="tt-room">${period.room}</div>` : ''}
          </div>
        `;
        cell.addEventListener('click', () => {
          if (confirm(`「${period.subject}」を削除しますか？`)) {
            deletePeriod(period.id);
            renderTimetable();
          }
        });
      } else {
        cell.addEventListener('click', () => {
          document.getElementById('periodDay').value = day;
          document.getElementById('periodSlot').value = slot;
          openModal('periodModal');
        });
      }
      grid.appendChild(cell);
    }
  }
}

// ===== Helpers =====
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(message, type = '') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type ? ' ' + type : '');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function getSubjectColor(subject) {
  if (!subject) return 'var(--accent)';
  const map = getSubjectColors();
  if (map[subject]) return map[subject];
  // 自動生成
  const colors = ['#4f46e5','#7c3aed','#db2777','#059669','#d97706','#0284c7','#0891b2','#65a30d'];
  let hash = 0;
  for (let c of subject) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

function priorityLabel(p) {
  return p === 'high' ? '🔴 高' : p === 'low' ? '🟢 低' : '🟡 中';
}
function priorityOrder(p) { return p === 'high' ? 0 : p === 'medium' ? 1 : 2; }

function formatDeadline(d) {
  const today = todayStr();
  const diff = dateDiffDays(today, d);
  if (diff < 0) return `${-diff}日超過`;
  if (diff === 0) return '今日';
  if (diff === 1) return '明日';
  return `${d.replace(/-/g, '/')} (あと${diff}日)`;
}

function dateDiffDays(from, to) {
  const f = new Date(from), t = new Date(to);
  return Math.round((t - f) / 86400000);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return dateToStr(d);
}

function addDaysDate(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateToStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calcWeekRate() {
  const today = todayStr();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i)));
  const dts = getDailyTasks().filter(d => dates.includes(d.date));
  if (!dts.length) return 0;
  const done = dts.filter(d => d.status === 'done' || d.completedAmount >= d.plannedAmount).length;
  return Math.round(done / dts.length * 100);
}

function updateDateBadge() {
  const d = new Date();
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  document.getElementById('todayDate').textContent =
    `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`;
}

// ===== 通知スケジューラ (Phase2) =====
function scheduleNotifications() {
  if (Notification.permission !== 'granted') return;

  const today = todayStr();
  const tasks = getTasks().filter(t => t.status === 'active');
  const now = new Date();

  // 締切が今日のタスク通知
  const todayDeadline = tasks.filter(t => t.deadline === today);
  if (todayDeadline.length > 0) {
    const msg = todayDeadline.map(t => t.title).join('、');
    showBrowserNotif('📅 今日が締切のタスク', msg);
  }

  // 明日締切のタスク
  const tomorrow = addDays(today, 1);
  const tomorrowDeadline = tasks.filter(t => t.deadline === tomorrow);
  if (tomorrowDeadline.length > 0) {
    const msg = tomorrowDeadline.map(t => t.title).join('、') + ' — 明日が締切です';
    showBrowserNotif('⚠️ 明日締切のタスク', msg);
  }

  // 今日のタスク件数
  const todayTasks = getDailyTasksForDate(today);
  if (todayTasks.length > 0) {
    const pending = todayTasks.filter(d => d.status !== 'done' && d.completedAmount < d.plannedAmount);
    if (pending.length > 0) {
      showBrowserNotif('📚 今日の学習', `残り ${pending.length} 件のタスクがあります`);
    }
  }
}

function showBrowserNotif(title, body) {
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '📚' });
  } catch (e) {
    console.warn('通知エラー:', e);
  }
}

// 1分ごとに締切チェック
setInterval(() => {
  const now = new Date();
  // 毎朝8時に通知
  if (now.getHours() === 8 && now.getMinutes() === 0) {
    scheduleNotifications();
  }
}, 60000);

// ===== フィルター初期化（重複バインド防止） =====
function initTaskFilters() {
  const ids = ['searchInput', 'filterSubject', 'filterStatus', 'sortBy'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el || el._filterBound) return;
    el._filterBound = true;
    el.addEventListener('input', renderTasks);
    el.addEventListener('change', renderTasks);
  });
}

// ===== ウィジェット風ホーム追加要素 =====
function renderStreakWidget() {
  // 連続達成日数を計算
  const today = todayStr();
  let streak = 0;
  let checkDate = today;

  while (true) {
    const dts = getDailyTasks().filter(d => d.date === checkDate);
    if (dts.length === 0) break;
    const allDone = dts.every(d => d.status === 'done' || d.completedAmount >= d.plannedAmount);
    if (!allDone) break;
    streak++;
    checkDate = addDays(checkDate, -1);
  }
  return streak;
}
