const syncForm = document.querySelector('#study-sync');
const syncStatus = document.querySelector('#study-sync-status');
const syncEmail = document.querySelector('#study-sync-email');
const syncLogin = document.querySelector('#study-sync-login');
const syncLogout = document.querySelector('#study-sync-logout');
const syncEnable = document.querySelector('#study-sync-enable');
const syncLabel = syncEmail.closest('label');
const SUPABASE_URL = 'https://qijndqclowswnidbajuj.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_3_bkZtbaQud1BmdrI63iWQ_QLvdlMPZ';
const SYNC_SUBJECT = syncForm.dataset.subject;
const STUDY_BASE = 'https://yq202020.github.io/histology-practice-web/';
const STUDY_URL = STUDY_BASE + (SYNC_SUBJECT === 'histology' ? '' : SYNC_SUBJECT + '/');
let syncClient;
let syncSession;
let syncRunning = false;
let syncDirty = false;

function syncKey(account, name) {
  return storageKey + '-cloud-' + account + '-' + name;
}

function readPending(account) {
  return JSON.parse(localStorage.getItem(syncKey(account, 'outbox')) || '[]');
}

function syncEnabled(account) {
  return localStorage.getItem(syncKey(account, 'enabled')) === 'yes';
}

window.queueStudyEvent = function queueStudyEvent(payload) {
  const account = syncSession?.user.id;
  if (!account || !syncEnabled(account)) return;
  try {
    const pending = readPending(account);
    pending.push({event_id: crypto.randomUUID(), payload});
    localStorage.setItem(syncKey(account, 'outbox'), JSON.stringify(pending));
    void syncStudy();
  } catch {
    syncStatus.textContent = '无法保存待同步记录，本机练习仍可继续。';
  }
};

function mergeStudyEvents(events) {
  const merged = {};
  let position;
  for (const {payload} of events) {
    if (payload.import) {
      for (const [id, entry] of Object.entries(payload.import)) {
        if (byId.has(id)) merged[id] = {...entry, ...merged[id]};
      }
      if (!position && byId.has(payload.position)) position = payload.position;
      continue;
    }
    if (!byId.has(payload.id)) continue;
    if (payload.cursor) position = payload.id;
    if (payload.changes && typeof payload.changes === 'object') {
      merged[payload.id] = {...merged[payload.id], ...payload.changes};
    }
  }
  const changed = Object.entries(merged).some(([id, entry]) =>
    JSON.stringify(results[id]) !== JSON.stringify(entry));
  const next = !selected && !revealed && queue.includes(position) ? position : current;
  if (!changed && next === current) return;
  Object.assign(results, merged);
  current = next;
  if (filter === '收藏') {
    queue = order.filter(id => collection(byId.get(id)));
    if (!queue.includes(current)) {
      current = queue[0];
      selected = '';
      revealed = false;
      assessment = undefined;
    }
  }
  save();
  if (filter !== '模拟试卷') render();
  else renderNav();
}

async function syncStudy() {
  const account = syncSession?.user.id;
  if (!account || !syncEnabled(account)) return;
  if (syncRunning) {
    syncDirty = true;
    return;
  }
  syncRunning = true;
  try {
    const pending = readPending(account);
    const table = () => syncClient.from('tcm_study_events');
    for (let offset = 0; offset < pending.length; offset += 80) {
      if (syncSession?.user.id !== account) return;
      const {error} = await table().upsert(pending.slice(offset, offset + 80).map(event => ({
        ...event, account_id: account, subject: SYNC_SUBJECT
      })), {onConflict: 'account_id,event_id', ignoreDuplicates: true});
      if (error) throw error;
    }
    if (pending.length) {
      const sent = new Set(pending.map(event => event.event_id));
      localStorage.setItem(syncKey(account, 'outbox'), JSON.stringify(
        readPending(account).filter(event => !sent.has(event.event_id))
      ));
    }
    const events = [];
    for (let start = 0; ; start += 500) {
      if (syncSession?.user.id !== account) return;
      const {data, error} = await table().select('payload').eq('account_id', account).eq('subject', SYNC_SUBJECT)
        .order('created_at').order('event_id').range(start, start + 499);
      if (error) throw error;
      events.push(...data);
      if (data.length < 500) break;
    }
    if (syncSession?.user.id === account && !readPending(account).length) {
      mergeStudyEvents(events);
      syncStatus.textContent = '本科记录已同步。';
    }
  } catch {
    if (syncSession?.user.id === account) syncStatus.textContent = '暂时无法同步，待同步记录保留在本机。';
  } finally {
    syncRunning = false;
    if (syncDirty) {
      syncDirty = false;
      void syncStudy();
    }
  }
}

function showSyncSession(session) {
  syncSession = session;
  const account = session?.user.id;
  syncLabel.hidden = Boolean(account);
  syncLogin.hidden = Boolean(account);
  syncLogout.hidden = !account;
  syncEnable.hidden = !account || syncEnabled(account);
  syncStatus.textContent = account
    ? (syncEnabled(account) ? '正在同步…' : '已登录。开启后会把本机此科的错题、收藏和练习进度合并到此账号。')
    : '本机练习，无需登录。';
  if (account && syncEnabled(account)) void syncStudy();
}

function initializeSync() {
  if (location.origin + location.pathname !== STUDY_URL || !window.supabase) {
    syncLogin.disabled = true;
    syncStatus.textContent = '同步暂不可用，本机练习仍可继续。';
    return;
  }
  syncLogin.disabled = false;
  syncClient = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: {storageKey: 'tcm-sync-auth-v1', flowType: 'pkce'}
  });
  syncClient.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => showSyncSession(session), 0);
  });
  syncForm.addEventListener('submit', async event => {
    event.preventDefault();
    syncLogin.disabled = true;
    syncStatus.textContent = '正在请求登录邮件…';
    try {
      const {error} = await syncClient.auth.signInWithOtp({
        email: syncEmail.value.trim(),
        options: {emailRedirectTo: STUDY_URL}
      });
      syncStatus.textContent = error
        ? '登录邮件发送失败。请核对邮箱，稍后再试。'
        : '请在同一个浏览器打开邮件中的一次性登录链接。';
    } catch {
      syncStatus.textContent = '暂时无法发送登录邮件。';
    } finally {
      syncLogin.disabled = false;
    }
  });
  syncEnable.addEventListener('click', () => {
    const account = syncSession?.user.id;
    if (!account) return;
    const snapshot = Object.fromEntries(Object.entries(results).filter(([id]) => byId.has(id)));
    try {
      const pending = readPending(account);
      pending.push({event_id: crypto.randomUUID(), payload: {import: snapshot, position: current}});
      localStorage.setItem(syncKey(account, 'outbox'), JSON.stringify(pending));
      localStorage.setItem(syncKey(account, 'enabled'), 'yes');
      showSyncSession(syncSession);
    } catch {
      syncStatus.textContent = '浏览器无法保存同步设置。';
    }
  });
  syncLogout.addEventListener('click', async () => {
    const {error} = await syncClient.auth.signOut({scope: 'local'});
    if (error) syncStatus.textContent = '退出失败，请重试。';
  });
  window.addEventListener('online', syncStudy);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void syncStudy();
  });
}
initializeSync();

