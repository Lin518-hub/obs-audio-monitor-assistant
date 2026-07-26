const DEFAULT_BATCH_DELAY_MS = 1200;
const MAX_MARKDOWN_BYTES = 3800;
const RETRY_DELAYS_MS = [1000, 3000, 10_000];

export function isValidWeComWebhook(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:'
      && url.hostname === 'qyapi.weixin.qq.com'
      && url.pathname === '/cgi-bin/webhook/send'
      && Boolean(url.searchParams.get('key'));
  } catch {
    return false;
  }
}

export function createWeComNotifier(options = {}) {
  return new WeComNotifier(options);
}

class WeComNotifier {
  constructor({
    webhookUrl = '',
    enabled = true,
    fetchImpl = globalThis.fetch,
    batchDelayMs = DEFAULT_BATCH_DELAY_MS,
    logger = console,
    clock = () => Date.now()
  } = {}) {
    this.webhookUrl = String(webhookUrl || '').trim();
    this.enabled = Boolean(enabled) && isValidWeComWebhook(this.webhookUrl) && typeof fetchImpl === 'function';
    this.fetchImpl = fetchImpl;
    this.batchDelayMs = Math.max(0, Number(batchDelayMs) || 0);
    this.logger = logger;
    this.clock = clock;
    this.deviceStates = new Map();
    this.queue = [];
    this.flushTimer = null;
    this.sendQueue = Promise.resolve();
    this.lastSuccessAt = null;
    this.lastError = null;
  }

  getStatus() {
    return {
      configured: isValidWeComWebhook(this.webhookUrl),
      enabled: this.enabled,
      queuedEvents: this.queue.length,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError
    };
  }

  observeDevice(device, state) {
    if (!this.enabled || !state || typeof state !== 'object') return;
    const uuid = cleanText(device?.uuid, 64);
    if (!uuid) return;

    const current = notificationState(state);
    const previous = this.deviceStates.get(uuid);
    const identity = {
      uuid,
      label: cleanText(device?.label, 80) || `电脑 ${uuid.slice(0, 8)}`,
      roomName: cleanText(device?.roomName, 60) || '未命名直播间'
    };
    if (!current.live) {
      this.deviceStates.set(uuid, {
        ...current,
        audioAlertStartedAt: null,
        cameraAlertStartedAt: null
      });
      return;
    }

    if (!previous) {
      this.deviceStates.set(uuid, {
        ...current,
        audioAlertStartedAt: current.audioAlert ? this.clock() : null,
        cameraAlertStartedAt: current.cameraAlert ? this.clock() : null
      });
      if (current.audioAlert) this.enqueue(audioAlertEvent(identity, state, this.clock()));
      if (current.cameraAlert) this.enqueue(cameraAlertEvent(identity, state, this.clock()));
      return;
    }

    if (!previous.audioAlert && current.audioAlert) {
      this.enqueue(audioAlertEvent(identity, state, this.clock()));
    } else if (previous.audioAlert && current.audioHealthy) {
      this.enqueue(audioRecoveryEvent(identity, state, previous.audioAlertStartedAt || this.clock(), this.clock()));
    }

    if (!previous.cameraAlert && current.cameraAlert) {
      this.enqueue(cameraAlertEvent(identity, state, this.clock()));
    } else if (previous.cameraAlert && current.cameraHealthy) {
      this.enqueue(cameraRecoveryEvent(identity, state, previous.cameraAlertStartedAt || this.clock(), this.clock()));
    }

    this.deviceStates.set(uuid, {
      ...current,
      audioAlertStartedAt: current.audioAlert
        ? previous.audioAlertStartedAt || this.clock()
        : current.audioHealthy
          ? null
          : previous.audioAlertStartedAt,
      cameraAlertStartedAt: current.cameraAlert
        ? previous.cameraAlertStartedAt || this.clock()
        : current.cameraHealthy
          ? null
          : previous.cameraAlertStartedAt
    });
  }

  enqueue(event) {
    this.queue.push(event);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, this.batchDelayMs);
    this.flushTimer.unref?.();
  }

  async flushNow() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (!this.enabled || this.queue.length === 0) return;
    const events = this.queue.splice(0);
    const payloads = markdownPayloads(events);
    const operation = this.sendQueue.catch(() => undefined).then(async () => {
      for (const payload of payloads) await this.sendWithRetry(payload);
    });
    this.sendQueue = operation;
    await operation;
  }

  async stop() {
    await this.flushNow();
    await this.sendQueue.catch(() => undefined);
  }

  async sendWithRetry(payload) {
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) await delay(RETRY_DELAYS_MS[attempt - 1]);
      try {
        const response = await this.fetchImpl(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000)
        });
        const body = await response.json();
        if (!response.ok || Number(body?.errcode) !== 0) {
          throw new Error(body?.errmsg || `HTTP ${response.status}`);
        }
        this.lastSuccessAt = this.clock();
        this.lastError = null;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    this.lastError = lastError instanceof Error ? lastError.message : String(lastError || 'send_failed');
    this.logger.warn?.(`[wecom] notification failed: ${this.lastError}`);
  }
}

function notificationState(state) {
  const audio = state.audio && typeof state.audio === 'object' ? state.audio : {};
  const atem = state.atem && typeof state.atem === 'object' ? state.atem : {};
  const obs = state.obs && typeof state.obs === 'object' ? state.obs : {};
  const live = obs.liveActive === true || obs.streaming === true || obs.recording === true || obs.simulatedLive === true || obs.virtualCameraActive === true;
  const audioAlert = live && audio.ready === true && (audio.phase === 'alert' || audio.tone === 'danger');
  const audioHealthy = live && audio.ready === true && !audioAlert;
  const cameraAlert = live && atem.connected === true && atem.overLimit === true;
  const cameraHealthy = live && atem.connected === true && !cameraAlert;
  return {
    live,
    audioAlert,
    audioHealthy,
    cameraAlert,
    cameraHealthy,
    audioAlertStartedAt: null,
    cameraAlertStartedAt: null
  };
}

function audioAlertEvent(identity, state, occurredAt) {
  return {
    kind: 'audio_alert',
    tone: 'warning',
    title: '音频异常',
    identity,
    occurredAt,
    detail: `${cleanText(state.audio?.inputName, 100) || '目标音源'}连续静音 ${wholeSeconds(state.audio?.silentForSeconds)} 秒`
  };
}

function audioRecoveryEvent(identity, state, startedAt, occurredAt) {
  return {
    kind: 'audio_recovery',
    tone: 'info',
    title: '音频已恢复',
    identity,
    occurredAt,
    detail: `${cleanText(state.audio?.inputName, 100) || '目标音源'}恢复正常，异常约 ${durationText(occurredAt - startedAt)}`
  };
}

function cameraAlertEvent(identity, state, occurredAt) {
  const inputId = Number(state.atem?.programInput);
  const inputName = cleanText(state.atem?.inputLabels?.[inputId], 100) || (Number.isFinite(inputId) ? `机位 ${inputId}` : '当前机位');
  return {
    kind: 'camera_alert',
    tone: 'warning',
    title: '机位停留超时',
    identity,
    occurredAt,
    detail: `${inputName}已连续播出 ${durationText(wholeSeconds(state.atem?.elapsedSeconds) * 1000)}`
  };
}

function cameraRecoveryEvent(identity, state, startedAt, occurredAt) {
  const inputId = Number(state.atem?.programInput);
  const inputName = cleanText(state.atem?.inputLabels?.[inputId], 100) || (Number.isFinite(inputId) ? `机位 ${inputId}` : '当前机位');
  return {
    kind: 'camera_recovery',
    tone: 'info',
    title: '机位已切换',
    identity,
    occurredAt,
    detail: `${inputName}开始播出，上一次超时状态持续约 ${durationText(occurredAt - startedAt)}`
  };
}

function markdownPayloads(events) {
  const alerting = events.some((event) => event.kind.endsWith('_alert'));
  const heading = `<font color="${alerting ? 'warning' : 'info'}">OBS 直播监控通知</font>`;
  const chunks = [];
  let lines = [heading];
  let bytes = Buffer.byteLength(heading, 'utf8');

  for (const event of events) {
    const line = [
      `> **${escapeMarkdown(event.identity.roomName)}** · ${escapeMarkdown(event.title)}`,
      `> ${escapeMarkdown(event.detail)}`,
      `> 设备：${escapeMarkdown(event.identity.label)} · ${formatTime(event.occurredAt)}`
    ].join('\n');
    const nextBytes = Buffer.byteLength(`\n\n${line}`, 'utf8');
    if (lines.length > 1 && bytes + nextBytes > MAX_MARKDOWN_BYTES) {
      chunks.push(lines.join('\n\n'));
      lines = [heading];
      bytes = Buffer.byteLength(heading, 'utf8');
    }
    lines.push(line);
    bytes += nextBytes;
  }
  if (lines.length > 1) chunks.push(lines.join('\n\n'));
  return chunks.map((content) => ({ msgtype: 'markdown', markdown: { content } }));
}

function escapeMarkdown(value) {
  return cleanText(value, 180).replace(/[<>]/g, (character) => character === '<' ? '＜' : '＞');
}

function cleanText(value, max) {
  return String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max);
}

function wholeSeconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

function durationText(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(timestamp));
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}
