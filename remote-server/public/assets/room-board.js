/* Read-only persistent display, sharing the monitor's authenticated polling loop. */
(() => {
  const root = document.getElementById('room-board');
  const grid = document.getElementById('room-board-grid');
  const idleGrid = document.getElementById('room-board-idle');
  const status = document.getElementById('room-board-status');
  const select = document.getElementById('room-board-select');
  const locationSelect = document.getElementById('room-board-location');
  let namesKey = '';
  function fitScreen() {
    const television = window.innerWidth >= 1000;
    root.classList.toggle('board-tv', television);
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    root.style.setProperty('--tv-scale', String(scale));
    root.style.setProperty('--tv-width', `${window.innerWidth / scale}px`);
    root.style.setProperty('--tv-height', `${window.innerHeight / scale}px`);
  }
  fitScreen();
  window.addEventListener('resize', () => { fitScreen(); render(); });
  let data = null, receivedAt = 0, failed = false, active = false, wake = null;
  const node = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
  let stream = null, streamOpen = false, meterFrame = 0;
  const liveMeters = new Map();
  const recentSpeech = new Map();
  let pageStartedAt = Date.now();
  const dirtyMeters = new Set();
  // Keep card elements mounted; only patch changed text and attributes.
  function patchNode(current, next) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) { current.replaceWith(next); return; }
    if (current.nodeType === 3) { if (current.data !== next.data) current.data = next.data; return; }
    for (const attr of [...current.attributes]) if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    for (const attr of next.attributes) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    const oldChildren = [...current.childNodes], children = [...next.childNodes];
    children.forEach((child, index) => { if (oldChildren[index]) patchNode(oldChildren[index], child); else current.append(child); });
    for (let index = children.length; index < oldChildren.length; index++) oldChildren[index].remove();
  }
  function syncCards(container, cards) {
    const existing = new Map([...container.children].map(card => [card.dataset.uuid, card]));
    const keep = new Set();
    cards.forEach((next, index) => {
      let card = existing.get(next.dataset.uuid);
      if (card) patchNode(card, next); else card = next;
      keep.add(card);
      if (container.children[index] !== card) container.insertBefore(card, container.children[index] || null);
    });
    for (const card of [...container.children]) if (!keep.has(card)) card.remove();
  }
  function paintMeters() {
    meterFrame = 0;
    let healthChanged = false;
    for (const uuid of dirtyMeters) {
      const card = [...grid.children].find(el => el.dataset.uuid === uuid);
      const meter = liveMeters.get(uuid);
      const device = data?.rooms?.flatMap(room => room.devices || []).find(device => device.uuid === uuid);
      if (!device || !meter) continue;
      const health = window.roomBoardHealth.classify(device, { now: Date.now(), stale: failed || Date.now() - receivedAt > 15000, meter, speech: recentSpeech.get(uuid) });
      if (card && card.dataset.health !== health.code) healthChanged = true;
      if (!card || card.dataset.audioEnabled !== 'true') continue;
      const db = Number.isFinite(meter.levelDb) ? Math.max(-90, Math.min(0, meter.levelDb)) : null;
      const track = card.querySelector('.board-meter'), fill = track?.querySelector('i'), value = card.querySelector('.board-audio-label strong');
      if (!track || !fill || !value) continue;
      fill.style.transform = `scaleX(${db === null ? 0 : (db + 90) / 90})`;
      value.textContent = db === null ? '— dB' : `${meter.levelDb.toFixed(1)} dB`;
      if (db === null) track.removeAttribute('aria-valuenow'); else track.setAttribute('aria-valuenow', String(db));
      track.setAttribute('aria-valuetext', db === null ? '暂无有效音频数据' : value.textContent);
    }
    dirtyMeters.clear();
    if (healthChanged) render();
  }
  function connectStream() {
    if (!active || document.hidden || stream || !window.EventSource) return;
    stream = new EventSource('/api/monitor/live');
    stream.onopen = () => { streamOpen = true; };
    stream.onerror = () => { streamOpen = false; liveMeters.clear(); render(); };
    stream.addEventListener('meters', event => {
      try {
        const frames = JSON.parse(event.data);
        if (!Array.isArray(frames)) return;
        for (const meter of frames) {
          if (typeof meter.uuid !== 'string' || !data?.rooms?.some(room => room.devices?.some(device => device.uuid === meter.uuid))) continue;
          const device = data.rooms.flatMap(room => room.devices || []).find(device => device.uuid === meter.uuid);
          if (meter.inputName !== device.audio?.inputName) continue;
          const at = Date.now();
          if (Number.isFinite(meter.levelDb) && Number.isFinite(device.audio?.thresholdDb) && meter.levelDb > device.audio.thresholdDb) recentSpeech.set(meter.uuid, { at, inputName: meter.inputName });
          liveMeters.set(meter.uuid, { ...meter, receivedAt: at }); dirtyMeters.add(meter.uuid);
        }
        if (!meterFrame) meterFrame = requestAnimationFrame(paintMeters);
      } catch { /* Ignore invalid frames; ordinary status polling remains available. */ }
    });
  }
  function closeStream() {
    stream?.close(); stream = null; streamOpen = false;
    liveMeters.clear(); dirtyMeters.clear(); cancelAnimationFrame(meterFrame); meterFrame = 0;
  }
  async function releaseWake() { const previous = wake; wake = null; if (previous) await previous.release().catch(() => {}); }
  async function acquireWake() {
    if (!active || document.hidden || wake || !navigator.wakeLock) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (!active || document.hidden) { await lock.release(); return; }
      if (wake) { await lock.release(); return; }
      wake = lock;
      lock.addEventListener('release', () => { if (wake === lock) wake = null; });
    } catch { /* Browser/OS may refuse; the board remains usable. */ }
  }
  function setActive(value) {
    if (value && !active) pageStartedAt = Date.now();
    active = value;
    history.replaceState(null, '', location.pathname + location.search + (active ? '#board' : ''));
    root.classList.toggle('hidden', !active);
    document.body.classList.toggle('room-board-active', active);
    document.getElementById('monitor-board-button').setAttribute('aria-pressed', String(active));
    if (active) { connectStream(); render(); void acquireWake(); document.getElementById('room-board-close').focus(); }
    else { closeStream(); void releaseWake(); if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {}); }
  }
  function render() {
    if (!active) return;
    const now = Date.now();
    document.getElementById('room-board-clock').textContent = new Date(now).toLocaleTimeString('zh-CN', { hour12: false });
    const stale = failed || !receivedAt || now - receivedAt > 15_000;
    status.textContent = stale ? '同步中断 · 显示上次数据，状态不可确认' : streamOpen ? '电平实时推送 · 状态每 3 秒同步' : '电平连接中 · 状态轮询可用';
    status.dataset.stale = String(stale);
    const rooms = (data?.rooms || []).filter(room => (!select.value || room.name === select.value) && (!locationSelect.value || window.roomLocation(room.name) === locationSelect.value)).slice().sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const cards = [], idleCards = [];
    let liveCount = 0, attentionCount = 0, onlineCount = 0, offlineCount = 0, connectionCount = 0;
    for (const room of rooms) for (const device of [...(room.devices || [])].sort((a, b) => String(a.uuid).localeCompare(String(b.uuid)))) {
      const deviceStale = stale || !Number.isFinite(device.stateUpdatedAt) || now - device.stateUpdatedAt > 30_000;
      const available = device.online && !deviceStale;
      const audio = device.audio || {}, obs = device.obs || {}, atem = device.atem || {};
      const health = window.roomBoardHealth.classify(device, { now, stale, meter: liveMeters.get(device.uuid), speech: recentSpeech.get(device.uuid) });
      const tone = health.tone;
      if (available) onlineCount++;
      if (available && obs.streaming) liveCount++;
      if (health.audioIssue) attentionCount++;
      if (!device.online) offlineCount++;
      else if (!available || !obs.connected) connectionCount++;
      const isLive = Boolean(available && obs.streaming);
      const card = node('article', '', `room-board-card tone-${tone}`);
      const header = node('header', '');
      card.dataset.uuid = device.uuid;
      card.dataset.health = health.code;
      card.dataset.longName = String(room.name.length > 20);
      card.dataset.audioEnabled = String(available && obs.connected);
      card.dataset.live = String(isLive);
      card.dataset.priority = tone === 'critical' ? '0' : tone === 'danger' ? '1' : '2';
      header.append(node('h2', room.name), node('span', health.code === 'healthy' ? '在线' : health.label, 'board-badge'));
      header.querySelector('h2').title = room.name;
      card.append(header, node('p', `${window.roomLocation(room.name)} · ${device.label || '直播电脑'}`, 'board-device'));
      const state = !available ? '当前状态不可确认' : obs.streaming ? '正在直播' : obs.recording ? '正在录制' : obs.simulatedLive ? '模拟开播' : obs.virtualCameraActive ? '虚拟摄像头开启' : '尚未推流';
      card.append(node('strong', state, 'board-live'), node('p', available ? `OBS ${obs.connected ? '已连接' : '未连接'} · 检测${obs.monitoringActive ? '运行中' : '未开启'}` : '请检查电脑与网络连接', 'board-device'));
      const audioAvailable = health.level !== null;
      const level = health.level;
      const audioPanel = node('section', '', 'board-audio-panel');
      const meterLabel = node('div', '', 'board-audio-label');
      meterLabel.append(node('span', audio.inputName || '未选择音源'), node('strong', level === null ? '— dB' : `${level.toFixed(1)} dB`));
      const meter = node('div', '', 'board-meter');
      meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', '音频电平'); meter.setAttribute('aria-valuemin', '-90'); meter.setAttribute('aria-valuemax', '0');
      if (level !== null) meter.setAttribute('aria-valuenow', String(Math.max(-90, Math.min(0, level))));
      meter.setAttribute('aria-valuetext', level === null ? '暂无有效音频数据' : `${level.toFixed(1)} dB`);
      const fill = node('i', ''); fill.style.transform = `scaleX(${level === null ? 0 : Math.max(0, Math.min(1, (level + 90) / 90))})`; meter.append(fill);
      audioPanel.append(node('span', '音频监测', 'board-section-label'), meterLabel, meter);
      const scale = node('div', '', 'board-meter-scale');
      for (const mark of ['−90', '−60', '−30', '0 dB']) scale.append(node('span', mark));
      audioPanel.append(scale, node('p', health.label, 'board-audio-state'));
      card.append(audioPanel);
      const details = node('div', '', 'board-telemetry');
      const metric = (label, value, note = '') => { const item = node('div', '', 'board-telemetry-item'); item.append(node('span', label), node('strong', value), node('small', note)); return item; };
      const numeric = (value, suffix, digits = 0) => available && Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : '—';
      const bitrate = window.roomBoardHealth.bitrate(device, available);
      details.append(
        metric('OBS 帧率', numeric(obs.fps, ' FPS', 1), `CPU ${numeric(obs.cpu, '%', 1)}`),
        metric('推流码率', bitrate.value, bitrate.note),
        metric('当前机位', available && atem.connected ? atem.programName || `PGM ${atem.programInput || '—'}` : '—', available && atem.connected ? `预监 ${atem.previewName || atem.previewInput || '—'}` : '导播台未连接'),
        metric('持续静音', health.silent !== null ? `${Math.floor(health.silent)} 秒` : '—', obs.monitoringActive && available ? '检测运行中' : '检测未开启')
      );
      card.append(details);
      const footer = node('footer', '');
      footer.append(node('span', available && atem.connected ? `当前机位：${atem.programName || atem.programInput || '—'}` : '机位：未连接 / 不可用'), node('span', device.stateUpdatedAt ? `上报 ${Math.max(0, Math.floor((now - device.stateUpdatedAt) / 1000))} 秒前` : '尚未上报'));
      card.append(footer);
      if (isLive) cards.push(card);
      else {
        card.classList.add('board-idle-card');
        const compact = node('div', '', 'board-idle-summary');
        compact.append(node('span', state), node('span', available ? `OBS ${obs.connected ? '已连接' : '未连接'} · 检测${obs.monitoringActive ? '开启' : '关闭'}` : '等待设备重新连接'));
        card.replaceChildren(header, node('p', `${window.roomLocation(room.name)} · ${device.label || '直播电脑'}`, 'board-device'), compact);
        idleCards.push(card);
      }
    }
    const metrics = document.getElementById('room-board-metrics');
    metrics.replaceChildren(...[[String(onlineCount), '在线电脑'], [String(liveCount), '正在直播'], [String(attentionCount), '音频异常'], [String(offlineCount), '电脑离线'], [String(connectionCount), '连接异常'], [String(idleCards.length - offlineCount), '待机 / 待确认']].map(([value, label], index) => {
      const metric = node('div', '', 'board-stat' + (index === 2 && attentionCount ? ' attention' : ''));
      metric.append(node('strong', value), node('span', label)); return metric;
    }));
    cards.sort((a, b) => Number(a.dataset.priority) - Number(b.dataset.priority));
    // A television never scrolls: rotate additional rooms in bounded pages.
    const pageCards = (items) => {
      if (!root.classList.contains('board-tv') || items.length <= 6) return items;
      const page = Math.floor((Date.now() - pageStartedAt) / 15000) % Math.ceil(items.length / 6);
      return items.slice(page * 6, page * 6 + 6);
    };
    const visibleCards = pageCards(cards), visibleIdle = pageCards(idleCards);
    root.dataset.idleCount = String(visibleIdle.length);
    root.dataset.dense = String(visibleCards.length > 3);
    grid.dataset.count = String(visibleCards.length);
    idleGrid.style.setProperty('--idle-count', String(Math.max(1, visibleIdle.length)));
    const paging = cards.length > 6 || idleCards.length > 6;
    const pageLabel = (items) => {
      const pages = root.classList.contains('board-tv') ? Math.max(1, Math.ceil(items.length / 6)) : 1;
      return `第 ${Math.floor((now - pageStartedAt) / 15000) % pages + 1} / ${pages} 页`;
    };
    root.querySelector('.board-section-heading:not(.board-idle-heading)>span').textContent = `${pageLabel(cards)} · 音频异常 ${attentionCount} 间 · ${paging ? '每 15 秒轮播' : '实时音频 / 推流 / 导播'}`;
    document.getElementById('board-idle-count').title = pageLabel(idleCards);
    root.querySelector('.board-note').textContent = paging && root.classList.contains('board-tv') ? '每 15 秒自动轮播更多直播间 · 只读监看 · 请将浏览器保持在前台' : '只读监看 · 支持时自动保持屏幕常亮 · 请将浏览器保持在前台';
    grid.classList.toggle('board-small-grid', cards.length > 1 && cards.length <= 4);
    document.getElementById('board-live-count').textContent = String(cards.length);
    document.getElementById('board-idle-count').textContent = `${idleCards.length} · ${pageLabel(idleCards)}`;
    syncCards(idleGrid, visibleIdle);
    if (!idleCards.length) idleGrid.append(node('p', '全部设备正在直播', 'board-empty-compact'));
    syncCards(grid, visibleCards);
    if (!cards.length) grid.append(node('p', '当前没有正在推流的直播间。请在待机与离线列表查看其他房间。', 'board-empty'));
    document.getElementById('room-board-count').textContent = `${rooms.length} 个直播间 · ${cards.length + idleCards.length} 台电脑`;
  }
  window.roomBoard = {
    update(next) {
      const ids = new Set((next.rooms || []).flatMap(room => room.devices.map(device => device.uuid)));
      for (const id of liveMeters.keys()) if (!ids.has(id)) liveMeters.delete(id);
      for (const [id, speech] of recentSpeech) {
        const device = next.rooms.flatMap(room => room.devices || []).find(device => device.uuid === id);
        if (!device || device.audio?.inputName !== speech.inputName || Date.now() - speech.at > 30000) recentSpeech.delete(id);
      }
      data = next; receivedAt = Date.now(); failed = false;
      const selected = select.value;
      const names = [...new Set((next.rooms || []).map(room => room.name))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const nextNamesKey = JSON.stringify(names);
      if (nextNamesKey !== namesKey) {
        namesKey = nextNamesKey;
        select.replaceChildren(new Option('全部直播间', ''), ...names.map(name => new Option(name, name)));
        if (names.includes(selected)) select.value = selected;
      }
      if (!active && location.hash === '#board') setActive(true);
      else render();
    },
    fail() { failed = true; render(); },
    close() { setActive(false); data = null; receivedAt = 0; grid.replaceChildren(); idleGrid.replaceChildren(); }
  };
  document.getElementById('monitor-board-button').addEventListener('click', () => setActive(true));
  document.getElementById('room-board-close').addEventListener('click', () => { setActive(false); document.getElementById('monitor-board-button').focus(); });
  document.getElementById('room-board-fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement === root) await document.exitFullscreen(); else await root.requestFullscreen(); }
    catch { status.textContent = '浏览器未允许全屏，仍可使用当前看板'; }
  });
  select.addEventListener('change', () => { pageStartedAt = Date.now(); render(); });
  locationSelect.addEventListener('change', () => { select.value = ''; pageStartedAt = Date.now(); render(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { void releaseWake(); closeStream(); } else { void acquireWake(); connectStream(); render(); } });
  document.addEventListener('fullscreenchange', () => { document.getElementById('room-board-fullscreen').textContent = document.fullscreenElement === root ? '退出全屏' : '全屏展示'; });
  // One fixed timer, no accumulating history or extra network polling.
  setInterval(render, 1000);
})();
