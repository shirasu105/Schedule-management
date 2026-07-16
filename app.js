// ============================================================
//  StudyFlow — Phase 1
//  app.js  (ES Modules, no framework)
// ============================================================

// ─── ユーティリティ ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function daysLeft(iso) {
  if (!iso) return null;
  const diff = new Date(iso + 'T00:00:00') - new Date(today() + 'T00:00:00');
  return Math.ceil(diff / 86400000);
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── ストレージ ──────────────────────────────────────────────
const KEYS = { tasks: 'sf_tasks', daily: 'sf_daily', stats: 'sf_stats', settings: 'sf_settings' };

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function save(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

// ─── 状態 ────────────────────────────────────────────────────
let tasks    = load(KEYS.tasks)    || [];
let daily    = load(KEYS.daily)    || [];
let settings = load(KEYS.settings) || { theme: 'dark', notif: false };

// ─── ページナビゲーション ────────────────────────────────────
let currentPage = 'today';

export function navigate(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('page-' + page);
  if (el) el.classList.remove('hidden');
  if (btn) btn.classList.add('active');
  currentPage = page;
  renderPage(page);
}

function renderPage(page) {
  if (page === 'today')    renderToday();
  if (page === 'tasks')    renderTaskList();
  if (page === 'calendar') renderCalendar();
  if (page === 'stats')    renderStats();
  if (page === 'settings') renderSettings();
}

// グローバルに公開
window.navigate = navigate;

// ─── タスク CRUD ─────────────────────────────────────────────
function saveTasks() { save(KEYS.tasks, tasks); }
function saveDaily()  { save(KEYS.daily, daily); }

function addTask(data) {
  const task = {
    id:              uid(),
    title:           data.title,
    subject:         data.subject || '',
    totalAmount:     Number(data.totalAmount),
    completedAmount: 0,
    unit:            data.unit || '',
    deadline:        data.deadline,
    priority:        data.priority || 'medium',
    memo:            data.memo || '',
    status:          'active',
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  };
  tasks.push(task);
  saveTasks();
  generateDailyTasks(task);
  return task;
}

function updateTask(id, data) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  Object.assign(tasks[idx], data, { updatedAt: new Date().toISOString() });
  saveTasks();
  // daily再生成
  daily = daily.filter(d => d.taskId !== id);
  generateDailyTasks(tasks[idx]);
  saveDaily();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  daily = daily.filter(d => d.taskId !== id);
  saveTasks();
  saveDaily();
}

function toggleTaskComplete(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.status = t.status === 'completed' ? 'active' : 'completed';
  t.updatedAt = new Date().toISOString();
  if (t.status === 'completed') {
    t.completedAmount = t.totalAmount;
    // 今日のdailyも完了に
    const todayStr = today();
    daily.filter(d => d.taskId === id && d.date === todayStr)
         .forEach(d => { d.completedAmount = d.plannedAmount; d.status = 'completed'; });
  }
  saveTasks();
  saveDaily();
  recordStats();
}

// ─── 自動分割 ────────────────────────────────────────────────
function generateDailyTasks(task) {
  if (task.status === 'completed') return;

  const todayStr = today();
  const deadline = task.deadline;
  const remaining = task.totalAmount - task.completedAmount;
  if (remaining <= 0) return;

  // 今日〜締切の日数
  const start = todayStr <= deadline ? todayStr : deadline;
  const days  = Math.max(1, daysLeft(deadline) ?? 1);

  const base   = Math.floor(remaining / days);
  const extra  = remaining % days;

  for (let i = 0; i < days; i++) {
    const date   = addDays(todayStr, i);
    if (date > deadline) break;
    const planned = base + (i < extra ? 1 : 0);
    // 既存があればスキップ
    if (daily.some(d => d.taskId === task.id && d.date === date)) continue;
    daily.push({
      id:              uid(),
      taskId:          task.id,
      date,
      plannedAmount:   planned,
      completedAmount: 0,
      status:          'pending',
    });
  }
  saveDaily();
}

// ─── 自動再分配 ──────────────────────────────────────────────
function redistributeTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status === 'completed') return;

  const todayStr = today();

  // 今日より未来のdailyを削除
  daily = daily.filter(d => !(d.taskId === taskId && d.date > todayStr));

  // 完了量を合計
  const doneTotal = daily
    .filter(d => d.taskId === taskId)
    .reduce((s, d) => s + d.completedAmount, 0);

  task.completedAmount = doneTotal;
  task.updatedAt = new Date().toISOString();
  saveTasks();

  // 残りを再分割
  const remaining = task.totalAmount - doneTotal;
  if (remaining <= 0) {
    task.status = 'completed';
    saveTasks();
    return;
  }

  const days = Math.max(1, daysLeft(task.deadline) ?? 1);
  const base  = Math.floor(remaining / days);
  const extra = remaining % days;

  for (let i = 0; i < days; i++) {
    const date = addDays(todayStr, i + 1); // 明日以降
    if (date > task.deadline) break;
    const planned = base + (i < extra ? 1 : 0);
    daily.push({ id: uid(), taskId, date, plannedAmount: planned, completedAmount: 0, status: 'pending' });
  }
  saveDaily();
}

// ─── 統計記録 ────────────────────────────────────────────────
function recordStats() {
  const todayStr = today();
  let statsArr = load(KEYS.stats) || [];
  const todayDaily = daily.filter(d => d.date === todayStr);
  const total   = todayDaily.length;
  const done    = todayDaily.filter(d => d.status === 'completed').length;
  const rate    = total > 0 ? Math.round(done / total * 100) : 0;
  const existing = statsArr.findIndex(s => s.date === todayStr);
  const rec = { date: todayStr, completionRate: rate, completedTasks: done, totalTasks: total };
  if (existing >= 0) statsArr[existing] = rec;
  else statsArr.push(rec);
  save(KEYS.stats, statsArr);
}

// ─── 今日のタスク描画 ────────────────────────────────────────
function renderToday() {
  const todayStr = today();
  $('today-date').textContent = new Date().toLocaleDateString('ja-JP', { month:'long', day:'numeric', weekday:'short' });

  const todayEntries = daily.filter(d => d.date === todayStr);

  // ゲージ更新
  const total = todayEntries.length;
  const done  = todayEntries.filter(d => d.status === 'completed').length;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;
  $('gauge-bar').style.width = pct + '%';
  $('gauge-pct').textContent = pct + '%';

  const list = $('today-task-list');
  list.innerHTML = '';

  if (todayEntries.length === 0) {
    $('today-empty').style.display = '';
    list.style.display = 'none';
  } else {
    $('today-empty').style.display = 'none';
    list.style.display = '';
    todayEntries.forEach(entry => {
      const task = tasks.find(t => t.id === entry.taskId);
      if (!task) return;
      const pct = entry.plannedAmount > 0
        ? Math.min(100, Math.round(entry.completedAmount / entry.plannedAmount * 100))
        : 0;
      const isDone = entry.status === 'completed';
      const card = document.createElement('div');
      card.className = 'task-card' + (isDone ? ' completed' : '');
      card.innerHTML = `
        <div class="task-card-top">
          <button class="task-check" onclick="toggleDailyDone('${entry.id}')">${isDone ? '✓' : ''}</button>
          <div class="task-info">
            <div class="task-title">${esc(task.title)}</div>
            <div class="task-meta">
              ${task.subject ? `<span class="tag">${esc(task.subject)}</span>` : ''}
              <span class="tag priority-${task.priority}">${priorityLabel(task.priority)}</span>
              ${task.deadline ? `<span class="tag${daysLeft(task.deadline) <= 1 ? ' deadline-near' : ''}">締切 ${fmtDate(task.deadline)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="task-progress">
          <div class="progress-numbers">
            <span>${entry.completedAmount} / ${entry.plannedAmount} ${esc(task.unit)}</span>
            <span>${pct}%</span>
          </div>
          <div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
          ${!isDone ? `<div class="progress-update-row"><button class="btn-progress" onclick="openProgressModal('${entry.id}')">進捗を入力</button></div>` : ''}
        </div>`;
      list.appendChild(card);
    });
  }

  // 締切一覧（今後7日）
  renderDeadlines();
}

function renderDeadlines() {
  const todayStr = today();
  const soon = tasks
    .filter(t => t.status !== 'completed' && t.deadline)
    .filter(t => { const d = daysLeft(t.deadline); return d !== null && d >= 0 && d <= 7; })
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  const container = $('deadline-list');
  container.innerHTML = '';
  if (soon.length === 0) {
    container.innerHTML = '<p style="color:var(--sub);font-size:13px">直近の締切はありません</p>';
    return;
  }
  soon.forEach(t => {
    const d = daysLeft(t.deadline);
    const chip = document.createElement('div');
    chip.className = 'deadline-chip' + (d <= 1 ? ' urgent' : '');
    chip.innerHTML = `
      <span class="dl-title">${esc(t.title)}</span>
      <span class="dl-date">${d === 0 ? '今日' : d === 1 ? '明日' : `あと${d}日`}</span>`;
    container.appendChild(chip);
  });
}

// ─── 今日の完了トグル ────────────────────────────────────────
window.toggleDailyDone = function(dailyId) {
  const entry = daily.find(d => d.id === dailyId);
  if (!entry) return;
  if (entry.status === 'completed') {
    entry.status = 'pending';
    entry.completedAmount = 0;
  } else {
    entry.status = 'completed';
    entry.completedAmount = entry.plannedAmount;
  }
  saveDaily();
  redistributeTask(entry.taskId);
  recordStats();
  renderToday();
  showToast(entry.status === 'completed' ? '✅ 完了しました' : '↩ 未完了に戻しました');
};

// ─── 進捗モーダル ────────────────────────────────────────────
window.openProgressModal = function(dailyId) {
  const entry = daily.find(d => d.id === dailyId);
  if (!entry) return;
  const task = tasks.find(t => t.id === entry.taskId);
  $('prog-daily-id').value = dailyId;
  $('prog-modal-title').textContent = task ? task.title : '進捗を更新';
  $('prog-amount').value = entry.completedAmount;
  $('prog-amount').max = entry.plannedAmount;
  $('prog-info').innerHTML = `
    <strong>${esc(task?.title || '')}</strong><br>
    今日の目標: <b>${entry.plannedAmount} ${esc(task?.unit || '')}</b>`;
  $('progress-modal').classList.remove('hidden');
  setTimeout(() => $('prog-amount').focus(), 50);
};

window.closeProgressModal = () => $('progress-modal').classList.add('hidden');
window.closeProgressOnBg = e => { if (e.target.id === 'progress-modal') closeProgressModal(); };

window.saveProgress = function() {
  const dailyId = $('prog-daily-id').value;
  const amount  = Math.max(0, Number($('prog-amount').value));
  const entry   = daily.find(d => d.id === dailyId);
  if (!entry) return;
  entry.completedAmount = amount;
  entry.status = amount >= entry.plannedAmount ? 'completed' : 'pending';
  saveDaily();
  redistributeTask(entry.taskId);
  recordStats();
  closeProgressModal();
  renderToday();
  showToast('📝 進捗を更新しました');
};

// ─── タスク一覧描画 ──────────────────────────────────────────
window.renderTaskList = function() {
  const q      = ($('task-search')?.value || '').toLowerCase();
  const status = $('task-filter-status')?.value || 'all';
  const sort   = $('task-sort')?.value || 'deadline';

  let list = tasks.filter(t => {
    if (status === 'active'    && t.status === 'completed') return false;
    if (status === 'completed' && t.status !== 'completed') return false;
    if (q && !t.title.toLowerCase().includes(q) && !t.subject.toLowerCase().includes(q)) return false;
    return true;
  });

  list.sort((a, b) => {
    if (sort === 'deadline') return (a.deadline || '9999').localeCompare(b.deadline || '9999');
    if (sort === 'priority') { const o = {high:0,medium:1,low:2}; return o[a.priority] - o[b.priority]; }
    return b.createdAt.localeCompare(a.createdAt);
  });

  const container = $('task-list');
  const empty     = $('tasks-empty');
  container.innerHTML = '';

  if (list.length === 0) { empty.style.display = ''; container.style.display = 'none'; return; }
  empty.style.display = 'none'; container.style.display = '';

  list.forEach(t => {
    const pct = t.totalAmount > 0 ? Math.min(100, Math.round(t.completedAmount / t.totalAmount * 100)) : 0;
    const dl  = daysLeft(t.deadline);
    const card = document.createElement('div');
    card.className = 'task-card' + (t.status === 'completed' ? ' completed' : '');
    card.innerHTML = `
      <div class="task-card-top">
        <button class="task-check" onclick="toggleTaskComplete('${t.id}')">${t.status === 'completed' ? '✓' : ''}</button>
        <div class="task-info">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            ${t.subject ? `<span class="tag">${esc(t.subject)}</span>` : ''}
            <span class="tag priority-${t.priority}">${priorityLabel(t.priority)}</span>
            ${t.deadline ? `<span class="tag${dl !== null && dl <= 3 && t.status !== 'completed' ? ' deadline-near' : ''}">締切 ${fmtDate(t.deadline)}</span>` : ''}
            <span class="tag">${t.completedAmount}/${t.totalAmount} ${esc(t.unit)}</span>
          </div>
        </div>
        <div class="task-actions">
          <button class="btn-icon" onclick="openEditTask('${t.id}')" title="編集">✏️</button>
          <button class="btn-icon" onclick="confirmDelete('${t.id}')" title="削除">🗑️</button>
        </div>
      </div>
      <div class="task-progress" style="margin-top:10px">
        <div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
      </div>`;
    container.appendChild(card);
  });
};

window.toggleTaskComplete = function(id) {
  toggleTaskComplete_internal(id);
};

function toggleTaskComplete_internal(id) {
  toggleTaskComplete(id);
  recordStats();
  renderPage(currentPage);
  showToast('✅ ステータスを変更しました');
}

window.confirmDelete = function(id) {
  if (confirm('このタスクを削除しますか？')) {
    deleteTask(id);
    renderPage(currentPage);
    showToast('🗑️ 削除しました');
  }
};

// ─── タスク追加/編集モーダル ─────────────────────────────────
window.openAddTask = function() {
  $('modal-title').textContent = 'タスクを追加';
  $('edit-task-id').value = '';
  clearForm();
  // デフォルト締切を1週間後に
  const d = new Date(); d.setDate(d.getDate() + 7);
  $('f-deadline').value = d.toISOString().slice(0, 10);
  $('task-modal').classList.remove('hidden');
  setTimeout(() => $('f-title').focus(), 50);
  updateSplitPreview();
};

window.openEditTask = function(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  $('modal-title').textContent = 'タスクを編集';
  $('edit-task-id').value = id;
  $('f-title').value    = t.title;
  $('f-subject').value  = t.subject;
  $('f-priority').value = t.priority;
  $('f-total').value    = t.totalAmount;
  $('f-unit').value     = t.unit;
  $('f-deadline').value = t.deadline;
  $('f-memo').value     = t.memo;
  $('task-modal').classList.remove('hidden');
  updateSplitPreview();
};

window.closeModal = () => $('task-modal').classList.add('hidden');
window.closeModalOnBg = e => { if (e.target.id === 'task-modal') closeModal(); };

function clearForm() {
  ['f-title','f-subject','f-total','f-unit','f-deadline','f-memo'].forEach(id => $(id).value = '');
  $('f-priority').value = 'medium';
}

window.saveTask = function() {
  const title    = $('f-title').value.trim();
  const total    = Number($('f-total').value);
  const deadline = $('f-deadline').value;
  if (!title)    { shakeInput('f-title');    return; }
  if (!total)    { shakeInput('f-total');    return; }
  if (!deadline) { shakeInput('f-deadline'); return; }

  const data = {
    title,
    subject:     $('f-subject').value.trim(),
    priority:    $('f-priority').value,
    totalAmount: total,
    unit:        $('f-unit').value.trim(),
    deadline,
    memo:        $('f-memo').value.trim(),
  };

  const editId = $('edit-task-id').value;
  if (editId) {
    updateTask(editId, data);
    showToast('✏️ タスクを更新しました');
  } else {
    addTask(data);
    showToast('✅ タスクを追加しました');
  }
  closeModal();
  renderPage(currentPage);
  renderToday();
};

// 分割プレビュー
function updateSplitPreview() {
  const total    = Number($('f-total').value);
  const deadline = $('f-deadline').value;
  const unit     = $('f-unit').value.trim() || '';
  const preview  = $('split-preview');

  if (!total || !deadline) { preview.classList.remove('show'); return; }
  const days = Math.max(1, daysLeft(deadline) ?? 1);
  const base  = Math.floor(total / days);
  const extra = total % days;

  const chips = [];
  for (let i = 0; i < Math.min(days, 7); i++) {
    chips.push(`<span class="split-chip">${base + (i < extra ? 1 : 0)} ${unit}</span>`);
  }
  const more = days > 7 ? `<span class="split-chip">…他 ${days - 7} 日</span>` : '';

  preview.classList.add('show');
  preview.innerHTML = `
    <div class="split-title">📅 自動分割プレビュー（${days}日間）</div>
    <div class="split-chips">${chips.join('') + more}</div>`;
}

['f-total','f-deadline','f-unit'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('input', updateSplitPreview);
});

function shakeInput(id) {
  const el = $(id);
  if (!el) return;
  el.style.borderColor = 'var(--red)';
  el.focus();
  setTimeout(() => el.style.borderColor = '', 1500);
}

// ─── カレンダー ──────────────────────────────────────────────
let calCursor = new Date();
let calView   = 'month';

window.setCalView = function(view, btn) {
  calView = view;
  document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCalendar();
};

window.calNav = function(dir) {
  if (calView === 'month') calCursor.setMonth(calCursor.getMonth() + dir);
  if (calView === 'week')  calCursor.setDate(calCursor.getDate() + dir * 7);
  if (calView === 'day')   calCursor.setDate(calCursor.getDate() + dir);
  renderCalendar();
};

function renderCalendar() {
  const body = $('calendar-body');
  const title = $('cal-title');
  if (!body) return;

  if (calView === 'month') renderMonthCal(body, title);
  if (calView === 'week')  renderWeekCal(body, title);
  if (calView === 'day')   renderDayCal(body, title);
}

function renderMonthCal(body, title) {
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  title.textContent = `${y}年 ${m + 1}月`;

  const first = new Date(y, m, 1);
  const last  = new Date(y, m + 1, 0);
  const startDow = first.getDay();
  const todayStr = today();

  let html = '<div class="cal-month-grid">';
  ['日','月','火','水','木','金','土'].forEach(d => {
    html += `<div class="cal-weekday">${d}</div>`;
  });

  // 空白
  for (let i = 0; i < startDow; i++) html += '<div class="cal-day other-month"></div>';

  for (let d = 1; d <= last.getDate(); d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const dayEntries = daily.filter(e => e.date === dateStr);
    const dots = dayEntries.slice(0, 3).map(e => {
      const isDone = e.status === 'completed';
      return `<span class="cal-dot${isDone ? ' done' : ''}"></span>`;
    }).join('');

    html += `<div class="cal-day${isToday ? ' today' : ''}" onclick="calSelectDay('${dateStr}')">
      <span class="cal-day-num">${d}</span>
      ${dots ? `<div class="cal-dot-row">${dots}</div>` : ''}
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
}

window.calSelectDay = function(dateStr) {
  // 日ビューへジャンプ
  calCursor = new Date(dateStr + 'T00:00:00');
  setCalView('day', document.querySelector('[data-view="day"]'));
};

function renderWeekCal(body, title) {
  const dow = calCursor.getDay();
  const monday = new Date(calCursor);
  monday.setDate(monday.getDate() - dow);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);

  title.textContent = `${fmtDate(monday.toISOString().slice(0,10))} 〜 ${fmtDate(sunday.toISOString().slice(0,10))}`;
  const todayStr = today();
  let html = '<div class="cal-day-list">';

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const isToday = dateStr === todayStr;
    const entries = daily.filter(e => e.date === dateStr);
    const dow2 = ['日','月','火','水','木','金','土'][d.getDay()];

    let taskHtml = entries.length
      ? entries.map(e => {
          const t = tasks.find(t => t.id === e.taskId);
          return `<div class="cal-task-pill${e.status === 'completed' ? ' done' : ''}">${esc(t?.title || '')} ${e.plannedAmount}${esc(t?.unit || '')}</div>`;
        }).join('')
      : '<div style="color:var(--sub);font-size:12px;padding:4px 0">予定なし</div>';

    html += `<div class="cal-day-row">
      <div class="cal-day-label${isToday ? ' today-label' : ''}">${m2(d.getMonth()+1)}/${m2(d.getDate())}<br>${dow2}</div>
      <div class="cal-day-tasks">${taskHtml}</div>
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
}

function renderDayCal(body, title) {
  const dateStr = calCursor.toISOString().slice(0, 10);
  const d = calCursor;
  const dow = ['日','月','火','水','木','金','土'][d.getDay()];
  title.textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${dow}）`;

  const entries = daily.filter(e => e.date === dateStr);
  let html = '<div class="cal-day-list">';
  if (entries.length === 0) {
    html += '<p style="color:var(--sub);font-size:14px;padding:20px 0">この日の予定はありません</p>';
  } else {
    entries.forEach(e => {
      const t = tasks.find(t => t.id === e.taskId);
      html += `<div class="cal-task-pill${e.status === 'completed' ? ' done' : ''}">
        <div style="font-weight:600">${esc(t?.title || '')}</div>
        <div style="font-size:12px;color:var(--sub);margin-top:2px">${e.plannedAmount} ${esc(t?.unit || '')} ${t?.subject ? '— ' + esc(t.subject) : ''}</div>
      </div>`;
    });
  }
  html += '</div>';
  body.innerHTML = html;
}

// ─── 統計 ────────────────────────────────────────────────────
let statPeriod = 'today';

window.setStatPeriod = function(period, btn) {
  statPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderStats();
};

function renderStats() {
  const todayStr = today();
  let entries;

  if (statPeriod === 'today') {
    entries = daily.filter(d => d.date === todayStr);
  } else if (statPeriod === 'week') {
    const start = addDays(todayStr, -6);
    entries = daily.filter(d => d.date >= start && d.date <= todayStr);
  } else {
    const d = new Date(todayStr); d.setDate(1);
    entries = daily.filter(e => e.date >= d.toISOString().slice(0,10) && e.date <= todayStr);
  }

  const total    = entries.length;
  const done     = entries.filter(d => d.status === 'completed').length;
  const pending  = total - done;
  const rate     = total > 0 ? Math.round(done / total * 100) : 0;
  const studyAmt = entries.reduce((s, d) => s + d.completedAmount, 0);

  const grid = $('stats-grid');
  grid.innerHTML = `
    <div class="stat-card"><div class="stat-value">${rate}<span style="font-size:20px">%</span></div><div class="stat-label">達成率</div></div>
    <div class="stat-card"><div class="stat-value green">${done}</div><div class="stat-label">完了</div></div>
    <div class="stat-card"><div class="stat-value yellow">${pending}</div><div class="stat-label">未完了</div></div>
    <div class="stat-card"><div class="stat-value">${studyAmt}</div><div class="stat-label">学習量合計</div></div>`;

  renderBarChart();
}

function renderBarChart() {
  const todayStr = today();
  const statsArr = load(KEYS.stats) || [];
  const chart = $('bar-chart');
  chart.innerHTML = '';

  for (let i = 6; i >= 0; i--) {
    const date = addDays(todayStr, -i);
    const rec  = statsArr.find(s => s.date === date);
    const rate = rec ? rec.completionRate : 0;
    const d    = new Date(date + 'T00:00:00');
    const dow  = ['日','月','火','水','木','金','土'][d.getDay()];

    const col = document.createElement('div');
    col.className = 'bar-col';
    col.innerHTML = `
      <div class="bar-fill" style="height:${rate}%"></div>
      <div class="bar-day-label">${dow}</div>`;
    chart.appendChild(col);
  }
}

// ─── 設定 ────────────────────────────────────────────────────
function renderSettings() {
  const themeToggle = $('theme-toggle');
  const themeLabel  = $('theme-label');
  const notifToggle = $('notif-toggle');
  const notifLabel  = $('notif-label');
  if (!themeToggle) return;

  const isDark = settings.theme === 'dark';
  themeToggle.checked = !isDark; // checked = ライト
  themeLabel.textContent = isDark ? 'ダーク' : 'ライト';

  notifToggle.checked = settings.notif;
  notifLabel.textContent = settings.notif ? 'オン' : 'オフ';
}

window.toggleTheme = function() {
  settings.theme = $('theme-toggle').checked ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', settings.theme);
  $('theme-label').textContent = settings.theme === 'dark' ? 'ダーク' : 'ライト';
  save(KEYS.settings, settings);
};

window.toggleNotif = function() {
  if ($('notif-toggle').checked) {
    Notification.requestPermission().then(p => {
      settings.notif = p === 'granted';
      $('notif-toggle').checked = settings.notif;
      $('notif-label').textContent = settings.notif ? 'オン' : 'オフ';
      save(KEYS.settings, settings);
      if (settings.notif) scheduleNotifications();
    });
  } else {
    settings.notif = false;
    $('notif-label').textContent = 'オフ';
    save(KEYS.settings, settings);
  }
};

window.exportData = function() {
  const data = { tasks, daily, stats: load(KEYS.stats) || [] };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `studyflow-${today()}.json`;
  a.click();
  showToast('📤 エクスポートしました');
};

window.importData = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.tasks) { tasks = data.tasks; save(KEYS.tasks, tasks); }
      if (data.daily) { daily = data.daily; save(KEYS.daily, daily); }
      if (data.stats) save(KEYS.stats, data.stats);
      renderPage(currentPage);
      renderToday();
      showToast('📥 インポートしました');
    } catch { showToast('❌ ファイルの形式が正しくありません'); }
  };
  reader.readAsText(file);
};

window.clearAllData = function() {
  if (!confirm('すべてのデータを削除します。この操作は取り消せません。')) return;
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  tasks = []; daily = [];
  renderToday();
  renderPage(currentPage);
  showToast('🗑️ データを削除しました');
};

// ─── 通知 ────────────────────────────────────────────────────
function scheduleNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const todayStr = today();
  const todayEntries = daily.filter(d => d.date === todayStr && d.status !== 'completed');
  if (todayEntries.length > 0) {
    new Notification('StudyFlow', {
      body: `今日のタスクが ${todayEntries.length} 件あります。`,
      icon: 'https://fonts.gstatic.com/s/i/materialiconsround/school/v16/24px.svg',
    });
  }
}

// ─── トースト ────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}
window.showToast = showToast;

// ─── ヘルパー ────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function m2(n) { return String(n).padStart(2, '0'); }
function priorityLabel(p) {
  return p === 'high' ? '🔴 高' : p === 'medium' ? '🟡 中' : '🟢 低';
}

// toggleTaskCompleteをグローバルに再定義（内部関数と衝突を避ける）
window.toggleTaskComplete = function(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.status = t.status === 'completed' ? 'active' : 'completed';
  t.updatedAt = new Date().toISOString();
  if (t.status === 'completed') {
    t.completedAmount = t.totalAmount;
    const todayStr = today();
    daily.filter(d => d.taskId === id && d.date === todayStr)
         .forEach(d => { d.completedAmount = d.plannedAmount; d.status = 'completed'; });
  }
  saveTasks();
  saveDaily();
  recordStats();
  renderPage(currentPage);
  renderToday();
  showToast('✅ ステータスを変更しました');
};

// ─── 初期化 ──────────────────────────────────────────────────
function init() {
  // テーマ適用
  document.documentElement.setAttribute('data-theme', settings.theme || 'dark');

  // 既存タスクのdaily補完
  tasks.forEach(t => {
    if (t.status !== 'completed') {
      const todayStr = today();
      if (!daily.some(d => d.taskId === t.id && d.date === todayStr)) {
        generateDailyTasks(t);
      }
    }
  });

  // 通知
  if (settings.notif) scheduleNotifications();

  // 初期ページ
  renderToday();

  // ナビゲーションのアクティブ設定
  document.querySelector('[data-page="today"].nav-btn')?.classList.add('active');
}

init();
