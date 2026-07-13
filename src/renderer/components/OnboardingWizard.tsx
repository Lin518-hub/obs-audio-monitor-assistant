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
  RefreshCw,
  ShieldCheck,
  TestTube2
} from 'lucide-react';
import type { AppConfig, AppSnapshot, TestConnectionResult } from '../../shared/types';
import { readableInputKind } from '../utils/status';

// =============================================================================
// 步骤定义
// =============================================================================
type StepKey = 'welcome' | 'connection' | 'source' | 'rules' | 'complete';

interface StepDef {
  key: StepKey;
  label: string;
}

const STEPS: StepDef[] = [
  { key: 'welcome', label: '欢迎' },
  { key: 'connection', label: '连接' },
  { key: 'source', label: '音源' },
  { key: 'rules', label: '规则' },
  { key: 'complete', label: '完成' }
];

const STEP_KEYS: StepKey[] = STEPS.map((s) => s.key);

// =============================================================================
// Props
// =============================================================================
interface OnboardingWizardProps {
  draft: AppConfig;
  snapshot: AppSnapshot;
  onUpdateDraft: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
  onComplete: () => void;
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
            i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'pending'
          }`}
          aria-current={i === currentIndex ? 'step' : undefined}
        >
          {i < currentIndex ? <Check size={16} /> : i + 1}
        </div>
        {i < STEPS.length - 1 && (
          <div className={`onboarding-step-line ${i < currentIndex ? 'done' : 'pending'}`} />
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
            <p className="welcome-sub">在静音或掉线时立即弹窗报警，守护每一场直播。</p>
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
      设置静音检测的持续时长和音量阈值。口播密集可缩短时长，访谈或活动直播可适当延长。
    </p>

    <div className="onboarding-field">
      <label>连续静音报警时长（秒）</label>
      <div className="onboarding-number-field">
        <button type="button" onClick={() => onUpdateDraft('silenceDurationSeconds', Math.max(10, draft.silenceDurationSeconds - 10))}>−</button>
        <span className="nf-value">{draft.silenceDurationSeconds}</span>
        <span className="nf-unit">秒</span>
        <button type="button" onClick={() => onUpdateDraft('silenceDurationSeconds', Math.min(600, draft.silenceDurationSeconds + 10))}>+</button>
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
// 步骤 5：完成
// =============================================================================
const CompleteStep: React.FC<{
  draft: AppConfig;
  snapshot: AppSnapshot;
  testResult: TestConnectionResult | null;
}> = memo(({ draft, snapshot, testResult }) => {
  const connected = testResult?.ok ?? snapshot.connected;
  const sourceLabel = draft.targetInputName || '未选择';

  return (
    <div className="onboarding-card-body step-enter">
      <div className="onboarding-complete">
        <div className="onboarding-complete-check">
          <Check size={40} strokeWidth={3} />
        </div>
        <h2>设置完成！</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
          你的 OBS 音频检测助手已配置完毕，以下是你的设置摘要：
        </p>
        <div className="complete-summary">
          <div className="summary-row">
            <span className="sr-label">OBS 连接</span>
            <span className="sr-value" style={{ color: connected ? 'var(--green-600)' : 'var(--red-text)' }}>
              {connected ? '已连接' : '未连接'}
            </span>
          </div>
          <div className="summary-row">
            <span className="sr-label">守护音源</span>
            <span className="sr-value">{sourceLabel}</span>
          </div>
          <div className="summary-row">
            <span className="sr-label">静音报警</span>
            <span className="sr-value">{draft.silenceDurationSeconds} 秒</span>
          </div>
          <div className="summary-row">
            <span className="sr-label">静音阈值</span>
            <span className="sr-value">{draft.silenceThresholdDb} dB</span>
          </div>
          <div className="summary-row">
            <span className="sr-label">预警提醒</span>
            <span className="sr-value">{draft.preAlertEnabled ? '已开启' : '已关闭'}</span>
          </div>
        </div>
      </div>
    </div>
  );
});

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
            <button type="button" className="btn-ghost" onClick={onSkip}>跳过全部</button>
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
            <button type="button" className="btn-ghost" onClick={onSkip}>跳过全部</button>
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
            <button type="button" className="btn-ghost" onClick={onSkip}>跳过全部</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={onPrev}><ChevronLeft size={16} /> 上一步</button>
              <button type="button" className="btn-primary" onClick={onNext}>下一步 <ChevronRight size={16} /></button>
            </div>
          </div>
        </React.Fragment>
      );

    case 'complete':
      return (
        <React.Fragment key={contentKey}>
          <CompleteStep draft={draft} snapshot={snapshot} testResult={testResult} />
          <div className="onboarding-card-footer">
            <button type="button" className="btn-secondary" onClick={onPrev}><ChevronLeft size={16} /> 上一步</button>
            <button type="button" className="btn-primary" onClick={onNext}><ShieldCheck size={16} /> 开始使用</button>
          </div>
        </React.Fragment>
      );
  }
});

// =============================================================================
// OnboardingWizard 主组件
// =============================================================================
const OnboardingWizardComponent: React.FC<OnboardingWizardProps> = (props) => {
  const { draft, snapshot, onUpdateDraft, onComplete, onTestConnection, onRefreshInputs, testResult, testingConnection } = props;

  const [stepIndex, setStepIndex] = useState(0);
  const [stepDirection, setStepDirection] = useState<'forward' | 'backward'>('forward');
  const currentKey = STEP_KEYS[stepIndex];
  const isLast = stepIndex === STEP_KEYS.length - 1;

  const goNext = useCallback(() => {
    if (isLast) {
      onComplete();
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
    onComplete();
  }, [onComplete]);

  // 阻止滚轮穿透
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    window.addEventListener('wheel', block, { capture: true, passive: false });
    window.addEventListener('touchmove', block, { capture: true, passive: false });
    return () => {
      window.removeEventListener('wheel', block, { capture: true });
      window.removeEventListener('touchmove', block, { capture: true });
    };
  }, []);

  return (
    <div className="onboarding-root" role="dialog" aria-modal="true" aria-label="首次设置引导">
      <StepIndicator currentIndex={stepIndex} />

      {/* 卡片 key 稳定，不随步骤切换 remount */}
      <div className="onboarding-card" data-step-direction={stepDirection}>
        <StepContent
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
        />
      </div>
    </div>
  );
};

export const OnboardingWizard = memo(OnboardingWizardComponent, (previous, next) => (
  previous.draft === next.draft &&
  previous.snapshot.connected === next.snapshot.connected &&
  previous.snapshot.inputs === next.snapshot.inputs &&
  previous.onUpdateDraft === next.onUpdateDraft &&
  previous.onComplete === next.onComplete &&
  previous.onTestConnection === next.onTestConnection &&
  previous.onRefreshInputs === next.onRefreshInputs &&
  previous.testResult === next.testResult &&
  previous.testingConnection === next.testingConnection
));
