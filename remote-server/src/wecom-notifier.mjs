const DEFAULT_BATCH_DELAY_MS = 1200;
const MAX_TEXT_BYTES = 1800;
const AUDIO_ALERT_SECONDS = 120;
const CAMERA_ALERT_SECONDS = 10 * 60;
const DEFAULT_MINIMUM_CAMERA_ALERT_DURATION_MS = 10 * 60 * 1000;
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
    minimumAudioAlertDurationMs = 0,
    minimumCameraAlertDurationMs = DEFAULT_MINIMUM_CAMERA_ALERT_DURATION_MS,
    logger = console,
    clock = () => Date.now()
  } = {}) {
    this.webhookUrl = String(webhookUrl || '').trim();
    this.enabled = Boolean(enabled) && isValidWeComWebhook(this.webhookUrl) && typeof fetchImpl === 'function';
    this.fetchImpl = fetchImpl;
    this.batchDelayMs = Math.max(0, Number(batchDelayMs) || 0);
    this.minimumAudioAlertDurationMs = Math.max(0, Number(minimumAudioAlertDurationMs) || 0);
    this.minimumCameraAlertDurationMs = Math.max(0, Number(minimumCameraAlertDurationMs) || 0);
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
    const observedAt = this.clock();
    const identity = {
      uuid,
      label: cleanText(device?.label, 80) || `电脑 ${uuid.slice(0, 8)}`,
      roomName: cleanText(device?.roomName, 60) || '未命名直播间'
    };
    if (!current.live) {
      this.deviceStates.set(uuid, {
        ...current,
        audioAlertStartedAt: null,
        cameraAlertStartedAt: null,
        audioNotificationSent: false,
        cameraNotificationSent: false
      });
      return;
    }

    if (!previous) {
      const audioAlertStartedAt = current.audioAlert
        ? observedAt - current.audioAlertDurationMs
        : null;
      const cameraAlertStartedAt = current.cameraAlert
        ? observedAt - current.cameraAlertDurationMs
        : null;
      const audioNotificationSent = current.audioAlert
        && current.audioAlertDurationMs >= this.minimumAudioAlertDurationMs;
      const cameraNotificationSent = current.cameraAlert
        && current.cameraAlertDurationMs >= this.minimumCameraAlertDurationMs;
      this.deviceStates.set(uuid, {
        ...current,
        audioAlertStartedAt,
        cameraAlertStartedAt,
        audioNotificationSent,
        cameraNotificationSent
      });
      if (audioNotificationSent) this.enqueue(audioAlertEvent(identity, state, observedAt));
      if (cameraNotificationSent) this.enqueue(cameraAlertEvent(identity, state, observedAt));
      return;
    }

    const audioAlertActive = current.audioAlert || (!current.audioHealthy && previous.audioAlert);
    let audioAlertStartedAt = previous.audioAlertStartedAt;
    let audioNotificationSent = previous.audioNotificationSent === true;
    if (!previous.audioAlert && current.audioAlert) {
      audioAlertStartedAt = observedAt - current.audioAlertDurationMs;
      audioNotificationSent = false;
    }
    if (current.audioAlert && !audioNotificationSent) {
      const duration = Math.max(
        current.audioAlertDurationMs,
        observedAt - (audioAlertStartedAt || observedAt)
      );
      if (duration >= this.minimumAudioAlertDurationMs) {
        this.enqueue(audioAlertEvent(identity, state, observedAt));
        audioNotificationSent = true;
      }
    } else if (previous.audioAlert && current.audioHealthy) {
      if (audioNotificationSent) {
        this.enqueue(audioRecoveryEvent(identity, state, audioAlertStartedAt || observedAt, observedAt));
      }
      audioAlertStartedAt = null;
      audioNotificationSent = false;
    }

    const cameraAlertActive = current.cameraAlert || (!current.cameraHealthy && previous.cameraAlert);
    let cameraAlertStartedAt = previous.cameraAlertStartedAt;
    let cameraNotificationSent = previous.cameraNotificationSent === true;
    if (!previous.cameraAlert && current.cameraAlert) {
      cameraAlertStartedAt = observedAt - current.cameraAlertDurationMs;
      cameraNotificationSent = false;
    }
    if (current.cameraAlert && !cameraNotificationSent) {
      const duration = Math.max(
        current.cameraAlertDurationMs,
        observedAt - (cameraAlertStartedAt || observedAt)
      );
      if (duration >= this.minimumCameraAlertDurationMs) {
        this.enqueue(cameraAlertEvent(identity, state, observedAt));
        cameraNotificationSent = true;
      }
    } else if (previous.cameraAlert && current.cameraHealthy) {
      if (cameraNotificationSent) {
        this.enqueue(cameraRecoveryEvent(identity, state, cameraAlertStartedAt || observedAt, observedAt));
      }
      cameraAlertStartedAt = null;
      cameraNotificationSent = false;
    }

    this.deviceStates.set(uuid, {
      ...current,
      audioAlert: audioAlertActive,
      cameraAlert: cameraAlertActive,
      audioAlertStartedAt,
      cameraAlertStartedAt,
      audioNotificationSent,
      cameraNotificationSent
    });
  }

  async sendStatusTest(device, state) {
    if (!this.enabled) {
      throw new Error(isValidWeComWebhook(this.webhookUrl)
        ? '企业微信通知当前已停用'
        : '服务器尚未配置企业微信机器人');
    }
    const payload = currentStatusPayload(device, state, this.clock());
    const operation = this.sendQueue.catch(() => undefined).then(() => this.sendWithRetry(payload));
    this.sendQueue = operation;
    const sent = await operation;
    if (!sent) throw new Error(this.lastError || '企业微信测试消息发送失败');
    return { ok: true, sentAt: this.lastSuccessAt };
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
    const payloads = textPayloads(events);
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
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    this.lastError = lastError instanceof Error ? lastError.message : String(lastError || 'send_failed');
    this.logger.warn?.(`[wecom] notification failed: ${this.lastError}`);
    return false;
  }
}

function notificationState(state) {
  const audio = state.audio && typeof state.audio === 'object' ? state.audio : {};
  const atem = state.atem && typeof state.atem === 'object' ? state.atem : {};
  const obs = state.obs && typeof state.obs === 'object' ? state.obs : {};
  const live = obs.liveActive === true || obs.streaming === true || obs.recording === true || obs.simulatedLive === true || obs.virtualCameraActive === true;
  const audioSilentForSeconds = wholeSeconds(audio.silentForSeconds);
  const reachedAudioThreshold = audioSilentForSeconds >= AUDIO_ALERT_SECONDS;
  const audioAlert = live
    && audio.ready === true
    && reachedAudioThreshold;
  const audioHealthy = live && audio.ready === true && !audioAlert;
  const cameraElapsedSeconds = wholeSeconds(atem.elapsedSeconds);
  const cameraExempt = atem.exempt === true;
  const cameraAlert = live
    && atem.connected === true
    && !cameraExempt
    && cameraElapsedSeconds >= CAMERA_ALERT_SECONDS;
  const cameraHealthy = live && atem.connected === true && !cameraAlert;
  return {
    live,
    audioAlert,
    audioHealthy,
    cameraAlert,
    cameraHealthy,
    audioAlertDurationMs: audioSilentForSeconds * 1000,
    cameraAlertDurationMs: cameraElapsedSeconds * 1000,
    audioAlertStartedAt: null,
    cameraAlertStartedAt: null,
    audioNotificationSent: false,
    cameraNotificationSent: false
  };
}

function audioAlertEvent(identity, state, occurredAt) {
  return {
    kind: 'audio_alert',
    tone: 'warning',
    title: '麦克风已静音 2 分钟',
    identity,
    occurredAt,
    detail: `音源：${cleanText(state.audio?.inputName, 100) || '目标音源'}`
  };
}

function audioRecoveryEvent(identity, state, startedAt, occurredAt) {
  return {
    kind: 'audio_recovery',
    tone: 'info',
    title: '麦克风声音已恢复',
    identity,
    occurredAt,
    detail: `音源：${cleanText(state.audio?.inputName, 100) || '目标音源'} · 静音约 ${durationText(occurredAt - startedAt)}`
  };
}

function cameraAlertEvent(identity, state, occurredAt) {
  const inputId = Number(state.atem?.programInput);
  const inputName = cleanText(state.atem?.inputLabels?.[inputId], 100) || (Number.isFinite(inputId) ? `机位 ${inputId}` : '当前机位');
  return {
    kind: 'camera_alert',
    tone: 'warning',
    title: '机位停留已达 10 分钟',
    identity,
    occurredAt,
    detail: `机位：${inputName}`
  };
}

function cameraRecoveryEvent(identity, state, startedAt, occurredAt) {
  const inputId = Number(state.atem?.programInput);
  const inputName = cleanText(state.atem?.inputLabels?.[inputId], 100) || (Number.isFinite(inputId) ? `机位 ${inputId}` : '当前机位');
  return {
    kind: 'camera_recovery',
    tone: 'info',
    title: '超时机位已切换',
    identity,
    occurredAt,
    detail: `当前：${inputName} · 上次超时约 ${durationText(occurredAt - startedAt)}`
  };
}

function currentStatusPayload(device, state, occurredAt) {
  const normalizedState = state && typeof state === 'object' ? state : {};
  const obs = normalizedState.obs && typeof normalizedState.obs === 'object' ? normalizedState.obs : {};
  const audio = normalizedState.audio && typeof normalizedState.audio === 'object' ? normalizedState.audio : {};
  const atem = normalizedState.atem && typeof normalizedState.atem === 'object' ? normalizedState.atem : {};
  const app = normalizedState.app && typeof normalizedState.app === 'object' ? normalizedState.app : {};
  const live = obs.liveActive === true || obs.streaming === true || obs.recording === true || obs.simulatedLive === true || obs.virtualCameraActive === true;
  const level = Number(audio.levelDb);
  const programInput = Number(atem.programInput);
  const programName = cleanText(atem.inputLabels?.[programInput], 100)
    || (Number.isFinite(programInput) && programInput > 0 ? `机位 ${programInput}` : '未读取机位');
  const roomName = cleanText(device?.roomName, 60) || '未命名直播间';
  const lines = [
    `【${roomName}】监控测试`,
    `${live ? '直播中' : '未开播'} · OBS ${obs.connected === true ? '正常' : '未连接'}`,
    `音频：${cleanText(audio.display, 80) || '等待数据'}${Number.isFinite(level) ? ` · ${level.toFixed(1)} dB` : ''}`,
    `机位：${atem.connected === true ? programName : 'ATEM 未连接'}`,
    `客户端：${cleanText(app.version, 32) ? `v${cleanText(app.version, 32)}` : '版本未知'} · ${formatTime(occurredAt)}`
  ];
  return {
    msgtype: 'text',
    text: {
      content: lines.join('\n')
    }
  };
}

function textPayloads(events) {
  const chunks = [];
  let chunkEvents = [];
  let chunkBytes = 0;

  for (const event of events) {
    const eventText = formatEventText(event, chunkEvents.length + 1);
    const nextBytes = Buffer.byteLength(`${chunkEvents.length ? '\n\n' : ''}${eventText}`, 'utf8');
    if (chunkEvents.length > 0 && chunkBytes + nextBytes > MAX_TEXT_BYTES) {
      chunks.push(chunkEvents);
      chunkEvents = [];
      chunkBytes = 0;
    }
    chunkEvents.push(event);
    chunkBytes += Buffer.byteLength(`${chunkEvents.length > 1 ? '\n\n' : ''}${formatEventText(event, chunkEvents.length)}`, 'utf8');
  }
  if (chunkEvents.length > 0) chunks.push(chunkEvents);

  return chunks.map((chunk) => {
    const content = chunk.map((event) => formatEventText(event)).join('\n\n');
    return {
      msgtype: 'text',
      text: {
        content
      }
    };
  });
}

function formatEventText(event) {
  return [
    `【${cleanText(event.identity.roomName, 60) || '未命名直播间'}】${cleanText(event.title, 80)}`,
    cleanText(event.detail, 180),
    `时间：${formatTime(event.occurredAt)}`
  ].join('\n');
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
