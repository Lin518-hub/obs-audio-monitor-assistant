import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWeComNotifier, isValidWeComWebhook } from '../src/wecom-notifier.mjs';

const WEBHOOK = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-key';

function desktopState({
  audioPhase = 'speaking',
  audioTone = 'safe',
  audioReady = true,
  cameraOverLimit = false,
  cameraConnected = true,
  streaming = true
} = {}) {
  return {
    audio: {
      phase: audioPhase,
      tone: audioTone,
      ready: audioReady,
      inputName: '麦克风/Aux',
      silentForSeconds: audioPhase === 'alert' ? 120 : 0
    },
    atem: {
      connected: cameraConnected,
      overLimit: cameraOverLimit,
      programInput: 2,
      inputLabels: { 2: '主播近景' },
      elapsedSeconds: cameraOverLimit ? 600 : 12
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
  assert.match(calls[0].markdown.content, /品牌一号直播间/);
  assert.match(calls[0].markdown.content, /音频异常/);

  currentTime += 20_000;
  notifier.observeDevice(device, desktopState());
  await notifier.flushNow();
  assert.equal(calls.length, 2);
  assert.match(calls[1].markdown.content, /音频已恢复/);
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
  assert.match(calls[0].markdown.content, /音频异常/);
  assert.match(calls[0].markdown.content, /机位停留超时/);
  assert.match(calls[0].markdown.content, /音频电脑/);
  assert.match(calls[0].markdown.content, /导播电脑/);
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
  assert.match(calls[0].markdown.content, /音频异常/);
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
  assert.deepEqual(calls[0].text.mentioned_list, ['@all']);
  assert.match(calls[0].text.content, /当前状态发送成功/);
  assert.match(calls[0].text.content, /正在讲话 · -23.4 dB/);
  assert.match(calls[0].text.content, /v3.9.1/);
});
