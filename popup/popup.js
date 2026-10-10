const FIELDS = ['username', 'startDate', 'minDelay', 'maxDelay', 'maxCount'];
const $ = (id) => document.getElementById(id);

function showError(msg) {
  $('error').textContent = msg || '';
  $('error').hidden = !msg;
}

function render(status = {}) {
  const running = !!status.running;
  $('deleted').textContent = status.deleted ?? 0;
  $('unconfirmed').textContent = status.unconfirmed ?? 0;
  $('skipped').textContent = status.skipped ?? 0;
  $('phase').textContent = running ? `Running: ${status.phase}` : 'Idle';
  $('start').disabled = running;
  $('stop').disabled = !running;
  for (const f of FIELDS) $(f).disabled = running;

  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.replaceChildren(
    ...(status.log || []).map((entry) => {
      const li = document.createElement('li');
      li.className = entry.level;
      const time = document.createElement('time');
      time.textContent = entry.time;
      li.append(time, entry.msg);
      return li;
    })
  );
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function readConfig() {
  const cfg = {};
  for (const f of FIELDS) cfg[f] = $(f).value.trim();
  return cfg;
}

async function getDiscordTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // tab.url is only visible for discord.com thanks to host_permissions.
  if (!tab?.url || !tab.url.startsWith('https://discord.com/channels/')) {
    throw new Error('Open a Discord server channel on discord.com in this tab first.');
  }
  if (tab.url.startsWith('https://discord.com/channels/@me')) {
    throw new Error('This works in servers only. Open a server channel.');
  }
  return tab;
}

async function send(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Tab was open before the extension was installed: inject now and retry.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/selectors.js', 'src/content.js'],
    });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

async function init() {
  const { config = {}, status = {} } = await chrome.storage.local.get(['config', 'status']);
  for (const f of FIELDS) if (config[f] !== undefined && config[f] !== '') $(f).value = config[f];
  render(status);

  // Ask the page for the real running state (the stored one can be stale).
  try {
    const tab = await getDiscordTab();
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'ping' });
    if (res && !res.running && status.running) render({ ...status, running: false });
  } catch {
    // Not on Discord or script not loaded yet; nothing is running there.
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.status) render(changes.status.newValue);
});

for (const f of FIELDS) {
  $(f).addEventListener('change', async () => {
    await chrome.storage.local.set({ config: readConfig() });
  });
}

$('config').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const cfg = readConfig();
  if (!cfg.username) return showError('Enter your Discord username.');
  if (!cfg.startDate) return showError('Pick a start date.');
  if (Number(cfg.maxDelay) < Number(cfg.minDelay)) return showError('Max delay must be at least the min delay.');

  try {
    await chrome.storage.local.set({ config: cfg });
    const tab = await getDiscordTab();
    const res = await send(tab, { type: 'start', config: cfg });
    if (!res?.ok) showError(res?.error || 'Could not start.');
  } catch (err) {
    showError(err.message);
  }
});

$('stop').addEventListener('click', async () => {
  showError('');
  try {
    const tab = await getDiscordTab();
    await send(tab, { type: 'stop' });
  } catch (err) {
    showError(err.message);
  }
});

init();
