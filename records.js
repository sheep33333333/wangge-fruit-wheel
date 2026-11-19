(() => {
  'use strict';
  const config = window.FRUIT_BACKEND || {};
  const configured = /^https:\/\/[a-z0-9.-]+\.supabase\.co$/.test(config.url || '') && !!config.publishableKey;
  const notice = document.createElement('p');
  notice.id = 'record-notice';
  notice.style.cssText = 'font-size:11px;line-height:1.8;color:#7b856f;text-align:center;margin:13px 0 0';
  notice.setAttribute('role', 'status');
  document.getElementById('history').after(notice);
  const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const fragment = new URLSearchParams(location.hash.slice(1));
  let shareToken = fragment.get('share');
  try {
    if (tokenPattern.test(shareToken || '')) localStorage.setItem('fruit-share-token', shareToken);
    else shareToken = localStorage.getItem('fruit-share-token');
  } catch (_) {}
  window.addEventListener('hashchange', () => {
    const next = new URLSearchParams(location.hash.slice(1)).get('share');
    if (tokenPattern.test(next || '') && next !== shareToken) location.reload();
  });
  if (!tokenPattern.test(shareToken || '')) { notice.hidden = true; return; }
  let syncing = false, retryTimer, storageError = false, syncError = false;
  const memory = new Map();
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open('wangge-spin-records', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('queue', { keyPath: 'p_event_id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage blocked'));
  });
  database.catch(() => { storageError = true; });
  async function transaction(mode, action) {
    const db = await database;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queue', mode), req = action(tx.objectStore('queue'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('Storage unavailable'));
    });
  }
  async function pending() {
    let saved = [];
    try { saved = await transaction('readonly', store => store.getAll()); }
    catch (_) { storageError = true; }
    return [...new Map([...saved, ...memory.values()].map(item => [item.p_event_id, item])).values()];
  }
  async function status() {
    const count = (await pending()).length;
    notice.textContent = !configured ? '结果同步尚未启用，请联系分享者完成配置。'
      : storageError && count ? '结果将同步给分享者 · 本机保存不可用，请保持页面开启并联网。'
      : count ? `结果将同步给分享者 · ${count} 条${syncError ? '暂未同步，稍后重试' : '待同步'}`
      : '每次转盘结果将同步给分享者';
  }
  async function sync() {
    if (syncing || !configured || !navigator.onLine) { await status(); return; }
    syncing = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    try {
      for (const record of await pending()) {
        const response = await fetch(`${config.url}/rest/v1/rpc/record_spin`, {
          method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(record), signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('Sync unavailable');
        try { await transaction('readwrite', store => store.delete(record.p_event_id)); }
        catch (_) { storageError = true; }
        memory.delete(record.p_event_id);
      }
      syncError = false;
    } catch (_) {
      syncError = true;
      retryTimer = setTimeout(sync, 20000);
    } finally {
      syncing = false; await status();
      // Include results created while an earlier upload was still in progress.
      if ((await pending()).length && !retryTimer) retryTimer = setTimeout(() => { retryTimer = null; void sync(); }, 20000);
    }
  }
  window.FruitRecords = {
    async record(fruit, choices) {
      const record = { p_event_id: crypto.randomUUID(), p_share_token: shareToken,
        p_fruit: fruit, p_choices: [...choices], p_spun_at: new Date().toISOString() };
      memory.set(record.p_event_id, record);
      try { await transaction('readwrite', store => store.put(record)); }
      catch (_) { storageError = true; }
      await status(); void sync();
    }
  };
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
  void sync();
})();
