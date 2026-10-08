import { setupChecks, workspaceTrialPassed } from '../../shared/setupReadiness';
import { PreflightCheckPage } from './PreflightCheckPage';
import { SetupVerification } from './SetupVerification';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Cable,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Mic2,
  Power,
  RefreshCw,
  TestTube2
} from 'lucide-react';
import type { AppConfig, AppSnapshot, TestConnectionResult } from '../../shared/types';
import { readableInputKind } from '../utils/status';

// =============================================================================
// 步骤定义
// =============================================================================
type StepKey = 'welcome' | 'connection' | 'source' | 'rules' | 'startup' | 'verify' | 'workspace' | 'complete';

interface StepDef {
  key: StepKey;
  label: string;
}

const STEPS: StepDef[] = [
  { key: 'welcome', label: '欢迎' },
  { key: 'connection', label: '连接' },
  { key: 'source', label: '音源' },
  { key: 'verify', label: '验证' },
  { key: 'rules', label: '规则' },
  { key: 'startup', label: '启动' },
  { key: 'workspace', label: '工作台' },
  { key: 'complete', label: '检查结果' }
];

const STEP_KEYS: StepKey[] = STEPS.map((s) => s.key);

// =============================================================================
// Props
// =============================================================================
interface OnboardingWizardProps {
  draft: AppConfig;
  snapshot: AppSnapshot;
  onUpdateDraft: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  onComplete: (ready: boolean) => Promise<void>;
  onTestConnection: () => void;
  onRefreshInputs: () => void;
  testResult: TestConnectionResult | null;
  testingConnection: boolean;
}

// =============================================================================
// 步骤条
// =============================================================================
const StepIndicator: React.FC<{ currentIndex: number }> = memo(({ currentIndex }) => (
  <nav className="onboarding-steps" aria-label="设置步骤">
    {STEPS.map((step, i) => (
      <React.Fragment key={step.key}>
        <div
          className={`onboarding-step-dot ${
            i === currentIndex ? 'current' : 'pending'
          }`}
          aria-current={i === currentIndex ? 'step' : undefined}
          aria-label={step.label}
          title={step.label}
        >
          {i + 1}
        </div>
        {i < STEPS.length - 1 && (
          <div className="onboarding-step-line pending" />
        )}
      </React.Fragment>
    ))}
  </nav>
));

// =============================================================================
// 步骤 1：欢迎
// =============================================================================
const WelcomeStep: React.FC<{ onNext: () => void }> = memo(({ onNext }) => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return (
    <>
      <div className="onboarding-card-body step-enter">
        <div className="onboarding-welcome">
          <div className="onboarding-logo">
            <Mic2 size={36} />
          </div>
          <div className="onboarding-welcome-blur">
            <h2>欢迎使用 OBS 音频检测助手</h2>
            <p className="welcome-sub">实时监测 OBS 直播中的麦克风与音频源，</p>
            <p className="welcome-sub">达到设定静音时间时提醒，帮助你及时发现音频异常。</p>
          </div>
        </div>
        {reducedMotion && (
          <div className="onboarding-motion-notice" role="status">
            <Clock size={17} />
            <span>
              <strong>系统当前关闭了界面动画</strong>
              Windows 可前往“设置 → 辅助功能 → 视觉效果”，开启“动画效果”；软件会自动跟随系统设置。
            </span>
          </div>
        )}
      </div>
      <div className="onboarding-card-footer">
        <span />
        <button type="button" className="btn-primary" onClick={onNext}>
          开始设置 <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
});

// =============================================================================
// 步骤 2：OBS WebSocket 连接
// =============================================================================
const ConnectionStep: React.FC<{
  draft: AppConfig;
  onUpdateDraft: OnboardingWizardProps['onUpdateDraft'];
  onTestConnection: () => void;
  testResult: TestConnectionResult | null;
  testingConnection: boolean;
}> = memo(({ draft, onUpdateDraft, onTestConnection, testResult, testingConnection }) => (
  <div className="onboarding-card-body step-enter">
    <div className="onboarding-step-title">
      <span className="step-icon"><Cable size={16} /></span>
      配置 OBS WebSocket 连接
    </div>
    <p className="onboarding-step-desc">
      先在 OBS 顶部菜单「工具」→「WebSocket 服务器设置」中启用服务器，然后填写以下信息。
    </p>

    <div className="onboarding-row">
      <div className="onboarding-field">
        <label>主机地址</label>
        <input
          className="onboarding-input"
          type="text"
          value={draft.obsHost}
          onChange={(e) => onUpdateDraft('obsHost', e.target.value)}
          placeholder="127.0.0.1"
        />
      </div>
      <div className="onboarding-field">
        <label>端口</label>
        <input
          className="onboarding-input"
          type="number"
          value={draft.obsPort}
          onChange={(e) => onUpdateDraft('obsPort', Number(e.target.value) || 4455)}
          placeholder="4455"
        />
      </div>
    </div>

    <div className="onboarding-field">
      <label>密码（OBS 未设置密码则留空）</label>
      <input
        className="onboarding-input"
        type="password"
        value={draft.obsPassword}
        onChange={(e) => onUpdateDraft('obsPassword', e.target.value)}
        placeholder="留空或输入 OBS WebSocket 密码"
      />
    </div>

    <div className="onboarding-test-row">
      <button
        type="button"
        className="btn-secondary"
        onClick={onTestConnection}
        disabled={testingConnection}
        style={{ minHeight: 36, padding: '0 16px', fontSize: 13 }}
      >
        <TestTube2 size={14} />
        {testingConnection ? '测试中…' : '测试连接'}
      </button>
      {testResult && (
        <span className={`onboarding-test-result ${testResult.ok ? 'ok' : 'bad'}`}>
          {testResult.ok ? <Check size={14} /> : <span>✕</span>}
          {testResult.message}
        </span>
      )}
    </div>
  </div>
));

// =============================================================================
// 步骤 3：选择音源
// =============================================================================
const SourceStep: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  onUpdateDraft: OnboardingWizardProps['onUpdateDraft'];
  onRefreshInputs: () => void;
}> = memo(({ draft, snapshot, onUpdateDraft, onRefreshInputs }) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const selected = snapshot.inputs.find((i) => i.inputName === draft.targetInputName);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="onboarding-card-body step-enter">
      <div className="onboarding-step-title">
        <span className="step-icon"><Mic2 size={16} /></span>
        选择要守护的音频源
      </div>
      <p className="onboarding-step-desc">
        选择主播麦克风、无线麦、声卡输入或直播主混音。图片、文字、显示器采集等无声音源已自动过滤。
      </p>

      <div className="onboarding-source-area">
        <button
          ref={triggerRef}
          type="button"
          className="onboarding-source-trigger"
          onClick={() => setOpen((v) => !v)}
        >
          <Mic2 size={18} className="src-icon" />
          <span className="src-label">
            <span className="src-name">{selected?.inputName || '选择可能有声音的 OBS 音源'}</span>
            <span className="src-hint">
              {selected
                ? readableInputKind(selected.inputKind)
                : snapshot.inputs.length > 0
                  ? `${snapshot.inputs.length} 个可检测音源`
                  : '请先连接 OBS 或刷新音源'}
            </span>
          </span>
          <ChevronDown size={16} style={{ transition: 'transform 200ms', transform: open ? 'rotate(180deg)' : undefined }} />
        </button>

        {open && (
          <div ref={menuRef} className="onboarding-source-list">
            {snapshot.inputs.length === 0 ? (
              <div className="onboarding-source-empty">
                没有可选音频源<br />
                <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>请确保 OBS 已连接并刷新音源列表</span>
              </div>
            ) : (
              snapshot.inputs.map((input) => (
                <button
                  key={`${input.inputKind}:${input.inputName}`}
                  type="button"
                  className={`onboarding-source-option ${input.inputName === draft.targetInputName ? 'active' : ''}`}
                  onClick={() => {
                    onUpdateDraft('targetInputName', input.inputName);
                    onUpdateDraft('targetInputNames', [input.inputName]);
                    setOpen(false);
                  }}
                >
                  <Mic2 size={14} />
                  <span style={{ flex: 1 }}>{input.inputName}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{readableInputKind(input.inputKind)}</span>
                  {input.inputName === draft.targetInputName && <Check size={14} color="var(--green-600)" />}
                </button>
              ))
            )}
          </div>
        )}

        <button
          type="button"
          className="btn-secondary"
          onClick={onRefreshInputs}
          style={{ minHeight: 36, padding: '0 16px', fontSize: 13, alignSelf: 'flex-start' }}
        >
          <RefreshCw size={14} /> 重新读取 OBS 音源
        </button>
      </div>
    </div>
  );
});

// =============================================================================
// 步骤 4：报警规则
// =============================================================================
const RulesStep: React.FC<{
  draft: AppConfig;
  onUpdateDraft: OnboardingWizardProps['onUpdateDraft'];
}> = memo(({ draft, onUpdateDraft }) => (
  <div className="onboarding-card-body step-enter">
    <div className="onboarding-step-title">
      <span className="step-icon"><Clock size={16} /></span>
      配置报警规则
    </div>
    <p className="onboarding-step-desc">
      音频连续静音 2 分钟后统一报警。你只需要根据现场环境调整静音阈值。
    </p>

    <div className="onboarding-field">
      <label>连续静音报警时长</label>
      <div className="onboarding-number-field">
        <span className="nf-value">120</span>
        <span className="nf-unit">秒 · 已统一</span>
      </div>
    </div>

    <div className="onboarding-field">
      <label>静音阈值（低于此 dB 值视为静音）</label>
      <div className="onboarding-slider">
        <div className="onboarding-slider-header">
          <span className="slider-value">{draft.silenceThresholdDb}</span>
          <span className="slider-unit">dB</span>
        </div>
        <input
          type="range" min={-90} max={-10} step={1}
          value={draft.silenceThresholdDb}
          onChange={(e) => onUpdateDraft('silenceThresholdDb', Number(e.target.value))}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>-90 dB（更敏感）</span>
          <span>-10 dB</span>
        </div>
      </div>
    </div>

    <div className="onboarding-toggle">
      <div>
        <div className="toggle-label">预警提醒</div>
        <div className="toggle-hint">
          在达到报警时长的 {Math.round((draft.preAlertRatio ?? 0.75) * 100)}% 时先弹出黄牌预警
        </div>
      </div>
      <button
        type="button"
        className={`onboarding-switch ${draft.preAlertEnabled ? 'on' : ''}`}
        onClick={() => onUpdateDraft('preAlertEnabled', !draft.preAlertEnabled)}
        role="switch"
        aria-checked={draft.preAlertEnabled}
      />
    </div>
  </div>
));

// =============================================================================
// 步骤 5：开机与后台
// =============================================================================
const StartupStep: React.FC<{
  draft: AppConfig;
  onUpdateDraft: OnboardingWizardProps['onUpdateDraft'];
}> = memo(({ draft, onUpdateDraft }) => (
  <div className="onboarding-card-body step-enter">
    <div className="onboarding-step-title">
      <span className="step-icon"><Power size={16} /></span>
      设置开机启动
    </div>
    <p className="onboarding-step-desc">
      直播工作站建议开机后自动进入“一键开播检查”。关闭主窗口后，助手仍会保留在系统托盘中继续检测。
    </p>

    <div className="onboarding-toggle">
      <div>
        <div className="toggle-label">开机自动启动助手</div>
        <div className="toggle-hint">
          Windows 登录后快速打开助手，并直接显示一键开播检查页面
        </div>
      </div>
      <button
        type="button"
        className={`onboarding-switch ${draft.autoLaunch ? 'on' : ''}`}
        onClick={() => onUpdateDraft('autoLaunch', !draft.autoLaunch)}
        role="switch"
        aria-checked={draft.autoLaunch}
      />
    </div>
  </div>
));

// =============================================================================
// 步骤 6：完成
// =============================================================================
// =============================================================================
// 步骤内容渲染器（按 stepKey 路由到对应组件）
// =============================================================================
const StepContent: React.FC<{
  stepKey: StepKey;
  draft: AppConfig;
  snapshot: AppSnapshot;
  onUpdateDraft: OnboardingWizardProps['onUpdateDraft'];
  onTestConnection: () => void;
  onRefreshInputs: () => void;
  testResult: TestConnectionResult | null;
  testingConnection: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  isLast: boolean;
}> = memo(({ stepKey, draft, snapshot, onUpdateDraft, onTestConnection, onRefreshInputs, testResult, testingConnection, onNext, onPrev, onSkip, isLast }) => {
  // 用 key 触发 step-enter 动画，但 card 本身不 remount
  const contentKey = `step-body-${stepKey}`;

  switch (stepKey) {
    case 'welcome':
      return <WelcomeStep key={contentKey} onNext={onNext} />;

    case 'connection':
      return (
        <React.Fragment key={contentKey}>
          <ConnectionStep draft={draft} onUpdateDraft={onUpdateDraft} onTestConnection={onTestConnection} testResult={testResult} testingConnection={testingConnection} />
          <div className="onboarding-card-footer">
            <button type="button" className="btn-ghost" onClick={onSkip}>稍后配置</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={onPrev}><ChevronLeft size={16} /> 上一步</button>
              <button type="button" className="btn-primary" onClick={onNext}>下一步 <ChevronRight size={16} /></button>
            </div>
          </div>
        </React.Fragment>
      );

    case 'source':
      return (
        <React.Fragment key={contentKey}>
          <SourceStep draft={draft} snapshot={snapshot} onUpdateDraft={onUpdateDraft} onRefreshInputs={onRefreshInputs} />
          <div className="onboarding-card-footer">
            <button type="button" className="btn-ghost" onClick={onSkip}>稍后配置</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={onPrev}><ChevronLeft size={16} /> 上一步</button>
              <button type="button" className="btn-primary" onClick={onNext}>下一步 <ChevronRight size={16} /></button>
            </div>
          </div>
        </React.Fragment>
      );

    case 'rules':
      return (
        <React.Fragment key={contentKey}>
          <RulesStep draft={draft} onUpdateDraft={onUpdateDraft} />
          <div className="onboarding-card-footer">
            <button type="button" className="btn-ghost" onClick={onSkip}>稍后配置</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={onPrev}><ChevronLeft size={16} /> 上一步</button>
              <button type="button" className="btn-primary" onClick={onNext}>下一步 <ChevronRight size={16} /></button>
            </div>
          </div>
        </React.Fragment>
      );

    case 'startup':
      return (
        <React.Fragment key={contentKey}>
          <StartupStep draft={draft} onUpdateDraft={onUpdateDraft} />
          <div className="onboarding-card-footer">
            <button type="button" className="btn-ghost" onClick={onSkip}>稍后配置</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={onPrev}><ChevronLeft size={16} /> 上一步</button>
              <button type="button" className="btn-primary" onClick={onNext}>下一步 <ChevronRight size={16} /></button>
            </div>
          </div>
        </React.Fragment>
      );

    case 'complete':
    case 'verify':
    case 'workspace':
      return null;
  }
});

// =============================================================================
// OnboardingWizard 主组件
// =============================================================================
const OnboardingWizardComponent: React.FC<OnboardingWizardProps> = (props) => {
  const { draft, snapshot, onUpdateDraft, onComplete, onTestConnection, onRefreshInputs, testResult, testingConnection } = props;

  const [verifiedSource, setVerifiedSource] = useState('');
  const [alertConfirmed, setAlertConfirmed] = useState(false);
  const [trialPassed, setTrialPassed] = useState(false);
  const [workspaceSkipped, setWorkspaceSkipped] = useState(false);
  useEffect(() => { setVerifiedSource(''); setTrialPassed(false); }, [draft.obsHost, draft.obsPort, draft.obsPassword, draft.targetInputName, draft.silenceThresholdDb]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const checks = setupChecks(draft, snapshot, verifiedSource, alertConfirmed, trialPassed, workspaceSkipped);
  const ready = checks.every(check => check.ready);
  const finish = async () => {
    if (saving) return;
    setSaving(true); setSaveError('');
    try { await onComplete(ready); }
    catch { setSaveError('保存配置失败，请重试；当前步骤和输入已保留。'); }
    finally { setSaving(false); }
  };
  const [stepIndex, setStepIndex] = useState(0);
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>('forward');
  const currentKey = STEP_KEYS[stepIndex];
  const isLast = stepIndex === STEP_KEYS.length - 1;

  const goNext = useCallback(() => {
    if (isLast) {
      setStepIndex(STEP_KEYS.length - 1);
    } else {
      setStepDirection('forward');
      setStepIndex((i) => Math.min(i + 1, STEP_KEYS.length - 1));
    }
  }, [isLast, onComplete]);

  const goPrev = useCallback(() => {
    setStepDirection('backward');
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  const handleSkip = useCallback(() => {
    setStepIndex(STEP_KEYS.length - 1);
  }, []);

  return (
    <div className="onboarding-root" role="dialog" aria-modal="true" aria-label="首次设置引导">
      <StepIndicator currentIndex={stepIndex} />

      {/* 卡片 key 稳定，不随步骤切换 remount */}
      <div className={`onboarding-card ${currentKey === "workspace" ? "onboarding-workspace" : ""}`} data-step-direction={stepDirection}>
        {currentKey === 'verify' ? <><SetupVerification draft={draft} snapshot={snapshot} verifiedSource={verifiedSource} onVerified={setVerifiedSource} confirmed={alertConfirmed} onConfirmed={() => setAlertConfirmed(true)} /><div className="onboarding-card-footer"><button className="btn-secondary" onClick={goPrev}>上一步</button><button className="btn-primary" onClick={goNext}>{checks.find(c => c.step === 'verify')?.ready ? '验证完成，下一步' : '稍后验证，下一步'}</button></div></>
        : currentKey === 'workspace' ? <><div className="onboarding-card-body"><div className="onboarding-step-title"><h2>配置开播工作台</h2></div><p className="onboarding-step-desc">选择要打开的软件，按需保存窗口位置。只做音频检测可跳过此步骤。</p><PreflightCheckPage draft={draft} search="" onChange={(key, value) => { setWorkspaceSkipped(false); setTrialPassed(false); onUpdateDraft(key, value); }} onTrialResult={result => { setWorkspaceSkipped(false); setTrialPassed(workspaceTrialPassed(draft, result)); }} /><p role="status">{trialPassed ? '工作台试运行通过' : '尚未通过试运行；请确认每个已选软件有启动路径，并检查逐项结果。位置保存不是必选项。'}</p></div><div className="onboarding-card-footer"><button className="btn-secondary" onClick={goPrev}>上一步</button><button className="btn-secondary" onClick={() => { setWorkspaceSkipped(true); goNext(); }}>仅使用音频检测</button><button className="btn-primary" onClick={goNext}>查看配置结果</button></div></>
        : currentKey === 'complete' ? <><div className="onboarding-card-body"><h2>{ready ? '首次配置验证通过' : '配置尚未验证完成'}</h2><p>工作台准备、音频检测和 OBS 推流是独立状态；完成设置不会自动推流。</p><ul className="setup-checklist">{checks.map(check => <li key={check.step}><span>{check.ready ? '✓' : '待完成'} · {check.label}</span>{!check.ready && <button className="btn-secondary" onClick={() => setStepIndex(STEP_KEYS.indexOf(check.step as StepKey))}>前往处理</button>}</li>)}</ul><p>当前：OBS {snapshot.connected ? '已连接' : '未连接'} · 检测{snapshot.monitoringActive ? '进行中' : '未开启'} · {snapshot.streaming ? '正在推流' : '尚未推流'}</p>{saveError && <p role="alert">{saveError}</p>}</div><div className="onboarding-card-footer"><button className="btn-secondary" disabled={saving} onClick={goPrev}>上一步</button><button className="btn-primary" disabled={saving} onClick={() => void finish()}>{saving ? '正在保存…' : ready ? '完成并进入主界面' : '暂存并进入主界面'}</button></div></>
        : <StepContent
          stepKey={currentKey}
          draft={draft}
          snapshot={snapshot}
          onUpdateDraft={onUpdateDraft}
          onTestConnection={onTestConnection}
          onRefreshInputs={onRefreshInputs}
          testResult={testResult}
          testingConnection={testingConnection}
          onNext={goNext}
          onPrev={goPrev}
          onSkip={handleSkip}
          isLast={isLast}
        />}
      </div>
    </div>
  );
};

export const OnboardingWizard = memo(OnboardingWizardComponent, (previous, next) => (
  previous.draft === next.draft &&
  previous.snapshot.connected === next.snapshot.connected &&
  previous.snapshot.inputs === next.snapshot.inputs &&
  previous.snapshot.lastLevelDb === next.snapshot.lastLevelDb &&
  previous.snapshot.lastAudioMeterReceivedAt === next.snapshot.lastAudioMeterReceivedAt &&
  previous.snapshot.activeInputName === next.snapshot.activeInputName &&
  previous.snapshot.monitoringActive === next.snapshot.monitoringActive &&
  previous.snapshot.streaming === next.snapshot.streaming &&
  previous.onUpdateDraft === next.onUpdateDraft &&
  previous.onComplete === next.onComplete &&
  previous.onTestConnection === next.onTestConnection &&
  previous.onRefreshInputs === next.onRefreshInputs &&
  previous.testResult === next.testResult &&
  previous.testingConnection === next.testingConnection
));
