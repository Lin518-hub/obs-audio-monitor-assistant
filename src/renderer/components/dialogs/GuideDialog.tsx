import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, SlidersHorizontal, TestTube2, X } from 'lucide-react';
import type { TestConnectionResult } from '../../../shared/types';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
const roundPixel = (v: number) => Math.round(v);
const easeGuide = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface GuideStep {
  target: string;
  title: string;
  body: string;
  action?: 'test' | 'openDiagnostics';
  openDrawer?: 'connection' | 'source' | 'rules' | 'diagnostics' | 'system';
  /** 当 openDrawer 设置时,需要 main 流程打开 settings panel + 滚动到该 section */
}

const clamp2 = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

interface GuideLayout {
  rect: { left: number; top: number; width: number; height: number; right: number; bottom: number };
  card: { left: number; top: number; width: number };
}

export const GuideDialog: React.FC<{
  onClose: () => void;
  onTestConnection: () => void;
  onSetDiagnostics: () => void;
  onOpenDrawer?: (section: 'connection' | 'source' | 'rules' | 'diagnostics' | 'system') => void;
  testResult: TestConnectionResult | null;
  testingConnection: boolean;
}> = ({ onClose, onTestConnection, onSetDiagnostics, onOpenDrawer, testResult, testingConnection }) => {
  const steps = useMemo<GuideStep[]>(
    () => [
      { target: 'overview', title: '先看顶部状态横幅', body: '这里显示当前是否安全。直播中先看这一块:OBS 是否连接、是否检测中、是否静音预警或报警。' },
      { target: 'settings-connection', title: '第一步:打开 OBS 的 WebSocket', body: '打开 OBS,在顶部菜单进入"工具"里的"WebSocket 服务器设置",勾选启用服务器。OBS 28 以后通常自带这个功能。', openDrawer: 'connection' },
      { target: 'settings-connection', title: '第二步:填写端口和密码', body: '主机一般保持 127.0.0.1,默认端口通常是 4455。OBS 设置了密码时,把同一个密码填到这里。', action: 'test', openDrawer: 'connection' },
      { target: 'settings-diagnostics', title: '第三步:测试 OBS 是否连上', body: '进入设置 → 维护工具，展开“检测与调试”并点击“测试 OBS 连接”。成功后软件就能读取 OBS 音源列表。', action: 'openDiagnostics', openDrawer: 'diagnostics' },
      { target: 'settings-source', title: '第四步:选择要守护的音源', body: '选择主播麦克风、无线麦、声卡输入或直播主混音。图片、文字、显示器采集等无声音源会被过滤。', openDrawer: 'source' },
      { target: 'settings-rules', title: '第五步:设置报警规则', body: '默认连续静音 120 秒报警,90 秒先预警。口播密集可以缩短,访谈或活动直播可以适当延长。', openDrawer: 'rules' },
      { target: 'meter', title: '第六步:不开播也能测试', body: 'OBS 已连接但还没开播时，可以在“维护工具”的“检测与调试”中打开“模拟开播检测”，测试电平、静音计时和报警弹窗。' },
      { target: 'settings-system', title: '第七步:按需要开启自启动', body: '固定直播电脑建议开启。下次开机后会打开助手；开发者模式下会直接进入一键开播检查。', openDrawer: 'system' },
      { target: 'meter', title: '第八步:直播中常用大电平表', body: '中栏中间的大电平表显示实时 dB 与距离报警的倒计时。静音阈值可在电平表上拖动调节。' },
      { target: 'connection-status', title: '最后:窗口关闭后仍在后台运行', body: '关闭主窗口只是隐藏到后台,检测仍会继续。需要完全退出时,从托盘或菜单栏选择"退出"。' }
    ],
    []
  );

  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const [layoutReady, setLayoutReady] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const lastLayoutRef = useRef<GuideLayout | null>(null);
  const stepRef = useRef<GuideStep>(step);
  stepRef.current = step;

  useEffect(() => {
    if (step.action === 'openDiagnostics') {
      onSetDiagnostics();
    }
    if (step.openDrawer && onOpenDrawer) {
      onOpenDrawer(step.openDrawer);
    }
  }, [step, onSetDiagnostics, onOpenDrawer]);

  useEffect(() => {
    document.documentElement.dataset.guideActive = 'true';
    const block = (e: Event) => e.preventDefault();
    const blockKeys = (e: KeyboardEvent) => {
      if ([' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp'].includes(e.key)) e.preventDefault();
    };
    window.addEventListener('wheel', block, { capture: true, passive: false });
    window.addEventListener('touchmove', block, { capture: true, passive: false });
    window.addEventListener('keydown', blockKeys, { capture: true });
    return () => {
      delete document.documentElement.dataset.guideActive;
      window.removeEventListener('wheel', block, { capture: true });
      window.removeEventListener('touchmove', block, { capture: true });
      window.removeEventListener('keydown', blockKeys, { capture: true });
    };
  }, []);

  useLayoutEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-guide]'));
    targets.forEach((t) => t.classList.remove('guide-active-target'));
    const target = document.querySelector<HTMLElement>(`[data-guide="${step.target}"]`);
    let disposed = false;
    let scrollRaf = 0;
    let layoutRaf = 0;
    const timers: number[] = [];
    let ro: ResizeObserver | null = null;

    const scrollContainer: HTMLElement | Window = (() => {
      const shell = document.querySelector<HTMLElement>('.app-shell');
      if (shell && shell.scrollHeight > shell.clientHeight) return shell;
      return window;
    })();

    const getScrollY = () => scrollContainer === window ? window.scrollY : (scrollContainer as HTMLElement).scrollTop;
    const setScrollY = (y: number) => {
      if (scrollContainer === window) window.scrollTo(0, y);
      else (scrollContainer as HTMLElement).scrollTop = y;
    };
    const getMaxScrollY = () => scrollContainer === window
      ? Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
      : Math.max(0, (scrollContainer as HTMLElement).scrollHeight - (scrollContainer as HTMLElement).clientHeight);

    const applyLayout = (next: GuideLayout) => {
      const spotlight = spotlightRef.current;
      const card = cardRef.current;
      if (spotlight) {
        spotlight.style.transform = `translate3d(${next.rect.left}px, ${next.rect.top}px, 0)`;
        spotlight.style.width = `${next.rect.right - next.rect.left}px`;
        spotlight.style.height = `${next.rect.bottom - next.rect.top}px`;
      }
      if (card) {
        card.style.transform = `translate3d(${next.card.left}px, ${next.card.top}px, 0)`;
        card.style.width = `${next.card.width}px`;
      }
    };

    const calculateLayout = (): GuideLayout | null => {
      if (disposed || !target) return null;
      const tr = target.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const margin = 24, pad = 8, gap = 18;
      const cardWidth = clamp2(360, 0, vw - margin * 2);
      const cardHeight = clamp2(cardRef.current?.offsetHeight || 240, 0, vh - margin * 2);
      const rect = {
        left: roundPixel(clamp(tr.left - pad, margin / 2, vw - margin / 2)),
        top: roundPixel(clamp(tr.top - pad, margin / 2, vh - margin / 2)),
        width: roundPixel(Math.min(tr.width + pad * 2, vw - margin)),
        height: roundPixel(Math.min(tr.height + pad * 2, vh - margin)),
        right: 0, bottom: 0
      };
      rect.right = roundPixel(Math.min(rect.left + rect.width, vw - margin / 2));
      rect.bottom = roundPixel(Math.min(rect.top + rect.height, vh - margin / 2));
      const maxLeft = Math.max(margin, vw - cardWidth - margin);
      const maxTop = Math.max(margin, vh - cardHeight - margin);
      const candidates = [
        { l: rect.right + gap, t: rect.top },
        { l: rect.left - cardWidth - gap, t: rect.top },
        { l: rect.left, t: rect.bottom + gap },
        { l: rect.left, t: rect.top - cardHeight - gap }
      ].map((p) => ({ left: clamp(p.l, margin, maxLeft), top: clamp(p.t, margin, maxTop) }));
      const card = { left: roundPixel(candidates[0].left), top: roundPixel(candidates[0].top), width: roundPixel(cardWidth) };
      return { rect, card };
    };

    const updateLayout = (ready = false) => {
      const next = calculateLayout();
      if (!next) return;
      lastLayoutRef.current = next;
      applyLayout(next);
      if (ready) setLayoutReady(true);
    };

    const scheduleLayout = () => {
      if (layoutRaf || disposed) return;
      layoutRaf = window.requestAnimationFrame(() => {
        layoutRaf = 0;
        updateLayout();
      });
    };

    const animate = () => {
      if (!target) return;
      const tr = target.getBoundingClientRect();
      const startY = getScrollY();
      const max = getMaxScrollY();
      const desiredY = clamp(tr.top + startY - (window.innerHeight - Math.min(tr.height, window.innerHeight * 0.52)) / 2, 0, max);
      const dist = Math.abs(desiredY - startY);
      if (dist < 4) { updateLayout(); return; }
      const duration = Math.min(680, Math.max(360, dist * 0.72));
      const startedAt = performance.now();
      const tick = (now: number) => {
        if (disposed) return;
        const p = clamp((now - startedAt) / duration, 0, 1);
        setScrollY(startY + (desiredY - startY) * easeGuide(p));
        updateLayout();
        if (p < 1) scrollRaf = window.requestAnimationFrame(tick);
        else { setScrollY(desiredY); updateLayout(); }
      };
      scrollRaf = window.requestAnimationFrame(tick);
    };

    target?.classList.add('guide-active-target');
    updateLayout(true);
    overlayRef.current?.classList.add('is-tracking');
    animate();
    timers.push(window.setTimeout(scheduleLayout, 120));
    timers.push(window.setTimeout(scheduleLayout, 300));
    if (target) {
      ro = new ResizeObserver(scheduleLayout);
      ro.observe(target);
    }
    window.addEventListener('resize', scheduleLayout);
    scrollContainer.addEventListener('scroll', scheduleLayout, { capture: true, passive: true });

    return () => {
      disposed = true;
      ro?.disconnect();
      window.cancelAnimationFrame(scrollRaf);
      window.cancelAnimationFrame(layoutRaf);
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', scheduleLayout);
      scrollContainer.removeEventListener('scroll', scheduleLayout, { capture: true });
      overlayRef.current?.classList.remove('is-tracking');
      targets.forEach((t) => t.classList.remove('guide-active-target'));
      target?.classList.remove('guide-active-target');
    };
  }, [step.target]);

  return (
    <div ref={overlayRef} className={`guide-overlay ${layoutReady ? 'is-ready' : ''}`} role="dialog" aria-modal="true">
      <div ref={spotlightRef} className="guide-spotlight" />
      <section ref={cardRef} className="guide-card">
        <div className="guide-card-content" key={step.title}>
        <div className="guide-card-head">
          <div>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--green-700)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>新手引导</span>
            <h2 style={{ marginTop: 4 }}>{step.title}</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="跳过">
            <X size={16} />
          </button>
        </div>
        <p className="guide-card-body">{step.body}</p>
        {step.action === 'test' && (
          <div className="guide-test-inline">
            <button type="button" className="btn-secondary" onClick={onTestConnection} disabled={testingConnection}>
              <TestTube2 size={14} /> {testingConnection ? '测试中…' : '测试 OBS 连接'}
            </button>
            {testResult && <span className={testResult.ok ? 'test-ok' : 'test-bad'}>{testResult.message}</span>}
          </div>
        )}
        {step.action === 'openDiagnostics' && (
          <div className="guide-test-inline">
            <button type="button" className="btn-secondary" onClick={onSetDiagnostics}>
              <SlidersHorizontal size={14} /> 展开诊断测试
            </button>
            <span>展开后可以直接点击里面的测试按钮。</span>
          </div>
        )}
        <div className="guide-progress">
          <span>{stepIndex + 1} / {steps.length}</span>
          <div className="guide-progress-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>跳过</button>
            <button type="button" className="btn-primary" onClick={() => (isLast ? onClose() : setStepIndex((i) => i + 1))} style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}>
              {isLast ? '完成' : '下一步'}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
        </div>
      </section>
    </div>
  );
};
