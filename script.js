// ============================================================
// HYPER GOLF 予約システム - クライアントJS
// ============================================================

// ── ユーティリティ ──────────────────────────────────────────

function gasGet(gasUrl, params) {
  return new Promise((resolve, reject) => {
    const callbackName = 'cb_' + Math.random().toString(36).slice(2);
    const url = new URL(gasUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set('callback', callbackName);

    const script = document.createElement('script');
    script.src = url.toString();

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, 10000);

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    script.onerror = () => { cleanup(); reject(new Error('load error')); };
    document.head.appendChild(script);
  });
}

async function gasPost(gasUrl, body) {
  const res = await fetch(gasUrl, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  return res.json();
}

function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function showError(id, msg) { const el = document.getElementById(id); if (!el) return; el.textContent = msg; el.classList.remove('hidden'); }
function hideError(id) { document.getElementById(id)?.classList.add('hidden'); }

// ── 予約フォーム ────────────────────────────────────────────

function initReservation(gasUrl) {
  let selectedSlot = null;

  // 枠読み込み
  async function loadSlots() {
    try {
      const data = await gasGet(gasUrl, { action: 'getSlots' });
      if (data.error) throw new Error(data.error);
      renderSlots(data);
    } catch (e) {
      hide('slots-loading');
      showError('slots-error', '空き状況の取得に失敗しました。しばらく経ってから再読み込みしてください。');
    }
  }

  function renderSlots(slots) {
    hide('slots-loading');
    const grid = document.getElementById('slots-grid');
    if (!grid) return;

    if (slots.length === 0) {
      grid.innerHTML = '<p style="color:#666">現在予約可能な枠がありません。</p>';
      return;
    }

    // 日付ラベル
    const dateLabel = document.getElementById('event-date-label');
    if (dateLabel && slots[0]) {
      const d = new Date(slots[0].date);
      dateLabel.textContent = `📅 ${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${['日','月','火','水','木','金','土'][d.getDay()]}）`;
    }

    grid.innerHTML = '';
    slots.forEach(slot => {
      const btn = document.createElement('button');
      btn.className = 'slot-btn' + (slot.full ? ' full' : '');
      btn.disabled = slot.full;
      btn.innerHTML = `
        <div class="slot-time">${slot.time}</div>
        <div class="slot-avail">${slot.full ? '満員' : `残り${slot.available}名`}</div>
      `;
      if (!slot.full) {
        btn.addEventListener('click', () => selectSlot(slot, btn));
      }
      grid.appendChild(btn);
    });
  }

  function selectSlot(slot, btn) {
    selectedSlot = slot;
    document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    const info = document.getElementById('selected-slot-info');
    if (info) info.textContent = `選択中：${slot.date} ${slot.time}〜（残り${slot.available}名）`;

    hide('step-slots');
    show('step-form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 戻るボタン
  document.getElementById('btn-back')?.addEventListener('click', () => {
    hide('step-form');
    show('step-slots');
    hideError('form-error');
  });

  // 送信
  document.getElementById('btn-submit')?.addEventListener('click', async () => {
    hideError('form-error');
    const name = document.getElementById('name')?.value.trim();
    const phone = document.getElementById('phone')?.value.trim();
    const concern = document.getElementById('concern')?.value.trim();

    if (!name) { showError('form-error', 'お名前を入力してください。'); return; }
    if (!phone) { showError('form-error', '電話番号を入力してください。'); return; }
    if (!selectedSlot) { showError('form-error', '時間枠を選択してください。'); return; }

    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = '送信中…';

    try {
      const result = await gasPost(gasUrl, {
        action: 'reserve',
        date: selectedSlot.date,
        time: selectedSlot.time,
        name, phone, concern
      });

      if (result.success) {
        hide('step-form');
        show('step-done');
        const summary = document.getElementById('done-summary');
        if (summary) {
          summary.innerHTML = `
            <b>日時：</b>${selectedSlot.date} ${selectedSlot.time}〜<br>
            <b>お名前：</b>${escHtml(name)}<br>
            <b>電話番号：</b>${escHtml(phone)}
            ${concern ? `<br><b>お悩み：</b>${escHtml(concern)}` : ''}
          `;
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        showError('form-error', result.message || '予約に失敗しました。');
      }
    } catch (e) {
      showError('form-error', '通信エラーが発生しました。再度お試しください。');
    } finally {
      btn.disabled = false;
      btn.textContent = '予約を確定する';
    }
  });

  // 再予約
  document.getElementById('btn-restart')?.addEventListener('click', () => {
    selectedSlot = null;
    hide('step-done');
    hide('step-form');
    show('step-slots');
    document.getElementById('name').value = '';
    document.getElementById('phone').value = '';
    document.getElementById('concern').value = '';
    loadSlots();
  });

  loadSlots();
}

// ── 管理画面 ────────────────────────────────────────────────

function initAdmin(gasUrl) {
  let adminPassword = '';
  let allReservations = [];

  // ログイン
  document.getElementById('btn-login')?.addEventListener('click', async () => {
    const pw = document.getElementById('admin-password')?.value;
    hideError('login-error');

    try {
      const result = await gasGet(gasUrl, { action: 'getSettings', password: pw });
      if (!result.success) {
        showError('login-error', result.message || 'パスワードが違います。');
        return;
      }
      adminPassword = pw;
      hide('panel-login');
      show('admin-panel');

      // 設定値をフォームにセット
      const s = result.settings;
      if (s.event_date) document.getElementById('event-date').value = s.event_date;
      if (s.start_time) document.getElementById('start-time').value = s.start_time;
      if (s.end_time) document.getElementById('end-time').value = s.end_time;

      loadReservations();
    } catch (e) {
      showError('login-error', '通信エラーが発生しました。');
    }
  });

  // Enterキーでログイン
  document.getElementById('admin-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-login')?.click();
  });

  // 設定保存
  document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const msgEl = document.getElementById('settings-msg');
    msgEl?.classList.add('hidden');

    const result = await gasPost(gasUrl, {
      action: 'updateSettings',
      password: adminPassword,
      event_date: document.getElementById('event-date')?.value,
      start_time: document.getElementById('start-time')?.value,
      end_time: document.getElementById('end-time')?.value
    });

    if (msgEl) {
      msgEl.textContent = result.message || (result.success ? '保存しました。' : 'エラーが発生しました。');
      msgEl.className = result.success ? 'success-msg' : 'error-msg';
      msgEl.classList.remove('hidden');
      setTimeout(() => msgEl.classList.add('hidden'), 3000);
    }
  });

  // 予約一覧読み込み
  async function loadReservations() {
    show('reservations-loading');
    hide('reservations-table');
    hide('no-reservations');
    hideError('reservations-error');

    try {
      const result = await gasGet(gasUrl, { action: 'getReservations', password: adminPassword });
      hide('reservations-loading');

      if (!result.success) {
        showError('reservations-error', result.message || '取得失敗');
        return;
      }
      allReservations = result.reservations || [];
      renderReservations();
    } catch (e) {
      hide('reservations-loading');
      showError('reservations-error', '通信エラーが発生しました。');
    }
  }

  // フィルター
  document.getElementById('filter-status')?.addEventListener('change', renderReservations);

  function renderReservations() {
    const filter = document.getElementById('filter-status')?.value || 'all';
    const filtered = filter === 'all'
      ? allReservations
      : allReservations.filter(r => r.status === filter);

    const tbody = document.getElementById('reservations-tbody');
    if (!tbody) return;

    if (filtered.length === 0) {
      hide('reservations-table');
      show('no-reservations');
      return;
    }

    show('reservations-table');
    hide('no-reservations');

    tbody.innerHTML = '';
    // 日付・時間で昇順ソート
    const sorted = [...filtered].sort((a, b) => {
      const ka = `${a.date} ${a.time}`;
      const kb = `${b.date} ${b.time}`;
      return ka.localeCompare(kb);
    });

    sorted.forEach(r => {
      const tr = document.createElement('tr');
      if (r.status === 'cancelled') tr.classList.add('cancelled');
      tr.innerHTML = `
        <td>${escHtml(String(r.date))}</td>
        <td>${escHtml(String(r.time))}</td>
        <td>${escHtml(r.name)}</td>
        <td>${escHtml(r.phone)}</td>
        <td style="max-width:160px;word-break:break-all">${escHtml(r.concern || '—')}</td>
        <td><span class="badge-${r.status}">${r.status === 'confirmed' ? '確定' : 'キャンセル'}</span></td>
        <td>${r.status === 'confirmed'
          ? `<button class="btn btn-danger" data-row="${r.rowIndex}">キャンセル</button>`
          : '—'
        }</td>
      `;
      tbody.appendChild(tr);
    });

    // キャンセルボタン
    tbody.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('この予約をキャンセルしますか？')) return;
        const rowIndex = Number(btn.dataset.row);
        const result = await gasPost(gasUrl, {
          action: 'cancelReservation',
          password: adminPassword,
          rowIndex
        });
        if (result.success) {
          loadReservations();
        } else {
          alert(result.message || 'エラーが発生しました。');
        }
      });
    });
  }

  // 再読込
  document.getElementById('btn-reload')?.addEventListener('click', loadReservations);

  // CSV出力
  document.getElementById('btn-export')?.addEventListener('click', () => {
    if (allReservations.length === 0) { alert('データがありません。'); return; }
    const header = ['日付', '時間', 'お名前', '電話番号', 'お悩み', 'ステータス', '登録日時'];
    const rows = allReservations.map(r => [
      r.date, r.time, r.name, r.phone, r.concern || '', r.status, r.timestamp
    ]);
    const csv = [header, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const bom = '\uFEFF';
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hypergolf_reservations_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  });
}

// XSSエスケープ
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
