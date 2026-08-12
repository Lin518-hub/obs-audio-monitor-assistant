import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWeComNotifier,
  DEFAULT_WECOM_NOTIFICATION_SETTINGS,
  isValidWeComWebhook,
  normalizeWeComNotificationSettings
} from '../src/wecom-notifier.mjs';

const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key';

function desktopState({
  audioPhase = 'speaking',
  audioTone = 'safe',
  audioReady = true,
  audioSilentForSeconds = audioPhase === 'alert' ? 120 : 0,
  audioSilenceDurationSeconds = 120,
  cameraOverLimit = false,
  cameraConnected = true,
  cameraElapsedSeconds = cameraOverLimit ? 600 : 12,
  cameraExempt = false,
  streaming = true
} = {}) {
  return {
    audio: {
      phase: audioPhase,
      tone: audioTone,
      ready: audioReady,
      inputName: '麦克风/Aux',
      silentForSeconds: audioSilentForSeconds,
      silenceDurationSeconds: audioSilenceDurationSeconds
    },
    atem: {
      connected: cameraConnected,
      overLimit: cameraOverLimit,
      programInput: 2,
      inputLabels: { 2: '主播近景' },
      elapsedSeconds: cameraElapsedSeconds,
      exempt: cameraExempt
    },
    obs: { connected: true, streaming, recording: false }
  };
}

function successfulFetch(calls) {
  return async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ errcode: 0, errmsg: 'ok' }) };
  };
}

test('validates enterprise WeCom message push webhooks only', () => {
  assert.equal(isValidWeComWebhook(WEBHOOK), true);
  assert.equal(isValidWeComWebhook('https://example.com/cgi-bin/webhook/send?key=x'), false);
  assert.equal(isValidWeComWebhook('http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x'), false);
  assert.equal(isValidWeComWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send'), false);
});

test('normalizes persisted notification settings into supported ranges', () => {
  assert.deepEqual(normalizeWeComNotificationSettings(), DEFAULT_WECOM_NOTIFICATION_SETTINGS);
  assert.deepEqual(normalizeWeComNotificationSettings({
    enabled: false,
    audioEnabled: false,
    cameraEnabled: true,
    recoveryEnabled: false,
    audioAlertSeconds: 5,
    cameraAlertSeconds: 99_999
  }), {
    enabled: false,
    audioEnabled: false,
    cameraEnabled: true,
    recoveryEnabled: false,
    audioAlertSeconds: 30,
    cameraAlertSeconds: 3600
  });
});

test('supports disabling enterprise WeCom notifications for one room only', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000
  });
  const mutedDevice = {
    uuid: 'muted-room',
    label: '禁用通知电脑',
    roomName: '安静直播间',
    weComNotificationsEnabled: false
  };
  const activeDevice = {
    uuid: 'active-room',
    label: '正常通知电脑',
    roomName: '正常直播间',
    weComNotificationsEnabled: true
  };

  notifier.observeDevice(mutedDevice, desktopState({ audioPhase: 'alert', audioTone: 'danger' }));
  notifier.observeDevice(activeDevice, desktopState({ audioPhase: 'alert', audioTone: 'danger' }));
  await notifier.flushNow();
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].text.content, /安静直播间/);
  assert.match(calls[0].text.content, /正常直播间/);

  await assert.rejects(
    notifier.sendStatusTest(mutedDevice, desktopState()),
    /已关闭企业微信通知/
  );
});

test('forgets queued and active notification state when a device is removed', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000
  });
  const device = { uuid: 'reassigned-device', label: '旧电脑', roomName: '换机直播间' };

  notifier.observeDevice(device, desktopState({ audioPhase: 'alert', audioTone: 'danger' }));
  notifier.forgetDevice(device.uuid);
  await notifier.flushNow();
  assert.equal(calls.length, 0);

  notifier.observeDevice(device, desktopState());
  notifier.observeDevice(device, desktopState({ audioPhase: 'alert', audioTone: 'danger' }));
  await notifier.flushNow();
  assert.equal(calls.length, 1);
});

test('uses custom audio and camera push thresholds without changing client state', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000,
    settings: {
      audioAlertSeconds: 180,
      cameraAlertSeconds: 900
    }
  });
  const audioDevice = { uuid: 'custom-audio', label: '音频电脑', roomName: '自定义音频直播间' };
  const cameraDevice = { uuid: 'custom-camera', label: '导播电脑', roomName: '自定义机位直播间' };

  notifier.observeDevice(audioDevice, desktopState({
    audioPhase: 'alert', audioTone: 'danger', audioSilentForSeconds: 179
  }));
  notifier.observeDevice(cameraDevice, desktopState({
    cameraOverLimit: true, cameraElapsedSeconds: 899
  }));
  await notifier.flushNow();
  assert.equal(calls.length, 0);

  notifier.observeDevice(audioDevice, desktopState({
    audioPhase: 'alert', audioTone: 'danger', audioSilentForSeconds: 180
  }));
  notifier.observeDevice(cameraDevice, desktopState({
    cameraOverLimit: true, cameraElapsedSeconds: 900
  }));
  await notifier.flushNow();
  assert.equal(calls.length, 1);
  assert.match(calls[0].text.content, /麦克风已静音 3 分钟/);
  assert.match(calls[0].text.content, /机位停留已达 15 分钟/);
});

test('supports independent notification switches and optional recovery messages', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000,
    settings: {
      audioEnabled: false,
      cameraEnabled: true,
      recoveryEnabled: false,
      audioAlertSeconds: 30,
      cameraAlertSeconds: 60
    }
  });
  const device = { uuid: 'switches', label: '直播电脑', roomName: '开关测试直播间' };

  notifier.observeDevice(device, desktopState({
    audioPhase: 'alert', audioTone: 'danger', audioSilentForSeconds: 300,
    cameraOverLimit: true, cameraElapsedSeconds: 60
  }));
  await notifier.flushNow();
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].text.content, /麦克风/);
  assert.match(calls[0].text.content, /机位停留已达 1 分钟/);

  notifier.observeDevice(device, desktopState());
  await notifier.flushNow();
  assert.equal(calls.length, 1);
});

test('sends one alert and one recovery without repeating a steady state', async () => {
  const calls = [];
  let currentTime = 1_000_000;
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000,
    clock: () => currentTime
  });
  const device = { uuid: 'device-a', label: '导播电脑', roomName: '品牌一号直播间' };

  notifier.observeDevice(device, desktopState());
  notifier.observeDevice(device, desktopState({ audioPhase: 'alert', audioTone: 'danger' }));
  notifier.observeDevice(device, desktopState({ audioPhase: 'alert', audioTone: 'danger' }));
  await notifier.flushNow();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].msgtype, 'text');
  assert.equal(calls[0].text.mentioned_list, undefined);
  assert.equal(calls[0].text.content.split('\n')[0], '【品牌一号直播间】麦克风已静音 2 分钟');
  assert.match(calls[0].text.content, /音源：麦克风\/Aux/);

  currentTime += 20_000;
  notifier.observeDevice(device, desktopState());
  await notifier.flushNow();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].text.mentioned_list, undefined);
  assert.match(calls[1].text.content, /麦克风声音已恢复/);
});

test('uses the desktop silence threshold when an alert-state frame is missed', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000
  });
  const device = { uuid: 'device-threshold', label: '直播电脑', roomName: '阈值兜底直播间' };

  notifier.observeDevice(device, desktopState({
    audioPhase: 'silent',
    audioTone: 'warning',
    audioSilentForSeconds: 119
  }));
  notifier.observeDevice(device, desktopState({
    audioPhase: 'silent',
    audioTone: 'warning',
    audioSilentForSeconds: 120
  }));
  await notifier.flushNow();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].text.content.split('\n')[0], '【阈值兜底直播间】麦克风已静音 2 分钟');
  assert.match(calls[0].text.content, /音源：麦克风\/Aux/);
});

test('aggregates simultaneous room alerts into a single message', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000
  });

  notifier.observeDevice(
    { uuid: 'device-a', label: '音频电脑', roomName: '联合直播间' },
    desktopState({ audioPhase: 'alert', audioTone: 'danger' })
  );
  notifier.observeDevice(
    { uuid: 'device-b', label: '导播电脑', roomName: '联合直播间' },
    desktopState({ cameraOverLimit: true })
  );
  await notifier.flushNow();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].msgtype, 'text');
  assert.equal(calls[0].text.content.split('\n')[0], '【联合直播间】麦克风已静音 2 分钟');
  assert.match(calls[0].text.content, /机位停留已达 10 分钟/);
  assert.doesNotMatch(calls[0].text.content, /音频电脑|导播电脑/);
});

test('clears an active alert silently when the live session stops', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000
  });
  const device = { uuid: 'device-c', label: '直播电脑', roomName: '品牌二号直播间' };

  notifier.observeDevice(device, desktopState({ audioPhase: 'alert', audioTone: 'danger' }));
  await notifier.flushNow();
  notifier.observeDevice(device, desktopState({ audioPhase: 'alert', audioTone: 'danger', streaming: false }));
  notifier.observeDevice(device, desktopState());
  await notifier.flushNow();

  assert.equal(calls.length, 1);
  assert.match(calls[0].text.content, /麦克风已静音 2 分钟/);
});

test('sends an immediate current-status test message', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000,
    clock: () => 2_000_000
  });
  const state = desktopState();
  state.audio.display = '正在讲话';
  state.audio.levelDb = -23.4;
  state.app = { version: '3.9.1' };

  const result = await notifier.sendStatusTest(
    { uuid: 'device-status', label: '直播电脑', roomName: '测试直播间' },
    state
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].msgtype, 'text');
  assert.equal(calls[0].text.mentioned_list, undefined);
  assert.equal(calls[0].text.content.split('\n')[0], '【测试直播间】监控测试');
  assert.match(calls[0].text.content, /监控测试/);
  assert.match(calls[0].text.content, /音频：正在讲话 · -23.4 dB/);
  assert.match(calls[0].text.content, /v3.9.1/);
});

test('waits for ten minutes of continuous camera overstay before notifying', async () => {
  const calls = [];
  let currentTime = 10_000_000;
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000,
    clock: () => currentTime
  });
  const device = { uuid: 'device-delay', label: '直播电脑', roomName: '延迟测试直播间' };

  notifier.observeDevice(device, desktopState({
    cameraOverLimit: true,
    cameraElapsedSeconds: 599
  }));
  await notifier.flushNow();
  assert.equal(calls.length, 0);

  currentTime += 1000;
  notifier.observeDevice(device, desktopState({
    cameraOverLimit: true,
    cameraElapsedSeconds: 600
  }));
  await notifier.flushNow();
  assert.equal(calls.length, 1);
  assert.match(calls[0].text.content, /机位停留已达 10 分钟/);
});

test('does not send camera recovery when an overstay clears before ten minutes', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000
  });
  const device = { uuid: 'device-short', label: '直播电脑', roomName: '短暂异常直播间' };

  notifier.observeDevice(device, desktopState({
    cameraOverLimit: true,
    cameraElapsedSeconds: 300
  }));
  notifier.observeDevice(device, desktopState());
  await notifier.flushNow();

  assert.equal(calls.length, 0);
});

test('ignores a client-provided shorter audio threshold', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000
  });
  const device = { uuid: 'device-short-audio', label: '直播电脑', roomName: '统一阈值直播间' };

  notifier.observeDevice(device, desktopState({
    audioPhase: 'alert',
    audioTone: 'danger',
    audioSilentForSeconds: 60,
    audioSilenceDurationSeconds: 30
  }));
  await notifier.flushNow();
  assert.equal(calls.length, 0);

  notifier.observeDevice(device, desktopState({
    audioPhase: 'silent',
    audioTone: 'danger',
    audioSilentForSeconds: 120,
    audioSilenceDurationSeconds: 30
  }));
  await notifier.flushNow();
  assert.equal(calls.length, 1);
});

test('does not notify for an exempt on-camera input', async () => {
  const calls = [];
  const notifier = createWeComNotifier({
    webhookUrl: WEBHOOK,
    fetchImpl: successfulFetch(calls),
    batchDelayMs: 60_000
  });

  notifier.observeDevice(
    { uuid: 'device-exempt', label: '直播电脑', roomName: '出镜直播间' },
    desktopState({
      cameraOverLimit: true,
      cameraElapsedSeconds: 1200,
      cameraExempt: true
    })
  );
  await notifier.flushNow();

  assert.equal(calls.length, 0);
});
