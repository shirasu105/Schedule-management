// ============================================================
//  StudyFlow v2.0 — Phase 2   app.js
//  HTML / CSS / Vanilla JS (ES Modules) — no framework
// ============================================================

// ─── ユーティリティ ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const today  = () => new Date().toISOString().slice(0, 10);
const uid    = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc    = s  => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const m2     = n  => String(n).padStart(2,'0');
const clamp  = (v,min,max) => Math.min(max, Math.max(min, v));

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
function priorityLabel(p) {
  return p==='high' ? '🔴 高' : p==='medium' ? '🟡 中' : '🟢 低';
}
const DOW_JA = ['日','月','火','水','木','金','土'];

// ─── ストレージ ──────────────────────────────────────────────
const KEYS = {
  tasks:    'sf_tasks',
  daily:    'sf_daily',
  stats:    'sf_stats',
  settings: 'sf_settings',
  timetable:'sf_timetable',
  subjects: 'sf_subjects',
  archive:  'sf_archive',   // 完了・期限切れタスクの保管庫
};
function load(key) { try { return JSON.parse(localStorage.getItem(key)||'null'); } catch { return null; } }
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ─── 状態 ────────────────────────────────────────────────────
let tasks      = load(KEYS.tasks)     || [];
let daily      = load(KEYS.daily)     || [];
let settings   = load(KEYS.settings)  || { theme:'dark', notif:false, notifTime:'08:00', notifDeadline:false };
let timetable  = load(KEYS.timetable) || {};
let subjectMap = load(KEYS.subjects)  || {};
let archive    = load(KEYS.archive)   || [];   // アーカイブ済みタスク

const DEFAULT_COLORS = [
  '#38BDF8','#22C55E','#EAB308','#EF4444',
  '#A855F7','#F97316','#14B8A6','#EC4899',
];
let _colorIdx = Object.keys(subjectMap).length;

function getSubjectColor(name) {
  if (!name) return 'var(--border)';
  if (subjectMap[name]) return subjectMap[name];
  const c = DEFAULT_COLORS[_colorIdx % DEFAULT_COLORS.length];
  _colorIdx++;
  subjectMap[name] = c;
  save(KEYS.subjects, subjectMap);
  return c;
}

const saveTasks     = () => save(KEYS.tasks,     tasks);
const saveDaily     = () => save(KEYS.daily,     daily);
const saveSubjects  = () => save(KEYS.subjects,  subjectMap);
const saveTimetable = () => save(KEYS.timetable, timetable);
const saveArchive   = () => save(KEYS.archive,   archive);

// ─── 連続達成日数 ────────────────────────────────────────────
function calcStreak() {
  const statsArr = load(KEYS.stats) || [];
  let streak = 0, d = today();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rec = statsArr.find(s => s.date === d);
    if (!rec || rec.completionRate < 100) break;
    streak++; d = addDays(d, -1);
  }
  return streak;
}

// ─── ページナビゲーション ────────────────────────────────────
let currentPage = 'today';

function navigate(page, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const el = $('page-' + page);
  if (el) el.classList.remove('hidden');
  if (btn) btn.classList.add('active');
  else document.querySelector(`.nav-btn[data-page="${page}"]`)?.classList.add('active');
  currentPage = page;
  renderPage(page);
}
window.navigate = navigate;

function renderPage(p) {
  if (p==='today')    renderToday();
  if (p==='tasks')    renderTaskList();
  if (p==='calendar') {
    // calMainがどちらかに応じて描画
    if (_calMain === 'timetable') renderTimetable();
    else renderCalendar();
  }
  if (p==='stats')    renderStats();
  if (p==='settings') renderSettings();
}

// ─── キーボードショートカット ────────────────────────────────
document.addEventListener('keydown', e => {
  // モーダルが開いているときはEscのみ
  const openModal = document.querySelector('.modal-overlay:not(.hidden)');
  if (openModal) {
    if (e.key === 'Escape') { closeAllModals(); }
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.key === '/') {
    e.preventDefault();
    navigate('tasks', null);
    setTimeout(() => $('task-search')?.focus(), 100);
  }
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openAddTask(); }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); openFocusMode(); }
  if (e.key === 'q' || e.key === 'Q') {
    e.preventDefault();
    navigate('today', null);
    setTimeout(() => $('quick-input')?.focus(), 100);
  }
  if (e.key === '1') navigate('today',    null);
  if (e.key === '2') navigate('tasks',    null);
  if (e.key === '3') navigate('calendar', null);
  if (e.key === '4') navigate('stats',    null);
  if (e.key === '5') navigate('settings', null);
});

function closeAllModals() {
  ['task-modal','progress-modal','tt-modal','subject-color-modal','quick-confirm-modal']
    .forEach(id => $(id)?.classList.add('hidden'));
  closeFocusMode?.();
}

// ─── タスク CRUD ─────────────────────────────────────────────
function addTask(data) {
  const task = {
    id:              uid(),
    title:           data.title,
    subject:         data.subject || '',
    totalAmount:     Number(data.totalAmount),
    completedAmount: 0,
    unit:            data.unit || '',
    startDate:       data.startDate || today(),
    deadline:        data.deadline || addDays(today(), 365),
    priority:        data.priority || 'medium',
    memo:            data.memo || '',
    status:          'active',
    repeat:          data.repeat    || 'none',
    repeatDays:      data.repeatDays || [],
    repeatEnd:       data.repeatEnd  || '',
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  };
  tasks.push(task);
  if (task.subject) getSubjectColor(task.subject);
  saveTasks();
  generateDailyTasks(task);
  return task;
}

function updateTask(id, data) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  Object.assign(tasks[idx], data, { updatedAt: new Date().toISOString() });
  if (data.subject) getSubjectColor(data.subject);
  saveTasks();
  // daily 再生成
  daily = daily.filter(d => d.taskId !== id);
  generateDailyTasks(tasks[idx]);
  saveDaily();
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  daily = daily.filter(d => d.taskId !== id);
  saveTasks(); saveDaily();
}

window.toggleTaskComplete = function(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  t.status = t.status === 'completed' ? 'active' : 'completed';
  t.updatedAt = new Date().toISOString();
  if (t.status === 'completed') {
    t.completedAmount = t.totalAmount;
    daily.filter(d => d.taskId===id && d.date===today())
         .forEach(d => { d.completedAmount=d.plannedAmount; d.status='completed'; });
  }
  saveTasks(); saveDaily(); recordStats();
  renderPage(currentPage); renderToday();
  showToast('✅ ステータスを変更しました');
};

// ─── 繰り返し判定 ────────────────────────────────────────────
function isRepeatDay(task, dateStr) {
  if (!task.repeat || task.repeat === 'none') return false;
  if (task.repeatEnd && dateStr > task.repeatEnd) return false;
  const d   = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay();
  if (task.repeat === 'daily')   return true;
  if (task.repeat === 'weekly') {
    const created = new Date(task.createdAt);
    return dow === created.getDay();
  }
  if (task.repeat === 'monthly') {
    const created = new Date(task.createdAt);
    return d.getDate() === created.getDate();
  }
  if (task.repeat === 'custom') return (task.repeatDays || []).includes(dow);
  return false;
}

// ─── 自動分割 ────────────────────────────────────────────────
function generateDailyTasks(task) {
  if (task.status === 'completed') return;
  const todayStr  = today();
  // 開始日（過去なら今日から、未来なら開始日から）
  const startStr  = task.startDate && task.startDate > todayStr ? task.startDate : todayStr;

  // 繰り返しタスク：開始日〜終了日まで展開
  if (task.repeat && task.repeat !== 'none') {
    const end = task.repeatEnd || addDays(startStr, 60);
    let d = startStr;
    while (d <= end) {
      if (isRepeatDay(task, d) && !daily.some(e => e.taskId===task.id && e.date===d)) {
        daily.push({ id:uid(), taskId:task.id, date:d,
          plannedAmount:task.totalAmount, completedAmount:0, status:'pending' });
      }
      d = addDays(d, 1);
    }
    saveDaily();
    return;
  }

  // 通常タスク：開始日〜締切まで均等分割
  const deadline  = task.deadline;
  const remaining = task.totalAmount - task.completedAmount;
  if (remaining <= 0) return;
  // 開始日から締切までの日数
  const spanDays = Math.max(1,
    Math.ceil((new Date(deadline+'T00:00:00') - new Date(startStr+'T00:00:00')) / 86400000) + 1
  );
  const base  = Math.floor(remaining / spanDays);
  const extra = remaining % spanDays;
  for (let i = 0; i < spanDays; i++) {
    const date = addDays(startStr, i);
    if (date > deadline) break;
    if (daily.some(d => d.taskId===task.id && d.date===date)) continue;
    daily.push({ id:uid(), taskId:task.id, date,
      plannedAmount:base+(i<extra?1:0), completedAmount:0, status:'pending' });
  }
  saveDaily();
}

// ─── 自動再分配 ──────────────────────────────────────────────
function redistributeTask(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.status === 'completed') return;
  if (task.repeat && task.repeat !== 'none') return; // 繰り返しは再分配しない

  const todayStr = today();
  daily = daily.filter(d => !(d.taskId===taskId && d.date>todayStr));

  const doneTotal = daily.filter(d => d.taskId===taskId)
                         .reduce((s, d) => s + d.completedAmount, 0);
  task.completedAmount = doneTotal;
  task.updatedAt = new Date().toISOString();
  saveTasks();

  const remaining = task.totalAmount - doneTotal;
  if (remaining <= 0) { task.status='completed'; saveTasks(); return; }

  const days  = Math.max(1, daysLeft(task.deadline) ?? 1);
  const base  = Math.floor(remaining / days);
  const extra = remaining % days;
  for (let i = 0; i < days; i++) {
    const date = addDays(todayStr, i + 1);
    if (date > task.deadline) break;
    daily.push({ id:uid(), taskId, date,
      plannedAmount:base+(i<extra?1:0), completedAmount:0, status:'pending' });
  }
  saveDaily();
  // 開始日が未来の場合、再分配後もstartDateを更新しない（そのまま保持）
}

// ─── 統計記録 ────────────────────────────────────────────────
function recordStats() {
  const todayStr  = today();
  const statsArr  = load(KEYS.stats) || [];
  const todayDly  = daily.filter(d => d.date === todayStr);
  const total     = todayDly.length;
  const done      = todayDly.filter(d => d.status === 'completed').length;
  const rate      = total > 0 ? Math.round(done/total*100) : 0;
  const existing  = statsArr.findIndex(s => s.date === todayStr);
  const rec       = { date:todayStr, completionRate:rate, completedTasks:done, totalTasks:total };
  if (existing >= 0) statsArr[existing] = rec; else statsArr.push(rec);
  save(KEYS.stats, statsArr);
}

// ─── ホーム描画 ──────────────────────────────────────────────
function renderToday() {
  const todayStr = today();
  $('today-date').textContent = new Date().toLocaleDateString('ja-JP',{month:'long',day:'numeric',weekday:'short'});

  const todayEntries = daily.filter(d => d.date === todayStr);
  const total        = todayEntries.length;
  const done         = todayEntries.filter(d => d.status === 'completed').length;
  const pct          = total > 0 ? Math.round(done/total*100) : 0;

  // ゲージ
  $('gauge-bar').style.width = pct + '%';
  $('gauge-pct').textContent = pct + '%';

  // 連続日数バッジ
  const streak = calcStreak();
  $('streak-badge').textContent = streak >= 2 ? `🔥 ${streak}日連続` : '';

  // ウィジェット
  renderWidgets(todayEntries, done, total, pct, streak);

  // タスクリスト
  const list = $('today-task-list');
  if (todayEntries.length === 0) {
    $('today-empty').style.display = ''; list.innerHTML = ''; list.style.display = 'none';
  } else {
    $('today-empty').style.display = 'none'; list.style.display = '';
    list.innerHTML = '';
    todayEntries.forEach(entry => {
      const task = tasks.find(t => t.id === entry.taskId);
      if (!task) return;
      const p2     = entry.plannedAmount > 0 ? clamp(Math.round(entry.completedAmount/entry.plannedAmount*100),0,100) : 0;
      const isDone = entry.status === 'completed';
      const color  = getSubjectColor(task.subject);
      const card   = document.createElement('div');
      card.className = 'task-card' + (isDone ? ' completed' : '');
      card.style.borderLeftColor = color;
      const cardId = 'card-' + entry.id;
      card.id = cardId;
      card.innerHTML = `
        <div class="task-card-top">
          <button class="task-check" id="check-${entry.id}" onclick="toggleDailyDoneAnim('${entry.id}',this)">${isDone ? '✓' : ''}</button>
          <div class="task-info">
            <div class="task-title-row">
              <span class="task-title">${esc(task.title)}</span>
              ${task.repeat !== 'none' ? '<span class="repeat-icon">🔁</span>' : ''}
            </div>
            <div class="task-meta">
              ${task.subject ? `<span class="tag" style="background:${color}22;color:${color}">${esc(task.subject)}</span>` : ''}
              <span class="tag priority-${task.priority}">${priorityLabel(task.priority)}</span>
              ${task.deadline ? `<span class="tag${(daysLeft(task.deadline)??99) <= 1 ? ' deadline-near' : ''}">締切 ${fmtDate(task.deadline)}</span>` : ''}
            </div>
          </div>
          ${task.memo ? `<button class="btn-icon" onclick="toggleMemo('${cardId}')" title="メモ">📝</button>` : ''}
        </div>
        ${task.memo ? `<div class="task-memo">${esc(task.memo)}</div>` : ''}
        <div class="task-progress">
          <div class="progress-numbers">
            <span>${entry.completedAmount} / ${entry.plannedAmount} ${esc(task.unit)}</span>
            <span>${p2}%</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width:${p2}%;background:linear-gradient(90deg,${color},${color}bb)"></div>
          </div>
          ${!isDone ? `<div class="progress-update-row"><button class="btn-progress" onclick="openProgressModal('${entry.id}')">進捗を入力</button></div>` : ''}
        </div>`;
      list.appendChild(card);
    });
  }

  renderDeadlines();
}

function renderWidgets(todayEntries, done, total, pct, streak) {
  const row = $('widget-row');
  if (!row) return;

  const activeTasks = tasks.filter(t => t.status !== 'completed').length;

  // 科目別進捗
  const subjProg = {};
  tasks.filter(t => t.status !== 'completed' && t.subject).forEach(t => {
    if (!subjProg[t.subject]) subjProg[t.subject] = {done:0, total:0};
    subjProg[t.subject].done  += t.completedAmount;
    subjProg[t.subject].total += t.totalAmount;
  });
  const subjKeys = Object.keys(subjProg);

  const subjBarsHTML = subjKeys.length === 0 ? '' : `
    <div class="widget-card full">
      <div class="widget-title">科目別進捗</div>
      <div class="subject-bars">
        ${subjKeys.map(k => {
          const {done:d, total:t2} = subjProg[k];
          const p = t2 > 0 ? Math.round(d/t2*100) : 0;
          const color = getSubjectColor(k);
          return `<div class="subj-bar-row">
            <span class="subj-bar-label" style="color:${color}">${esc(k)}</span>
            <div class="subj-bar-track"><div class="subj-bar-fill" style="width:${p}%;background:${color}"></div></div>
            <span class="subj-bar-pct">${p}%</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  const streakWidget = streak >= 2
    ? `<div class="widget-card green full">
        <div class="widget-title">🔥 連続達成</div>
        <div class="widget-value">${streak}<span class="unit">日</span></div>
        <div class="widget-sub">この調子で継続しよう！</div>
       </div>`
    : `<div class="widget-card full">
        <div class="widget-title">連続達成</div>
        <div class="widget-value" style="font-size:16px;color:var(--sub)">今日100%達成でストリーク開始！</div>
       </div>`;

  row.innerHTML = `
    <div class="widget-card accent">
      <div class="widget-title">今日の達成率</div>
      <div class="widget-value">${pct}<span class="unit">%</span></div>
      <div class="widget-sub">${done} / ${total} 件</div>
    </div>
    <div class="widget-card yellow">
      <div class="widget-title">進行中</div>
      <div class="widget-value">${activeTasks}<span class="unit">件</span></div>
      <div class="widget-sub">全 ${tasks.length} 件</div>
    </div>
    ${streakWidget}
    ${subjBarsHTML}`;
}

function renderDeadlines() {
  const soon = tasks
    .filter(t => t.status !== 'completed' && t.deadline)
    .filter(t => { const d = daysLeft(t.deadline); return d !== null && d >= 0 && d <= 7; })
    .sort((a,b) => a.deadline.localeCompare(b.deadline));

  const container = $('deadline-list');
  container.innerHTML = '';
  if (soon.length === 0) {
    container.innerHTML = '<p style="color:var(--sub);font-size:13px">直近7日以内の締切はありません</p>';
    return;
  }
  soon.forEach(t => {
    const d     = daysLeft(t.deadline);
    const color = getSubjectColor(t.subject);
    const chip  = document.createElement('div');
    chip.className = 'deadline-chip' + (d <= 1 ? ' urgent' : '');
    chip.style.borderLeftColor = color;
    chip.innerHTML = `<span class="dl-title">${esc(t.title)}</span><span class="dl-date">${d===0?'今日！':d===1?'明日':`あと${d}日`}</span>`;
    container.appendChild(chip);
  });
}

// メモ展開トグル
window.toggleMemo = function(cardId) {
  document.getElementById(cardId)?.classList.toggle('memo-open');
};

// ─── 今日の完了トグル ────────────────────────────────────────
// アニメーション付きラッパー
window.toggleDailyDoneAnim = function(dailyId, btn) {
  btn.classList.add('pop');
  btn.addEventListener('animationend', () => btn.classList.remove('pop'), { once: true });
  toggleDailyDone(dailyId);
};

window.toggleDailyDone = function(dailyId) {
  const entry = daily.find(d => d.id === dailyId);
  if (!entry) return;
  if (entry.status === 'completed') {
    entry.status = 'pending'; entry.completedAmount = 0;
  } else {
    entry.status = 'completed'; entry.completedAmount = entry.plannedAmount;
  }
  saveDaily(); redistributeTask(entry.taskId); recordStats(); renderToday();
  showToast(entry.status === 'completed' ? '✅ 完了しました！' : '↩ 未完了に戻しました');
};

// ─── 進捗モーダル ────────────────────────────────────────────
window.openProgressModal = function(dailyId) {
  const entry = daily.find(d => d.id === dailyId);
  if (!entry) return;
  const task = tasks.find(t => t.id === entry.taskId);
  $('prog-daily-id').value   = dailyId;
  $('prog-modal-title').textContent = task?.title ?? '進捗を更新';
  $('prog-amount').value     = entry.completedAmount;
  $('prog-amount').max       = entry.plannedAmount * 2; // 超過も許可
  $('prog-info').innerHTML   = `
    <strong>${esc(task?.title ?? '')}</strong>
    ${task?.subject ? `<br><span style="color:${getSubjectColor(task.subject)}">${esc(task.subject)}</span>` : ''}
    <br>今日の目標: <b>${entry.plannedAmount} ${esc(task?.unit ?? '')}</b>
    <br>残り総量: <b>${Math.max(0,(task?.totalAmount??0)-(task?.completedAmount??0))} ${esc(task?.unit ?? '')}</b>`;

  // クイック入力ボタン（25%, 50%, 75%, 100%）
  const planned = entry.plannedAmount;
  const qbtns   = $('prog-quick-btns');
  qbtns.innerHTML = [25,50,75,100].map(pct => {
    const val = Math.round(planned * pct / 100);
    return `<button class="prog-quick-btn" onclick="setProgAmount(${val})">${pct}% (${val})</button>`;
  }).join('');

  $('progress-modal').classList.remove('hidden');
  setTimeout(() => $('prog-amount').focus(), 50);
};
window.setProgAmount = function(val) { $('prog-amount').value = val; };
window.closeProgressModal  = () => $('progress-modal').classList.add('hidden');
window.closeProgressOnBg   = e  => { if (e.target.id === 'progress-modal') closeProgressModal(); };
window.saveProgress = function() {
  const dailyId = $('prog-daily-id').value;
  const amount  = Math.max(0, Number($('prog-amount').value));
  const entry   = daily.find(d => d.id === dailyId);
  if (!entry) return;
  entry.completedAmount = amount;
  entry.status = amount >= entry.plannedAmount ? 'completed' : 'pending';
  saveDaily(); redistributeTask(entry.taskId); recordStats();
  closeProgressModal(); renderToday();
  showToast('📝 進捗を更新しました');
};

// ─── タスク一覧 ──────────────────────────────────────────────
window.renderTaskList = function() {
  const q      = ($('task-search')?.value ?? '').toLowerCase();
  const subjF  = $('task-filter-subject')?.value ?? 'all';
  const status = $('task-filter-status')?.value  ?? 'all';
  const sort   = $('task-sort')?.value           ?? 'deadline';

  // 科目フィルター選択肢を同期
  const subjSel = $('task-filter-subject');
  if (subjSel) {
    const cur      = subjSel.value;
    const subjects = [...new Set(tasks.map(t => t.subject).filter(Boolean))].sort();
    subjSel.innerHTML = '<option value="all">すべての科目</option>' +
      subjects.map(s => `<option value="${esc(s)}"${s===cur?' selected':''}>${esc(s)}</option>`).join('');
  }

  let list = tasks.filter(t => {
    if (status === 'active'    && t.status === 'completed') return false;
    if (status === 'completed' && t.status !== 'completed') return false;
    if (subjF  !== 'all'       && t.subject !== subjF)      return false;
    if (q && !t.title.toLowerCase().includes(q) && !t.subject.toLowerCase().includes(q)) return false;
    return true;
  });

  list.sort((a,b) => {
    if (sort === 'deadline') return (a.deadline||'9999').localeCompare(b.deadline||'9999');
    if (sort === 'priority') { const o={high:0,medium:1,low:2}; return o[a.priority]-o[b.priority]; }
    if (sort === 'subject')  return (a.subject||'').localeCompare(b.subject||'');
    return b.createdAt.localeCompare(a.createdAt);
  });

  const container = $('task-list'), empty = $('tasks-empty');
  container.innerHTML = '';
  if (list.length === 0) { empty.style.display=''; container.style.display='none'; return; }
  empty.style.display = 'none'; container.style.display = '';

  // 締切でグループ分け（deadline順のときのみ）
  const useGroups = sort === 'deadline' && status !== 'completed' && subjF === 'all' && !q;
  let lastGroup = null;

  const getGroup = t => {
    if (t.status === 'completed') return '完了';
    const dl = daysLeft(t.deadline);
    if (dl === null) return 'その他';
    if (dl < 0)  return '期限切れ';
    if (dl === 0) return '今日';
    if (dl <= 7)  return '今週';
    if (dl <= 30) return '今月';
    return 'それ以降';
  };

  list.forEach(t => {
    if (useGroups) {
      const group = getGroup(t);
      if (group !== lastGroup) {
        const header = document.createElement('div');
        header.className = 'task-group-header';
        header.textContent = group;
        container.appendChild(header);
        lastGroup = group;
      }
    }
    const pct   = t.totalAmount > 0 ? clamp(Math.round(t.completedAmount/t.totalAmount*100),0,100) : 0;
    const dl    = daysLeft(t.deadline);
    const color = getSubjectColor(t.subject);
    const card  = document.createElement('div');
    card.className = 'task-card' + (t.status==='completed'?' completed':'');
    card.style.borderLeftColor = color;

    const repeatBadge = t.repeat !== 'none'
      ? `<span class="tag">🔁 ${repeatLabel(t.repeat, t.repeatDays)}</span>` : '';
    const dlBadge = t.deadline
      ? `<span class="tag${dl!==null&&dl<=3&&t.status!=='completed'?' deadline-near':''}">締切 ${fmtDate(t.deadline)}</span>` : '';
    const startBadge = t.startDate && t.startDate > today()
      ? `<span class="tag" style="color:var(--accent)">開始 ${fmtDate(t.startDate)}</span>` : '';

    card.innerHTML = `
      <div class="task-card-top">
        <button class="task-check" onclick="toggleTaskComplete('${t.id}')">${t.status==='completed'?'✓':''}</button>
        <div class="task-info">
          <div class="task-title-row">
            <span class="task-title">${esc(t.title)}</span>
            ${t.repeat !== 'none' ? '<span class="repeat-icon">🔁</span>' : ''}
          </div>
          <div class="task-meta">
            ${t.subject ? `<span class="tag" style="background:${color}22;color:${color}">${esc(t.subject)}</span>` : ''}
            <span class="tag priority-${t.priority}">${priorityLabel(t.priority)}</span>
            ${startBadge}
            ${dlBadge}
            <span class="tag">${t.completedAmount}/${t.totalAmount} ${esc(t.unit)}</span>
            ${repeatBadge}
          </div>
        </div>
        <div class="task-actions">
          <button class="btn-icon" onclick="openEditTask('${t.id}')" title="編集">✏️</button>
          <button class="btn-icon" onclick="confirmDelete('${t.id}')" title="削除">🗑️</button>
        </div>
      </div>
      <div class="task-progress" style="margin-top:10px">
        <div class="progress-bar-wrap">
          <div class="progress-bar" style="width:${pct}%;background:linear-gradient(90deg,${color},${color}bb)"></div>
        </div>
      </div>`;
    container.appendChild(card);
  });
};

function repeatLabel(repeat, repeatDays) {
  if (repeat==='daily')   return '毎日';
  if (repeat==='weekly')  return '毎週';
  if (repeat==='monthly') return '毎月';
  if (repeat==='custom')  return (repeatDays||[]).map(d => DOW_JA[d]).join('・');
  return '';
}

window.confirmDelete = function(id) {
  if (confirm('このタスクを削除しますか？')) {
    deleteTask(id); renderPage(currentPage);
    showToast('🗑️ 削除しました');
  }
};

// ─── タスク追加/編集モーダル ─────────────────────────────────
// 曜日ピッカーを JS で管理（:has() に依存しない）
let _selectedDows = new Set();

function buildDowPicker() {
  const container = $('dow-picker');
  if (!container) return;
  container.innerHTML = '';
  DOW_JA.forEach((label, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = 'dow-btn' + (_selectedDows.has(i) ? ' active' : '');
    btn.dataset.dow = i;
    btn.addEventListener('click', () => {
      if (_selectedDows.has(i)) { _selectedDows.delete(i); btn.classList.remove('active'); }
      else { _selectedDows.add(i); btn.classList.add('active'); }
    });
    container.appendChild(btn);
  });
}

window.openAddTask = function() {
  $('modal-title').textContent = 'タスクを追加';
  $('edit-task-id').value = '';
  clearTaskForm();
  $('f-startdate').value = today();
  const d = new Date(); d.setDate(d.getDate() + 7);
  $('f-deadline').value = d.toISOString().slice(0,10);
  const endD = new Date(); endD.setMonth(endD.getMonth() + 1);
  $('f-repeat-end').value = endD.toISOString().slice(0,10);
  updateSubjectDatalist();
  $('task-modal').classList.remove('hidden');
  setTimeout(() => $('f-title')?.focus(), 60);
  updateSplitPreview();
};

window.openEditTask = function(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  $('modal-title').textContent = 'タスクを編集';
  $('edit-task-id').value = id;
  $('f-title').value      = t.title;
  $('f-subject').value    = t.subject;
  $('f-priority').value   = t.priority;
  $('f-total').value      = t.totalAmount;
  $('f-unit').value       = t.unit;
  $('f-startdate').value  = t.startDate || today();
  $('f-deadline').value   = t.deadline;
  $('f-memo').value       = t.memo;
  $('f-repeat').value     = t.repeat || 'none';
  $('f-repeat-end').value = t.repeatEnd || '';
  _selectedDows = new Set((t.repeatDays || []).map(Number));
  onRepeatChange();
  onSubjectInput();
  updateSubjectDatalist();
  $('task-modal').classList.remove('hidden');
  updateSplitPreview();
};

window.closeModal     = () => $('task-modal').classList.add('hidden');
window.closeModalOnBg = e  => { if (e.target.id === 'task-modal') closeModal(); };

function clearTaskForm() {
  ['f-title','f-subject','f-total','f-unit','f-startdate','f-deadline','f-memo','f-repeat-end']
    .forEach(id => { const el=$(id); if(el) el.value=''; });
  $('f-priority').value = 'medium';
  $('f-repeat').value   = 'none';
  _selectedDows = new Set();
  onRepeatChange();
  if ($('f-subject-dot')) $('f-subject-dot').style.background = 'var(--border)';
}

window.onRepeatChange = function() {
  const val = $('f-repeat').value;
  $('repeat-days-wrap').classList.toggle('hidden', val !== 'custom');
  $('repeat-end-wrap').classList.toggle('hidden', val === 'none');
  if (val === 'custom') buildDowPicker();
  updateSplitPreview();
};

window.onSubjectInput = function() {
  const name  = $('f-subject').value.trim();
  const color = name ? getSubjectColor(name) : 'var(--border)';
  if ($('f-subject-dot')) $('f-subject-dot').style.background = color;
};

function updateSubjectDatalist() {
  const dl = $('subject-datalist');
  if (!dl) return;
  const subjects = [...new Set([
    ...tasks.map(t => t.subject).filter(Boolean),
    ...Object.keys(subjectMap),
  ])];
  dl.innerHTML = subjects.map(s => `<option value="${esc(s)}">`).join('');
}

window.saveTask = function() {
  const title    = $('f-title').value.trim();
  const total    = Number($('f-total').value);
  const repeat   = $('f-repeat').value;
  const deadline = $('f-deadline').value;

  if (!title) { shakeInput('f-title'); return; }
  if (!total) { shakeInput('f-total'); return; }
  if (!deadline && repeat === 'none') { shakeInput('f-deadline'); return; }

  const data = {
    title,
    subject:     $('f-subject').value.trim(),
    priority:    $('f-priority').value,
    totalAmount: total,
    unit:        $('f-unit').value.trim(),
    startDate:   $('f-startdate').value || today(),
    deadline:    deadline || addDays(today(), 365),
    memo:        $('f-memo').value.trim(),
    repeat,
    repeatDays:  [..._selectedDows].sort(),
    repeatEnd:   $('f-repeat-end').value,
  };

  const editId = $('edit-task-id').value;
  if (editId) { updateTask(editId, data); showToast('✏️ タスクを更新しました'); }
  else        { addTask(data);            showToast('✅ タスクを追加しました'); }

  closeModal();
  renderPage(currentPage);
  renderToday();
};

// 分割プレビュー
function updateSplitPreview() {
  const total     = Number($('f-total')?.value);
  const startDate = $('f-startdate')?.value || today();
  const deadline  = $('f-deadline')?.value;
  const unit      = $('f-unit')?.value.trim() ?? '';
  const repeat    = $('f-repeat')?.value ?? 'none';
  const preview   = $('split-preview');
  if (!preview) return;

  if (repeat !== 'none') {
    preview.classList.add('show');
    preview.innerHTML = `<div class="split-title">🔁 繰り返しタスク</div>毎回 <b>${total||'?'} ${esc(unit)}</b> を実行します`;
    return;
  }
  if (!total || !deadline) { preview.classList.remove('show'); return; }

  const effectiveStart = startDate > today() ? startDate : today();
  const spanDays = Math.max(1,
    Math.ceil((new Date(deadline+'T00:00:00') - new Date(effectiveStart+'T00:00:00')) / 86400000) + 1
  );
  const base  = Math.floor(total / spanDays);
  const extra = total % spanDays;

  // 開始日が未来の場合は表示
  const startLabel = startDate > today()
    ? `<span style="color:var(--accent);font-size:12px">開始: ${fmtDate(startDate)} → 締切: ${fmtDate(deadline)}</span>`
    : `<span style="color:var(--sub);font-size:12px">今日から締切まで</span>`;

  const chips = Array.from({length:Math.min(spanDays,7)}, (_,i) =>
    `<span class="split-chip">${base+(i<extra?1:0)} ${esc(unit)}</span>`).join('');
  const more  = spanDays > 7 ? `<span class="split-chip">…他 ${spanDays-7} 日</span>` : '';

  preview.classList.add('show');
  preview.innerHTML = `
    <div class="split-title">📅 自動分割プレビュー（${spanDays}日間）${startLabel}</div>
    <div class="split-chips">${chips+more}</div>`;
}

['f-total','f-startdate','f-deadline','f-unit','f-repeat'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('input', updateSplitPreview);
});

function shakeInput(id) {
  const el = $(id); if (!el) return;
  el.style.borderColor = 'var(--red)'; el.focus();
  setTimeout(() => el.style.borderColor = '', 1500);
}

// ─── カレンダー / 時間割 メイン切替 ─────────────────────────
let _calMain = 'calendar'; // 'calendar' | 'timetable'

window.setCalMain = function(main, btn) {
  _calMain = main;
  document.querySelectorAll('.cal-main-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const calSec = document.getElementById('calendar-section');
  const ttSec  = document.getElementById('timetable-section');
  if (main === 'timetable') {
    calSec?.classList.add('hidden');
    ttSec?.classList.remove('hidden');
    renderTimetable();
  } else {
    calSec?.classList.remove('hidden');
    ttSec?.classList.add('hidden');
    renderCalendar();
  }
};

// ─── カレンダー ──────────────────────────────────────────────
let calCursor = new Date();
let calView   = 'month';

window.setCalView = function(view, btn) {
  calView = view;
  document.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCalendar();
};
window.calNav = function(dir) {
  if (calView === 'month') calCursor.setMonth(calCursor.getMonth() + dir);
  if (calView === 'week')  calCursor.setDate(calCursor.getDate() + dir*7);
  if (calView === 'day')   calCursor.setDate(calCursor.getDate() + dir);
  renderCalendar();
};
window.calSelectDay = function(dateStr) {
  calCursor = new Date(dateStr + 'T00:00:00');
  setCalView('day', document.querySelector('[data-view="day"]'));
};

function renderCalendar() {
  const body = $('calendar-body'), title = $('cal-title');
  if (!body) return;
  if (calView === 'month') renderMonthCal(body, title);
  if (calView === 'week')  renderWeekCal(body, title);
  if (calView === 'day')   renderDayCal(body, title);
}

function renderMonthCal(body, title) {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  title.textContent = `${y}年 ${m+1}月`;
  const first = new Date(y, m, 1), last = new Date(y, m+1, 0);
  const todayStr = today();
  let html = '<div class="cal-month-grid">';
  DOW_JA.forEach(d => { html += `<div class="cal-weekday">${d}</div>`; });
  for (let i = 0; i < first.getDay(); i++) html += '<div class="cal-day other-month"></div>';
  for (let d = 1; d <= last.getDate(); d++) {
    const dateStr = `${y}-${m2(m+1)}-${m2(d)}`;
    const isToday = dateStr === todayStr;
    const entries = daily.filter(e => e.date === dateStr);
    const dots    = entries.slice(0,4).map(e => {
      const t = tasks.find(t => t.id === e.taskId);
      return `<span class="cal-dot${e.status==='completed'?' done':''}" style="background:${getSubjectColor(t?.subject)}"></span>`;
    }).join('');
    html += `<div class="cal-day${isToday?' today':''}" onclick="calSelectDay('${dateStr}')">
      <span class="cal-day-num">${d}</span>
      ${dots ? `<div class="cal-dot-row">${dots}</div>` : ''}
    </div>`;
  }
  html += '</div>';
  body.innerHTML = html;
}

function renderWeekCal(body, title) {
  const dow    = calCursor.getDay();
  const sunday = new Date(calCursor); sunday.setDate(sunday.getDate() - dow);
  const saturday = new Date(sunday); saturday.setDate(saturday.getDate() + 6);
  title.textContent = `${fmtDate(sunday.toISOString().slice(0,10))} 〜 ${fmtDate(saturday.toISOString().slice(0,10))}`;
  const todayStr = today();
  body.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'cal-day-list';

  for (let i = 0; i < 7; i++) {
    const d       = new Date(sunday); d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().slice(0,10);
    const isToday = dateStr === todayStr;
    const entries = daily.filter(e => e.date === dateStr);
    const dowStr  = DOW_JA[d.getDay()];

    const row = document.createElement('div');
    row.className = 'cal-day-row';

    const label = document.createElement('div');
    label.className = 'cal-day-label' + (isToday ? ' today-label' : '');
    label.innerHTML = `${m2(d.getMonth()+1)}/${m2(d.getDate())}<br>${dowStr}`;
    row.appendChild(label);

    const tasksCol = document.createElement('div');
    tasksCol.className = 'cal-day-tasks cal-drop-zone';
    tasksCol.dataset.date = dateStr;

    if (entries.length === 0) {
      tasksCol.innerHTML = '<div class="cal-no-task" style="color:var(--sub);font-size:12px;padding:4px 0">予定なし</div>';
    } else {
      entries.forEach(e => {
        const t = tasks.find(t => t.id === e.taskId);
        const pill = document.createElement('div');
        pill.className = 'cal-task-pill' + (e.status==='completed'?' done':'');
        pill.style.borderLeftColor = getSubjectColor(t?.subject);
        pill.draggable = true;
        pill.dataset.dailyId = e.id;
        pill.innerHTML = `<span class="cal-pill-title">${esc(t?.title ?? '')}</span> <span style="color:var(--sub)">${e.plannedAmount} ${esc(t?.unit ?? '')}</span>`;
        // ドラッグ開始
        pill.addEventListener('dragstart', ev => {
          ev.dataTransfer.setData('text/plain', e.id);
          ev.dataTransfer.effectAllowed = 'move';
          pill.style.opacity = '0.4';
        });
        pill.addEventListener('dragend', () => { pill.style.opacity = ''; });
        tasksCol.appendChild(pill);
      });
    }

    // ドロップゾーン
    tasksCol.addEventListener('dragover', ev => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      tasksCol.classList.add('cal-drop-active');
    });
    tasksCol.addEventListener('dragleave', () => tasksCol.classList.remove('cal-drop-active'));
    tasksCol.addEventListener('drop', ev => {
      ev.preventDefault();
      tasksCol.classList.remove('cal-drop-active');
      const dailyId  = ev.dataTransfer.getData('text/plain');
      const targetDate = tasksCol.dataset.date;
      moveDailyEntry(dailyId, targetDate);
    });

    row.appendChild(tasksCol);
    list.appendChild(row);
  }

  body.appendChild(list);
}

function renderDayCal(body, title) {
  const dateStr = calCursor.toISOString().slice(0,10);
  const dowStr  = DOW_JA[calCursor.getDay()];
  title.textContent = `${calCursor.getFullYear()}年${calCursor.getMonth()+1}月${calCursor.getDate()}日（${dowStr}）`;
  const entries = daily.filter(e => e.date === dateStr);
  body.innerHTML = '';

  // 日ビューは前後の日へのドロップエリア
  const navRow = document.createElement('div');
  navRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';

  [-1, 1].forEach(dir => {
    const targetDate = addDays(dateStr, dir);
    const zone = document.createElement('div');
    zone.className = 'cal-day-nav-drop';
    zone.textContent = dir === -1 ? `← ${fmtDate(targetDate)} に移動` : `${fmtDate(targetDate)} に移動 →`;
    zone.dataset.date = targetDate;
    zone.addEventListener('dragover', ev => { ev.preventDefault(); zone.classList.add('cal-drop-active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('cal-drop-active'));
    zone.addEventListener('drop', ev => {
      ev.preventDefault();
      zone.classList.remove('cal-drop-active');
      moveDailyEntry(ev.dataTransfer.getData('text/plain'), targetDate);
    });
    navRow.appendChild(zone);
  });
  body.appendChild(navRow);

  const list = document.createElement('div');
  list.className = 'cal-day-list';

  if (entries.length === 0) {
    list.innerHTML = '<p style="color:var(--sub);font-size:14px;padding:20px 0">この日の予定はありません</p>';
  } else {
    entries.forEach(e => {
      const t = tasks.find(t => t.id === e.taskId);
      const pill = document.createElement('div');
      pill.className = 'cal-task-pill' + (e.status==='completed'?' done':'');
      pill.style.borderLeftColor = getSubjectColor(t?.subject);
      pill.draggable = true;
      pill.dataset.dailyId = e.id;
      pill.innerHTML = `
        <div style="font-weight:600;display:flex;align-items:center;gap:6px">
          <span class="cal-drag-handle" title="ドラッグして移動">⠿</span>
          ${esc(t?.title ?? '')}
        </div>
        <div style="font-size:12px;color:var(--sub);margin-top:2px">
          ${e.plannedAmount} ${esc(t?.unit ?? '')}
          ${t?.subject ? '— ' + esc(t.subject) : ''}
        </div>`;
      pill.addEventListener('dragstart', ev => {
        ev.dataTransfer.setData('text/plain', e.id);
        ev.dataTransfer.effectAllowed = 'move';
        pill.style.opacity = '0.4';
      });
      pill.addEventListener('dragend', () => { pill.style.opacity = ''; });
      list.appendChild(pill);
    });
  }
  body.appendChild(list);
}

// ─── カレンダー ドラッグ＆ドロップ ───────────────────────────
function moveDailyEntry(dailyId, targetDate) {
  const entry = daily.find(d => d.id === dailyId);
  if (!entry || entry.date === targetDate) return;
  const fromDate = entry.date;
  entry.date = targetDate;
  // 完了済みエントリは未完了に戻す（日付変更で再挑戦扱い）
  if (entry.status === 'completed') {
    entry.status = 'pending';
    entry.completedAmount = 0;
  }
  saveDaily();
  recordStats();
  renderCalendar();
  renderToday();
  showToast(`📅 ${fmtDate(fromDate)} → ${fmtDate(targetDate)} に移動しました`);
}

// ─── 時間割 ──────────────────────────────────────────────────
const PERIODS   = ['1限','2限','3限','4限','5限','6限'];
let   ttRange   = 'weekday';  // 'weekday' | 'all'
const WEEK_COLS = { weekday:[1,2,3,4,5], all:[0,1,2,3,4,5,6] }; // 0=日

window.setTTRange = function(range, btn) {
  ttRange = range;
  document.querySelectorAll('.tt-controls .cal-view-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderTimetable();
};

function renderTimetable() {
  const body = $('timetable-body');
  if (!body) return;

  const todayStr = today();
  const todayDow = new Date(todayStr + 'T00:00:00').getDay();
  const cols     = WEEK_COLS[ttRange];
  const colCount = cols.length;

  // ヘッダー
  const headerCols = cols.map(dow => {
    const isToday = dow === todayDow;
    return `<div class="tt-head-cell${isToday?' today-col':''}">${DOW_JA[dow]}</div>`;
  }).join('');

  // グリッド行
  const bodyRows = PERIODS.map((period, pi) => {
    const cells = cols.map(dow => {
      const key    = `${dow}-${pi}`;
      const cell   = timetable[key];
      const isToday = dow === todayDow;
      if (cell?.subject) {
        const color = getSubjectColor(cell.subject);
        return `<div class="tt-cell filled${isToday?' today-col-cell':''}" style="border-left-color:${color}" onclick="openTTModal('${key}')">
          <div class="tt-subj" style="color:${color}">${esc(cell.subject)}</div>
          ${cell.room ? `<div class="tt-room">${esc(cell.room)}</div>` : ''}
        </div>`;
      }
      return `<div class="tt-cell empty${isToday?' today-col-cell':''}" onclick="openTTModal('${key}')">＋</div>`;
    }).join('');
    return `<div class="tt-body-row" style="display:grid;grid-template-columns:36px repeat(${colCount},1fr);gap:2px;padding:0 4px">
      <div class="tt-period-cell">${period}</div>${cells}
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="timetable-wrap">
      <div class="tt-header-row" style="display:grid;grid-template-columns:36px repeat(${colCount},1fr);gap:2px">
        <div></div>${headerCols}
      </div>
      ${bodyRows}
    </div>`;

  // 今日の授業サマリー
  renderTodayClasses(todayDow);
  renderTTLegend();
}

function renderTodayClasses(todayDow) {
  const container = $('tt-today-classes');
  if (!container) return;

  const todayClasses = PERIODS.map((period, pi) => {
    const key  = `${todayDow}-${pi}`;
    const cell = timetable[key];
    return cell?.subject ? { period, ...cell, pi } : null;
  }).filter(Boolean);

  if (todayClasses.length === 0) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="tt-today-title">今日の授業</div>
    <div class="tt-today-list">
      ${todayClasses.map(c => {
        const color = getSubjectColor(c.subject);
        return `<div class="tt-today-pill" style="border-left-color:${color}">
          <span class="tt-today-period">${c.pi+1}限</span>
          <span class="tt-today-subj" style="color:${color}">${esc(c.subject)}</span>
          ${c.room ? `<span class="tt-today-room">${esc(c.room)}</span>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function renderTTLegend() {
  const legend = $('tt-legend');
  if (!legend) return;
  const subjects = new Set();
  Object.values(timetable).forEach(c => { if (c?.subject) subjects.add(c.subject); });
  legend.innerHTML = [...subjects].map(s => `
    <div class="tt-legend-item">
      <div class="tt-legend-dot" style="background:${getSubjectColor(s)}"></div>${esc(s)}
    </div>`).join('');
}

// 時間割セルモーダル
window.openTTModal = function(key) {
  const [dow, pi] = key.split('-');
  const cell = timetable[key] || {};
  $('tt-cell-key').value   = key;
  $('tt-subject').value    = cell.subject || '';
  $('tt-room').value       = cell.room    || '';
  $('tt-modal-title').textContent = `${DOW_JA[dow]} ${PERIODS[pi]}`;
  onTTSubjectInput();
  $('tt-modal').classList.remove('hidden');
  setTimeout(() => $('tt-subject')?.focus(), 60);
};
window.closeTTModal     = () => $('tt-modal').classList.add('hidden');
window.closeTTModalOnBg = e  => { if (e.target.id === 'tt-modal') closeTTModal(); };
window.onTTSubjectInput = function() {
  const name  = $('tt-subject').value.trim();
  const color = name ? getSubjectColor(name) : 'var(--border)';
  if ($('tt-subject-dot')) $('tt-subject-dot').style.background = color;
};
window.saveTTCell = function() {
  const key     = $('tt-cell-key').value;
  const subject = $('tt-subject').value.trim();
  const room    = $('tt-room').value.trim();
  if (subject) { timetable[key] = { subject, room }; getSubjectColor(subject); }
  else         { delete timetable[key]; }
  saveTimetable(); closeTTModal(); renderTimetable();
  showToast('🗓️ 時間割を更新しました');
};
window.deleteTTCell = function() {
  delete timetable[$('tt-cell-key').value];
  saveTimetable(); closeTTModal(); renderTimetable();
  showToast('🗑️ 削除しました');
};

// ─── 統計 ────────────────────────────────────────────────────
let statPeriod = 'today';

window.setStatPeriod = function(period, btn) {
  statPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
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
  const rate     = total > 0 ? Math.round(done/total*100) : 0;
  const studyAmt = entries.reduce((s,d) => s + d.completedAmount, 0);
  const streak   = calcStreak();

  $('stats-grid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${rate}<span style="font-size:20px">%</span></div><div class="stat-label">達成率</div></div>
    <div class="stat-card"><div class="stat-value green">${done}</div><div class="stat-label">完了</div></div>
    <div class="stat-card"><div class="stat-value yellow">${pending}</div><div class="stat-label">未完了</div></div>
    <div class="stat-card"><div class="stat-value">${studyAmt}</div><div class="stat-label">学習量合計</div></div>`;

  renderBarChart();
  renderSubjectChart(entries);
}

function renderBarChart() {
  const todayStr = today(), statsArr = load(KEYS.stats) || [];
  const chart = $('bar-chart'); chart.innerHTML = '';
  for (let i = 6; i >= 0; i--) {
    const date    = addDays(todayStr, -i);
    const rec     = statsArr.find(s => s.date === date);
    const rate    = rec ? rec.completionRate : 0;
    const dowStr  = DOW_JA[new Date(date + 'T00:00:00').getDay()];
    const col     = document.createElement('div');
    col.className = 'bar-col';
    const isToday = date === todayStr;
    col.innerHTML = `
      <div class="bar-fill" style="height:${rate}%;${isToday?'background:linear-gradient(0deg,var(--green),var(--accent))':''}"></div>
      <div class="bar-day-label" style="${isToday?'color:var(--accent);font-weight:700':''}">
        ${dowStr}
      </div>`;
    chart.appendChild(col);
  }
}

function renderSubjectChart(entries) {
  const container = $('subject-chart');
  if (!container) return;
  const bySubj = {};
  entries.forEach(e => {
    const t    = tasks.find(t => t.id === e.taskId);
    const subj = t?.subject || 'その他';
    if (!bySubj[subj]) bySubj[subj] = { done:0, planned:0 };
    bySubj[subj].done    += e.completedAmount;
    bySubj[subj].planned += e.plannedAmount;
  });
  const keys = Object.keys(bySubj).sort((a,b) => bySubj[b].done - bySubj[a].done);
  if (keys.length === 0) {
    container.innerHTML = '<p style="color:var(--sub);font-size:13px">データがありません</p>';
    return;
  }
  const maxDone = Math.max(...keys.map(k => bySubj[k].done), 1);
  container.innerHTML = keys.map(k => {
    const color = getSubjectColor(k);
    const pct   = Math.round(bySubj[k].done / maxDone * 100);
    return `<div class="sj-row">
      <div class="sj-label" style="color:${color}">${esc(k)}</div>
      <div class="sj-track"><div class="sj-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="sj-count">${bySubj[k].done}</div>
    </div>`;
  }).join('');
}

// ─── 設定 ────────────────────────────────────────────────────
function renderSettings() {
  const themeToggle = $('theme-toggle'), notifToggle = $('notif-toggle');
  if (!themeToggle) return;
  const isDark = settings.theme === 'dark';
  themeToggle.checked = !isDark;
  $('theme-label').textContent = isDark ? 'ダーク' : 'ライト';
  notifToggle.checked = settings.notif;
  $('notif-label').textContent = settings.notif ? 'オン' : 'オフ';
  // 通知時刻行の表示切替
  const notifRows = ['notif-time-row','notif-deadline-row'];
  notifRows.forEach(id => {
    const el = $(id);
    if (el) el.style.display = settings.notif ? '' : 'none';
  });
  if ($('notif-time'))  $('notif-time').value = settings.notifTime || '08:00';
  const dlToggle = $('notif-deadline-toggle');
  if (dlToggle) {
    dlToggle.checked = !!settings.notifDeadline;
    const lbl = $('notif-deadline-label');
    if (lbl) lbl.textContent = settings.notifDeadline ? 'オン' : 'オフ';
  }
  renderSubjectColorList();
  updateArchiveCount();
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
      ['notif-time-row','notif-deadline-row'].forEach(id => {
        const el=$(id); if(el) el.style.display = settings.notif ? '' : 'none';
      });
    });
  } else {
    settings.notif = false;
    $('notif-label').textContent = 'オフ';
    save(KEYS.settings, settings);
    ['notif-time-row','notif-deadline-row'].forEach(id => {
      const el=$(id); if(el) el.style.display='none';
    });
  }
};

window.saveNotifTime = function() {
  settings.notifTime = $('notif-time')?.value || '08:00';
  save(KEYS.settings, settings);
  showToast(`🔔 朝 ${settings.notifTime} に通知します`);
};

window.saveNotifDeadline = function() {
  settings.notifDeadline = !!$('notif-deadline-toggle')?.checked;
  const lbl = $('notif-deadline-label');
  if (lbl) lbl.textContent = settings.notifDeadline ? 'オン' : 'オフ';
  save(KEYS.settings, settings);
};

// 科目カラーリスト（設定ページ内）
function renderSubjectColorList() {
  const list = $('subject-color-list');
  if (!list) return;
  const keys = Object.keys(subjectMap);
  if (keys.length === 0) {
    list.innerHTML = '<div class="setting-item" style="color:var(--sub);font-size:13px">まだ科目がありません</div>';
    return;
  }
  list.innerHTML = keys.map((k,i) => `
    <div class="setting-item${i===keys.length-1?' setting-item--last':''}">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:14px;height:14px;border-radius:50%;background:${subjectMap[k]};flex-shrink:0"></div>
        <span style="font-weight:600">${esc(k)}</span>
      </div>
      <button class="btn-icon" onclick="removeSubjectColor('${esc(k)}')" title="削除">✕</button>
    </div>`).join('');
}

window.removeSubjectColor = function(name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  delete subjectMap[name]; saveSubjects();
  renderSubjectColorList();
  showToast('🗑️ 科目を削除しました');
};

// 科目カラーモーダル
window.openSubjectColorModal = function() {
  renderSubjectColorEditor();
  $('subject-color-modal').classList.remove('hidden');
};
window.closeSubjectColorModal    = () => { $('subject-color-modal').classList.add('hidden'); renderSettings(); };
window.closeSubjectColorModalOnBg= e  => { if (e.target.id === 'subject-color-modal') closeSubjectColorModal(); };

function renderSubjectColorEditor() {
  const editor = $('subject-color-editor');
  if (!editor) return;
  const keys = Object.keys(subjectMap);
  if (keys.length === 0) {
    editor.innerHTML = '<p style="color:var(--sub);font-size:13px">科目がありません。下から追加してください。</p>';
    return;
  }
  editor.innerHTML = keys.map(k => `
    <div class="sce-row">
      <div class="sce-swatch" id="swatch-${esc(k)}" style="background:${subjectMap[k]}"></div>
      <span class="sce-name">${esc(k)}</span>
      <input type="color" class="sce-color" value="${subjectMap[k]}" onchange="updateSubjectColorVal('${esc(k)}',this.value)">
      <span class="sce-del" onclick="removeSubjectColorFromEditor('${esc(k)}')">✕</span>
    </div>`).join('');
}

window.updateSubjectColorVal = function(name, color) {
  subjectMap[name] = color; saveSubjects();
  const sw = document.getElementById('swatch-' + name);
  if (sw) sw.style.background = color;
};
window.removeSubjectColorFromEditor = function(name) {
  delete subjectMap[name]; saveSubjects(); renderSubjectColorEditor();
};
window.addSubjectColor = function() {
  const name  = $('new-subject-name').value.trim();
  const color = $('new-subject-color').value;
  if (!name) { shakeInput('new-subject-name'); return; }
  subjectMap[name] = color; saveSubjects();
  $('new-subject-name').value = '';
  renderSubjectColorEditor();
  updateSubjectDatalist();
  showToast(`✅ ${name} を追加しました`);
};

// ─── データ管理 ──────────────────────────────────────────────
window.exportData = function() {
  const data = { tasks, daily, timetable, subjects:subjectMap, stats:load(KEYS.stats)||[], archive, version:2 };
  const blob  = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a     = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `studyflow-${today()}.json`;
  a.click();
  showToast('📤 エクスポートしました');
};

window.importData = function(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data.tasks)     { tasks      = data.tasks;      save(KEYS.tasks,     tasks); }
      if (data.daily)     { daily      = data.daily;      save(KEYS.daily,     daily); }
      if (data.timetable) { timetable  = data.timetable;  save(KEYS.timetable, timetable); }
      if (data.subjects)  { subjectMap = data.subjects;   save(KEYS.subjects,  subjectMap); }
      if (data.archive)   { archive    = data.archive;    save(KEYS.archive,   archive); }
      if (data.stats)     save(KEYS.stats, data.stats);
      renderPage(currentPage); renderToday();
      showToast('📥 インポートしました');
    } catch { showToast('❌ ファイルの形式が正しくありません'); }
  };
  reader.readAsText(file);
  e.target.value = ''; // 同じファイルを再読み込み可能に
};

window.clearAllData = function() {
  if (!confirm('すべてのデータを削除します。この操作は取り消せません。')) return;
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  tasks = []; daily = []; timetable = {}; subjectMap = {}; archive = [];
  renderToday(); renderPage(currentPage);
  showToast('🗑️ データを削除しました');
};

// ─── 通知 ────────────────────────────────────────────────────
function scheduleNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const todayStr = today();
  const todayEntries = daily.filter(d => d.date===todayStr && d.status!=='completed');

  // 時刻ベースの通知チェック
  const now      = new Date();
  const [hh, mm] = (settings.notifTime || '08:00').split(':').map(Number);
  const target   = new Date(); target.setHours(hh, mm, 0, 0);
  const diff     = target - now;

  // まだ今日の通知時刻を過ぎていなければ予約
  if (diff > 0 && diff < 86400000) {
    setTimeout(() => {
      if (Notification.permission === 'granted' && today() === todayStr) {
        const pending = daily.filter(d => d.date===todayStr && d.status!=='completed');
        if (pending.length > 0) {
          new Notification('📚 StudyFlow おはようございます', {
            body: `今日のタスクが ${pending.length} 件あります。頑張りましょう！`,
            icon: './icon-192.png',
          });
        }
      }
    }, diff);
  } else if (todayEntries.length > 0 && Math.abs(diff) < 300000) {
    // 通知時刻から5分以内なら即送信
    new Notification('📚 StudyFlow おはようございます', {
      body: `今日のタスクが ${todayEntries.length} 件あります。`,
    });
  }

  // 締切前日通知
  if (settings.notifDeadline) {
    tasks.filter(t => t.status!=='completed' && daysLeft(t.deadline)===1).forEach(t => {
      new Notification('⚠️ StudyFlow — 締切間近！', {
        body: `「${t.title}」の締切は明日です。`,
      });
    });
  }
}

// 通知を毎分チェックして時刻ベースで発火
function startNotifScheduler() {
  if (!settings.notif) return;
  const check = () => {
    if (!settings.notif || Notification.permission !== 'granted') return;
    const now = new Date();
    const [hh, mm] = (settings.notifTime || '08:00').split(':').map(Number);
    if (now.getHours() === hh && now.getMinutes() === mm) {
      const todayStr    = today();
      const todayCount  = daily.filter(d => d.date===todayStr && d.status!=='completed').length;
      const lastNotif   = sessionStorage.getItem('sf_last_notif');
      if (todayCount > 0 && lastNotif !== todayStr) {
        new Notification('📚 StudyFlow おはようございます', {
          body: `今日のタスクが ${todayCount} 件あります。頑張りましょう！`,
        });
        sessionStorage.setItem('sf_last_notif', todayStr);
      }
    }
  };
  setInterval(check, 60000);
}

// ─── トースト ────────────────────────────────────────────────
let _toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}
window.showToast = showToast;

// ─── ServiceWorker 登録 (PWA) ────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// PWA インストールバナー
let _deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPrompt = e;
  // バナーを表示（既に非表示にされていなければ）
  if (!sessionStorage.getItem('pwa-dismissed')) showPWABanner();
});

function showPWABanner() {
  if (document.getElementById('pwa-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-banner';
  banner.className = 'pwa-banner';
  banner.innerHTML = `
    <div class="pwa-banner-text">
      <strong>📲 アプリとして追加</strong>
      ホーム画面に追加してオフラインでも使えます
    </div>
    <button class="btn-primary" style="white-space:nowrap;padding:8px 14px;font-size:13px" onclick="installPWA()">追加</button>
    <button class="pwa-banner-close" onclick="dismissPWABanner()">✕</button>`;
  document.body.appendChild(banner);
}

window.installPWA = async function() {
  if (!_deferredPrompt) return;
  _deferredPrompt.prompt();
  const { outcome } = await _deferredPrompt.userChoice;
  if (outcome === 'accepted') showToast('✅ ホーム画面に追加しました');
  _deferredPrompt = null;
  dismissPWABanner();
};

window.dismissPWABanner = function() {
  document.getElementById('pwa-banner')?.remove();
  sessionStorage.setItem('pwa-dismissed', '1');
};

// ============================================================
//  ① クイック入力（自然言語パース）
// ============================================================
let _quickParsed = null;

// パースルール
function parseQuickInput(text) {
  const t = text.trim();
  if (!t) return null;

  // 科目候補（登録済み科目に一致するものを抽出）
  const knownSubjects = [...new Set([
    ...tasks.map(t => t.subject).filter(Boolean),
    ...Object.keys(subjectMap),
  ])];
  let subject = '';
  for (const s of knownSubjects) {
    if (t.includes(s)) { subject = s; break; }
  }
  // 未登録でも「英語」「数学」「理科」「社会」「国語」「物理」「化学」「生物」「歴史」「地理」「英単語」等を検出
  if (!subject) {
    const m = t.match(/^(英語|英単語|数学|国語|理科|社会|物理|化学|生物|歴史|地理|情報|体育|音楽|美術|倫理|政経|現代文|古文|漢文)/);
    if (m) subject = m[1];
  }

  // 数量（数字+単位）
  const amountM = t.match(/(\d+)\s*(ページ|問|枚|個|回|行|字|単語|分|時間|項目|章|節|冊)/);
  const totalAmount = amountM ? parseInt(amountM[1]) : 1;
  const unit        = amountM ? amountM[2] : '';

  // 締切（曜日・「明日」「今日」「今週末」「来週〇曜」）
  let deadline = addDays(today(), 7); // デフォルト1週間後
  const td = today();
  if (/今日|本日/.test(t))   deadline = td;
  else if (/明日/.test(t))   deadline = addDays(td, 1);
  else if (/明後日/.test(t)) deadline = addDays(td, 2);
  else if (/今週末|土曜/.test(t)) {
    const dow = new Date(td+'T00:00:00').getDay();
    deadline  = addDays(td, (6 - dow + 7) % 7 || 7);
  } else if (/日曜/.test(t)) {
    const dow = new Date(td+'T00:00:00').getDay();
    deadline  = addDays(td, (0 - dow + 7) % 7 || 7);
  } else {
    // 「〇曜」→ 次のその曜日
    const dowMatch = t.match(/(月|火|水|木|金|土|日)曜/);
    if (dowMatch) {
      const dowMap = {月:1,火:2,水:3,木:4,金:5,土:6,日:0};
      const target = dowMap[dowMatch[1]];
      const cur    = new Date(td+'T00:00:00').getDay();
      const diff   = (target - cur + 7) % 7 || 7;
      deadline     = addDays(td, diff);
    }
    // 「〇日後」「〇週間後」
    const daysM = t.match(/(\d+)\s*日後/);
    if (daysM) deadline = addDays(td, parseInt(daysM[1]));
    const weeksM = t.match(/(\d+)\s*週間?後/);
    if (weeksM) deadline = addDays(td, parseInt(weeksM[1]) * 7);
    // 「〇月〇日」
    const dateM = t.match(/(\d{1,2})月(\d{1,2})日/);
    if (dateM) {
      const y = new Date().getFullYear();
      deadline = `${y}-${m2(dateM[1])}-${m2(dateM[2])}`;
    }
  }

  // 優先度
  let priority = 'medium';
  if (/高|重要|急ぎ|urgent|!{2,}/.test(t)) priority = 'high';
  else if (/低|余裕|いつでも/.test(t))      priority = 'low';

  // タイトル（科目・数量・締切・優先度キーワードを除いた残り）
  let title = t
    .replace(/(今日|明日|明後日|今週末|来週|今週|[月火水木金土日]曜日?|(\d+)日後|(\d+)週間?後|\d{1,2}月\d{1,2}日)/g, '')
    .replace(/(\d+)\s*(ページ|問|枚|個|回|行|字|単語|分|時間|項目|章|節|冊)/g, '')
    .replace(/(高|低|重要|急ぎ|余裕|いつでも)$/, '')
    .replace(/\s+/g, ' ').trim();
  if (!title) title = subject || 'タスク';

  return { title, subject, totalAmount, unit, deadline, priority };
}

window.onQuickInputKey = function(e) {
  if (e.key === 'Enter') { e.preventDefault(); submitQuickInput(); }
  else updateQuickPreview();
};

function updateQuickPreview() {
  const val     = $('quick-input')?.value ?? '';
  const preview = $('quick-preview');
  if (!preview) return;
  if (!val.trim()) { preview.classList.add('hidden'); return; }

  const parsed = parseQuickInput(val);
  if (!parsed) { preview.classList.add('hidden'); return; }

  const color = getSubjectColor(parsed.subject);
  preview.classList.remove('hidden');
  preview.innerHTML = `
    <div class="qp-row">
      <span class="qp-title">${esc(parsed.title)}</span>
      ${parsed.subject ? `<span class="tag" style="background:${color}22;color:${color}">${esc(parsed.subject)}</span>` : ''}
      <span class="tag priority-${parsed.priority}">${priorityLabel(parsed.priority)}</span>
      ${parsed.totalAmount > 1 ? `<span class="tag">${parsed.totalAmount}${esc(parsed.unit)}</span>` : ''}
      <span class="tag">締切 ${fmtDate(parsed.deadline)}</span>
      <span class="qp-hint">↵ で追加 / 確認してから追加</span>
    </div>`;
}

window.submitQuickInput = function() {
  const val = $('quick-input')?.value.trim() ?? '';
  if (!val) return;
  const parsed = parseQuickInput(val);
  if (!parsed) return;
  _quickParsed = parsed;

  // 確認モーダルを表示
  const color = getSubjectColor(parsed.subject);
  const body  = $('quick-confirm-body');
  if (body) {
    body.innerHTML = `
      <div class="qc-preview">
        <div class="qc-row"><span class="qc-lbl">タイトル</span><span class="qc-val">${esc(parsed.title)}</span></div>
        ${parsed.subject ? `<div class="qc-row"><span class="qc-lbl">科目</span><span class="qc-val" style="color:${color}">${esc(parsed.subject)}</span></div>` : ''}
        <div class="qc-row"><span class="qc-lbl">優先度</span><span class="qc-val">${priorityLabel(parsed.priority)}</span></div>
        <div class="qc-row"><span class="qc-lbl">量</span><span class="qc-val">${parsed.totalAmount} ${esc(parsed.unit)}</span></div>
        <div class="qc-row"><span class="qc-lbl">締切</span><span class="qc-val">${parsed.deadline}</span></div>
      </div>`;
  }
  $('quick-confirm-modal').classList.remove('hidden');
};

window.confirmQuickAdd = function() {
  if (!_quickParsed) return;
  addTask(_quickParsed);
  closeQuickConfirm();
  if ($('quick-input')) $('quick-input').value = '';
  if ($('quick-preview')) $('quick-preview').classList.add('hidden');
  renderToday(); renderPage(currentPage);
  showToast('⚡ タスクを追加しました');
};

window.editQuickTask = function() {
  if (!_quickParsed) return;
  closeQuickConfirm();
  openAddTask();
  // フォームに解析結果を流し込む
  setTimeout(() => {
    if ($('f-title'))    $('f-title').value    = _quickParsed.title;
    if ($('f-subject'))  $('f-subject').value  = _quickParsed.subject;
    if ($('f-priority')) $('f-priority').value = _quickParsed.priority;
    if ($('f-total'))    $('f-total').value    = _quickParsed.totalAmount;
    if ($('f-unit'))     $('f-unit').value     = _quickParsed.unit;
    if ($('f-deadline')) $('f-deadline').value = _quickParsed.deadline;
    onSubjectInput?.();
    updateSplitPreview?.();
  }, 60);
  if ($('quick-input')) $('quick-input').value = '';
};

window.closeQuickConfirm  = () => $('quick-confirm-modal')?.classList.add('hidden');
window.closeQuickConfirmOnBg = e => { if (e.target.id==='quick-confirm-modal') closeQuickConfirm(); };

// クイック入力のリアルタイムプレビュー
$('quick-input')?.addEventListener('input', updateQuickPreview);

// ============================================================
//  ② アーカイブ機能
// ============================================================

// 完了タスクを自動アーカイブ（完了から7日以上経過）
function autoArchiveOldTasks() {
  const cutoff  = addDays(today(), -7);
  const toMove  = tasks.filter(t =>
    t.status === 'completed' && t.updatedAt && t.updatedAt.slice(0,10) <= cutoff
  );
  if (toMove.length === 0) return;

  toMove.forEach(t => archive.unshift({ ...t, archivedAt: new Date().toISOString() }));
  tasks   = tasks.filter(t => !toMove.find(m => m.id === t.id));
  daily   = daily.filter(d => !toMove.find(m => m.id === d.taskId));
  saveTasks(); saveDaily(); saveArchive();
}

function updateArchiveCount() {
  const el = $('archive-count');
  if (el) el.textContent = archive.length > 0 ? archive.length : '';
}

let _taskTab = 'active';

window.switchTaskTab = function(tab, btn) {
  _taskTab = tab;
  document.querySelectorAll('.task-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  $('task-active-section')?.classList.toggle('hidden', tab !== 'active');
  $('task-archived-section')?.classList.toggle('hidden', tab !== 'archived');
  if (tab === 'active')   renderTaskList();
  if (tab === 'archived') renderArchivedList();
};

function renderArchivedList() {
  const container = $('archived-task-list');
  if (!container) return;
  if (archive.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🗄️</div><p>アーカイブにタスクはありません<br><span style="font-size:12px;color:var(--sub)">完了後7日で自動保管されます</span></p></div>`;
    return;
  }
  container.innerHTML = '';
  archive.forEach(t => {
    const color = getSubjectColor(t.subject);
    const card  = document.createElement('div');
    card.className = 'task-card completed';
    card.style.borderLeftColor = color;
    card.innerHTML = `
      <div class="task-card-top">
        <div class="task-check" style="background:var(--green);border-color:var(--green);color:#fff;display:flex;align-items:center;justify-content:center;border-radius:50%;width:22px;height:22px;font-size:12px">✓</div>
        <div class="task-info">
          <div class="task-title" style="text-decoration:line-through">${esc(t.title)}</div>
          <div class="task-meta" style="margin-top:4px">
            ${t.subject ? `<span class="tag" style="background:${color}22;color:${color}">${esc(t.subject)}</span>` : ''}
            <span class="tag">${t.completedAmount}/${t.totalAmount} ${esc(t.unit)}</span>
            <span class="tag" style="color:var(--sub)">${t.archivedAt?.slice(0,10) ?? ''} 保管</span>
          </div>
        </div>
        <div class="task-actions">
          <button class="btn-icon" onclick="restoreFromArchive('${t.id}')" title="復元">♻️</button>
          <button class="btn-icon" onclick="deleteFromArchive('${t.id}')" title="完全削除">🗑️</button>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

window.restoreFromArchive = function(id) {
  const t = archive.find(a => a.id === id);
  if (!t) return;
  const { archivedAt, ...taskData } = t;
  taskData.status = 'active';
  taskData.completedAmount = 0;
  taskData.updatedAt = new Date().toISOString();
  tasks.push(taskData);
  archive = archive.filter(a => a.id !== id);
  saveTasks(); saveArchive();
  generateDailyTasks(taskData);
  renderArchivedList(); updateArchiveCount();
  showToast('♻️ タスクを復元しました');
};

window.deleteFromArchive = function(id) {
  if (!confirm('完全に削除しますか？この操作は取り消せません。')) return;
  archive = archive.filter(a => a.id !== id);
  saveArchive(); renderArchivedList(); updateArchiveCount();
  showToast('🗑️ 完全削除しました');
};

window.clearArchive = function() {
  if (!confirm(`アーカイブの ${archive.length} 件をすべて完全削除しますか？`)) return;
  archive = []; saveArchive(); renderArchivedList(); updateArchiveCount();
  showToast('🗑️ アーカイブを削除しました');
};

// タスク完了時にアーカイブではなく即完了にする（7日待つ版に変更済みなので既存の toggleTaskComplete はそのまま）
// 手動アーカイブボタンも追加
window.manualArchive = function(id) {
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  archive.unshift({ ...t, archivedAt: new Date().toISOString() });
  tasks = tasks.filter(t => t.id !== id);
  daily = daily.filter(d => d.taskId !== id);
  saveTasks(); saveDaily(); saveArchive();
  renderPage(currentPage); updateArchiveCount();
  showToast('🗄️ アーカイブしました');
};

// ============================================================
//  ③ 集中モード
// ============================================================
let _focusIdx = 0;
let _focusEntries = [];

window.openFocusMode = function() {
  const todayStr = today();
  _focusEntries  = daily.filter(d => d.date === todayStr && d.status !== 'completed');
  if (_focusEntries.length === 0) {
    showToast('🎉 今日のタスクはすべて完了しています！'); return;
  }
  _focusIdx = 0;
  renderFocusCard();
  $('focus-overlay')?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

window.closeFocusMode = function() {
  $('focus-overlay')?.classList.add('hidden');
  document.body.style.overflow = '';
};

window.focusNav = function(dir) {
  _focusIdx = clamp(_focusIdx + dir, 0, _focusEntries.length - 1);
  renderFocusCard();
};

function renderFocusCard() {
  const wrap    = $('focus-task-wrap');
  const counter = $('focus-counter');
  const prevBtn = $('focus-prev');
  const nextBtn = $('focus-next');
  const progRow = $('focus-progress-row');
  if (!wrap) return;

  const entry = _focusEntries[_focusIdx];
  if (!entry) return;
  const task  = tasks.find(t => t.id === entry.taskId);
  if (!task)  return;

  const color  = getSubjectColor(task.subject);
  const p2     = entry.plannedAmount > 0
    ? clamp(Math.round(entry.completedAmount / entry.plannedAmount * 100), 0, 100) : 0;
  const dl     = daysLeft(task.deadline);

  if (counter) counter.textContent = `${_focusIdx + 1} / ${_focusEntries.length}`;
  if (prevBtn) prevBtn.disabled = _focusIdx === 0;
  if (nextBtn) nextBtn.disabled = _focusIdx === _focusEntries.length - 1;

  // 期間ラベルバッジ
  const todayStr    = today();

  wrap.innerHTML = `
    <div class="focus-card" style="border-top: 4px solid ${color}">
      <div class="focus-subject" style="color:${color}">${esc(task.subject || '　')}</div>
      <div class="focus-title">${esc(task.title)}</div>
      <div class="focus-meta">
        <span class="tag priority-${task.priority}">${priorityLabel(task.priority)}</span>
        ${task.deadline ? `<span class="tag${dl!==null&&dl<=1?' deadline-near':''}">締切 ${fmtDate(task.deadline)}（あと${dl??'?'}日）</span>` : ''}
      </div>
      ${task.memo ? `<div class="focus-memo">${esc(task.memo)}</div>` : ''}
      <div class="focus-progress-nums">
        <span>${entry.completedAmount} / ${entry.plannedAmount} ${esc(task.unit)}</span>
        <span style="font-size:28px;font-weight:800;color:${color}">${p2}%</span>
      </div>
      <div class="focus-bar-wrap">
        <div class="focus-bar" style="width:${p2}%;background:${color}"></div>
      </div>
      <div class="focus-actions">
        <button class="btn-primary" style="flex:2" onclick="focusOpenProgress('${entry.id}')">進捗を入力</button>
        <button class="btn-secondary" onclick="focusComplete('${entry.id}')">✓ 完了</button>
      </div>
    </div>`;

  // 全タスクのミニ進捗バー
  if (progRow) {
    progRow.innerHTML = _focusEntries.map((e, i) => {
      const t2  = tasks.find(t => t.id === e.taskId);
      const c2  = getSubjectColor(t2?.subject);
      const p   = e.plannedAmount > 0 ? clamp(Math.round(e.completedAmount/e.plannedAmount*100),0,100) : 0;
      return `<div class="focus-mini-task${i===_focusIdx?' active':''}" onclick="focusJump(${i})" title="${esc(t2?.title??'')}">
        <div class="focus-mini-bar" style="background:${c2};opacity:${i===_focusIdx?1:.4};width:${Math.max(p,8)}%"></div>
      </div>`;
    }).join('');
  }
}

window.focusJump = function(idx) {
  _focusIdx = idx; renderFocusCard();
};

window.focusOpenProgress = function(dailyId) {
  closeFocusMode();
  openProgressModal(dailyId);
};

window.focusComplete = function(dailyId) {
  toggleDailyDone(dailyId);
  // 完了した項目を除外して次へ
  _focusEntries = _focusEntries.filter(e => e.id !== dailyId);
  if (_focusEntries.length === 0) {
    closeFocusMode();
    showToast('🎉 すべて完了しました！素晴らしい！');
    return;
  }
  _focusIdx = clamp(_focusIdx, 0, _focusEntries.length - 1);
  renderFocusCard();
};

// ─── 初期化 ──────────────────────────────────────────────────
function init() {
  // テーマ適用
  document.documentElement.setAttribute('data-theme', settings.theme || 'dark');

  // 既存タスクの今日分 daily を補完
  const todayStr = today();
  tasks.forEach(t => {
    if (t.status !== 'completed' && !daily.some(d => d.taskId===t.id && d.date===todayStr)) {
      generateDailyTasks(t);
    }
  });

  // 古い daily エントリを 90 日以上前のものは削除（肥大化防止）
  const cutoff = addDays(todayStr, -90);
  daily = daily.filter(d => d.date >= cutoff);
  saveDaily();

  if (settings.notif) scheduleNotifications();
  startNotifScheduler();

  // 期限切れ完了タスクを自動アーカイブ（30日以上前）
  autoArchiveOldTasks();

  updateSubjectDatalist();
  renderToday();
  document.querySelector('.nav-btn[data-page="today"]')?.classList.add('active');
}

// ES Module は defer 相当なので DOM は必ず準備済み
init();
