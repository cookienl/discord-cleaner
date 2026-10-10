// Runs inside discord.com. Drives the Discord UI the same way a person would:
// search -> right-click a result -> shift-click "Delete Message" -> repeat.
(() => {
  if (window.__discordCleanerLoaded) return;
  window.__discordCleanerLoaded = true;

  const S = globalThis.DC_SELECTORS;
  const MAX_ATTEMPTS = 3;
  const LOG_LIMIT = 200;

  class StopError extends Error {}

  let stopRequested = false;
  let running = false;
  const status = {
    running: false,
    phase: 'idle',
    deleted: 0,
    skipped: 0,
    unconfirmed: 0,
    log: [],
  };

  // ---------- status / logging ----------

  let saveTimer = null;
  function saveStatus() {
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        await chrome.storage.local.set({ status: { ...status, log: status.log.slice(-LOG_LIMIT) } });
      } catch (e) {
        // Extension was reloaded; this content script is orphaned.
        stopRequested = true;
      }
    }, 150);
  }

  function log(msg, level = 'info') {
    const time = new Date().toLocaleTimeString();
    status.log.push({ time, level, msg });
    if (status.log.length > LOG_LIMIT) status.log.splice(0, status.log.length - LOG_LIMIT);
    console.log(`[Discord Cleaner] ${msg}`);
    saveStatus();
  }

  function setPhase(phase) {
    status.phase = phase;
    saveStatus();
  }

  // ---------- generic helpers ----------

  async function wait(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (stopRequested) throw new StopError();
      await new Promise((r) => setTimeout(r, Math.min(200, end - Date.now())));
    }
    if (stopRequested) throw new StopError();
  }

  async function waitFor(fn, timeout = 10000, interval = 200) {
    const end = Date.now() + timeout;
    while (true) {
      if (stopRequested) throw new StopError();
      const v = fn();
      if (v) return v;
      if (Date.now() >= end) return null;
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  function randomDelay(cfg) {
    const min = Math.max(0.5, Number(cfg.minDelay) || 2);
    const max = Math.max(min, Number(cfg.maxDelay) || 4);
    return (min + Math.random() * (max - min)) * 1000;
  }

  function q(selectors, root = document) {
    for (const sel of [].concat(selectors)) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Deepest visible element under root whose own text matches the regex.
  // Clicking the deepest node lets the event bubble to whatever ancestor
  // owns the handler.
  function findByText(root, regex, selector = '*') {
    if (!root) return null;
    const matches = Array.from(root.querySelectorAll(selector)).filter(
      (el) => regex.test((el.textContent || '').trim()) && isVisible(el)
    );
    return matches.find((el) => !matches.some((o) => o !== el && el.contains(o))) || null;
  }

  function mouseOpts(el, extra = {}) {
    const r = el.getBoundingClientRect();
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + Math.min(r.height / 2, 20),
      ...extra,
    };
  }

  function hover(el) {
    el.dispatchEvent(new PointerEvent('pointerover', mouseOpts(el)));
    el.dispatchEvent(new MouseEvent('mouseover', mouseOpts(el)));
    el.dispatchEvent(new MouseEvent('mouseenter', mouseOpts(el, { bubbles: false })));
    el.dispatchEvent(new MouseEvent('mousemove', mouseOpts(el)));
  }

  function click(el, extra = {}) {
    hover(el);
    const o = mouseOpts(el, { button: 0, buttons: 1, ...extra });
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
  }

  function rightClick(el) {
    hover(el);
    const o = mouseOpts(el, { button: 2, buttons: 2 });
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('contextmenu', { ...o, buttons: 0 }));
  }

  function pressKey(el, key, code = key, keyCode = 0) {
    const o = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  function escape() {
    pressKey(document.activeElement || document.body, 'Escape', 'Escape', 27);
  }

  function caretToEnd(editor) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------- Discord-specific pieces ----------

  function getGuildId() {
    const m = location.pathname.match(/^\/channels\/([^/]+)/);
    return m ? m[1] : null;
  }

  function getPanel() {
    return q(S.resultsPanel);
  }

  function getResults(panel) {
    if (!panel) return [];
    const seen = new Set();
    const out = [];
    for (const content of panel.querySelectorAll(`[id^="${S.messageContentPrefix}"]`)) {
      const id = content.id.slice(S.messageContentPrefix.length);
      if (!/^\d+$/.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, content, root: content.closest(S.resultItem) || content.parentElement });
    }
    return out;
  }

  function checkRateLimit() {
    for (const el of document.querySelectorAll(S.notices)) {
      if (isVisible(el) && S.rateLimitText.test(el.textContent || '')) return el;
    }
    return null;
  }

  async function handleRateLimit() {
    const notice = checkRateLimit();
    if (!notice) return false;
    log('Discord asked to slow down. Pausing for 60 seconds.', 'warn');
    setPhase('rate limited');
    escape();
    await wait(60000);
    return true;
  }

  async function waitForResults() {
    // Give Discord a moment to replace old results with the loading state.
    await wait(800);
    return waitFor(() => {
      const panel = getPanel();
      if (!panel) return null;
      const loading = Array.from(panel.querySelectorAll(S.resultsLoading)).some(isVisible);
      if (loading) return null;
      if (getResults(panel).length) return 'results';
      const text = panel.textContent || '';
      if (S.indexingText.test(text)) return 'indexing';
      if (S.noResultsText.test(text)) return 'empty';
      return null;
    }, 20000);
  }

  function afterDate(startDate) {
    // Discord's "after:" excludes the given day, so search from the day before.
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async function runSearch(cfg) {
    setPhase('searching');
    const editor = await waitFor(() => q(S.searchInput), 10000);
    if (!editor) throw new Error('Could not find the Discord search box.');

    click(editor);
    editor.focus();
    await wait(300);
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    await wait(300);

    document.execCommand('insertText', false, 'from:');
    await wait(500);
    document.execCommand('insertText', false, cfg.username);
    await wait(1200);

    // Pick the matching user from the autocomplete so "from:" resolves to us.
    const name = cfg.username.toLowerCase();
    const options = Array.from(document.querySelectorAll([].concat(S.searchAutocompleteOption).join(','))).filter(isVisible);
    const option = options.find((o) => (o.textContent || '').toLowerCase().includes(name));
    if (option) {
      click(option);
      await wait(500);
    } else {
      log('No autocomplete match for your username; using the typed name.', 'warn');
      document.execCommand('insertText', false, ' ');
    }

    caretToEnd(editor);
    document.execCommand('insertText', false, ` after:${afterDate(cfg.startDate)} `);
    await wait(500);
    pressKey(editor, 'Enter', 'Enter', 13);

    const result = await waitForResults();
    if (!result) throw new Error('Search results did not load.');
    if (result === 'results') await ensureOldestFirst();
    return result;
  }

  async function ensureOldestFirst() {
    const panel = getPanel();
    if (!panel) return;

    // Tab style: "Newest | Oldest | Most Relevant"
    const tab = findByText(panel, S.sortOldestText);
    if (tab) {
      const holder = tab.closest('[aria-selected], [aria-checked]');
      if (holder && (holder.getAttribute('aria-selected') === 'true' || holder.getAttribute('aria-checked') === 'true')) return;
      click(tab);
      await waitForResults();
      return;
    }

    // Dropdown style: "Sort: Newest" -> menu -> "Oldest"
    const dropdown = findByText(panel, S.sortDropdownText);
    if (dropdown) {
      if (S.sortOldestText.test(dropdown.textContent.trim().replace(/^sort( by)?:?\s*/i, ''))) return;
      click(dropdown);
      await wait(500);
      const option = findByText(document, /oldest/i, S.sortOptions) || findByText(document, S.sortOldestText);
      if (option) {
        click(option);
        await waitForResults();
        return;
      }
      escape();
    }
    log('Could not find the "Oldest" sort option; continuing in Discord\'s default order.', 'warn');
  }

  function findMenuItem(menu, selectors, textRegex) {
    return q(selectors, menu) || findByText(menu, textRegex, '[role="menuitem"]') || findByText(menu, textRegex);
  }

  async function openMenuOn(el) {
    escape();
    await wait(150);
    el.scrollIntoView({ block: 'center' });
    await wait(250);
    rightClick(el);
    return waitFor(() => {
      const menu = Array.from(document.querySelectorAll(S.contextMenu)).find(isVisible);
      return menu || null;
    }, 2500);
  }

  async function jumpTo(result) {
    hover(result.root);
    await wait(300);
    const jump = findByText(result.root, S.jumpText);
    if (!jump) return null;
    click(jump);
    return waitFor(() => {
      const el = document.querySelector(S.chatMessage(result.id));
      return el && !getPanel()?.contains(el) && isVisible(el) ? el : null;
    }, 8000);
  }

  function messageGone(id) {
    const nodes = document.querySelectorAll(`[id="${S.messageContentPrefix}${id}"]`);
    return nodes.length === 0;
  }

  // Returns 'deleted' | 'unconfirmed' | 'retry' | 'skip'
  async function deleteOne(result) {
    let target = result.content;
    let menu = await openMenuOn(target);
    let del = menu && findMenuItem(menu, S.menuDelete, S.menuDeleteText);

    if (!del) {
      // Right-click on the search result didn't offer Delete: jump to it in chat.
      escape();
      await wait(200);
      const chatEl = await jumpTo(result);
      if (!chatEl) return 'retry';
      await wait(600);
      target = chatEl.querySelector(`[id^="${S.messageContentPrefix}"]`) || chatEl;
      menu = await openMenuOn(target);
      del = menu && findMenuItem(menu, S.menuDelete, S.menuDeleteText);
      if (!menu) return 'retry';
      if (!del) {
        escape();
        return 'skip';
      }
    }

    // Safety: only your own messages have "Edit Message". Moderators also see
    // "Delete Message" on other people's messages, so never rely on Delete alone.
    if (!findMenuItem(menu, S.menuEdit, S.menuEditText)) {
      escape();
      log(`Message ${result.id} has no "Edit Message" option; skipping because it may not be yours.`, 'warn');
      return 'skip';
    }

    click(del, { shiftKey: true });
    await wait(500);

    // Fallback if Discord still shows a confirmation dialog.
    const dialog = Array.from(document.querySelectorAll(S.dialog)).find(isVisible);
    if (dialog) {
      const confirm = findByText(dialog, S.dialogConfirmText, 'button') || findByText(dialog, S.dialogConfirmText);
      if (confirm) click(confirm);
      await wait(500);
    }

    if (await handleRateLimit()) return 'retry';

    // The element we right-clicked disappearing means Discord removed the message.
    const gone = await waitFor(() => !target.isConnected || messageGone(result.id), 6000);
    return gone ? 'deleted' : 'unconfirmed';
  }

  function nextPageButton() {
    const btn = q(S.nextPage, getPanel() || document);
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return null;
    return btn;
  }

  // ---------- main loop ----------

  async function run(cfg) {
    const guild = getGuildId();
    if (!guild || guild === '@me') throw new Error('Open a server channel first (not DMs).');

    const attempts = new Map();
    const skipped = new Set(); // never retried
    let handled = new Set(); // already processed since the last search
    const maxCount = Number(cfg.maxCount) || 0;
    let nothingLeftOnce = false;

    log(`Started. Deleting messages from "${cfg.username}" since ${cfg.startDate}${maxCount ? `, max ${maxCount}` : ''}.`);

    outer: while (true) {
      const searchResult = await runSearch(cfg);

      if (searchResult === 'indexing') {
        log('Discord is still indexing this server. Waiting 30 seconds.', 'warn');
        await wait(30000);
        continue;
      }

      if (searchResult === 'empty') {
        if (nothingLeftOnce) break;
        log('Search is empty. Searching once more to confirm.');
        nothingLeftOnce = true;
        await wait(5000);
        continue;
      }

      let progressSinceSearch = 0;
      handled = new Set();

      while (true) {
        if (maxCount && status.deleted >= maxCount) {
          log(`Reached the maximum of ${maxCount} deletions.`);
          break outer;
        }

        const panel = getPanel();
        if (!panel) {
          log('Search results closed; searching again.', 'warn');
          continue outer;
        }

        const next = getResults(panel).find((r) => !skipped.has(r.id) && !handled.has(r.id) && (attempts.get(r.id) || 0) < MAX_ATTEMPTS);

        if (!next) {
          if (progressSinceSearch > 0) {
            await wait(randomDelay(cfg));
            continue outer;
          }
          const btn = nextPageButton();
          if (btn) {
            setPhase('next page');
            click(btn);
            const r = await waitForResults();
            if (r === 'results') continue;
          }
          if (nothingLeftOnce) break outer;
          log('Nothing left to delete on these results. Searching once more to confirm.');
          nothingLeftOnce = true;
          await wait(5000);
          continue outer;
        }

        setPhase('deleting');
        const tries = (attempts.get(next.id) || 0) + 1;
        attempts.set(next.id, tries);

        let outcome;
        try {
          outcome = await deleteOne(next);
        } catch (e) {
          if (e instanceof StopError) throw e;
          log(`Error on message ${next.id}: ${e.message}`, 'warn');
          outcome = 'retry';
        }

        if (outcome === 'deleted') {
          handled.add(next.id);
          status.deleted++;
          progressSinceSearch++;
          nothingLeftOnce = false;
          log(`Deleted message ${next.id} (${status.deleted} total).`);
          await wait(randomDelay(cfg));
        } else if (outcome === 'unconfirmed') {
          handled.add(next.id);
          status.unconfirmed++;
          progressSinceSearch++;
          nothingLeftOnce = false;
          log(`Clicked delete on ${next.id} but could not confirm it disappeared. It will be retried if search shows it again.`, 'warn');
          await wait(randomDelay(cfg));
        } else if (outcome === 'skip' || tries >= MAX_ATTEMPTS) {
          skipped.add(next.id);
          status.skipped++;
          log(`Skipped message ${next.id}.`, 'warn');
          escape();
          await wait(randomDelay(cfg));
        } else {
          const backoff = randomDelay(cfg) * 2 ** tries;
          log(`Could not delete ${next.id} (try ${tries}/${MAX_ATTEMPTS}). Retrying in ${Math.round(backoff / 1000)}s.`, 'warn');
          escape();
          await wait(backoff);
        }
        saveStatus();
      }
    }

    log(`Finished. Deleted ${status.deleted}, unconfirmed ${status.unconfirmed}, skipped ${status.skipped}.`);
  }

  async function start(cfg) {
    if (running) return;
    running = true;
    stopRequested = false;
    Object.assign(status, { running: true, phase: 'starting', deleted: 0, skipped: 0, unconfirmed: 0, log: [] });
    saveStatus();
    try {
      await run(cfg);
    } catch (e) {
      if (e instanceof StopError) log('Stopped by you.');
      else log(`Stopped: ${e.message}`, 'error');
    } finally {
      escape();
      running = false;
      status.running = false;
      status.phase = 'idle';
      saveStatus();
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'ping') {
      sendResponse({ ok: true, running });
    } else if (msg?.type === 'start') {
      if (running) {
        sendResponse({ ok: false, error: 'Already running.' });
      } else {
        start(msg.config);
        sendResponse({ ok: true });
      }
    } else if (msg?.type === 'stop') {
      stopRequested = true;
      sendResponse({ ok: true });
    }
    return false;
  });

  // A page reload kills any previous run; make the stored status reflect that.
  (async () => {
    try {
      const { status: prev } = await chrome.storage.local.get('status');
      if (prev?.running) await chrome.storage.local.set({ status: { ...prev, running: false, phase: 'idle' } });
    } catch (e) {
      // ignore
    }
  })();
})();
