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
      { target: 'settings-diagnostics', title: '第三步:测试 OBS 是否连上', body: '在 设置 → 诊断与测试 里点击"测试 OBS 连接"。成功后,软件就能读取 OBS 音源列表。', action: 'openDiagnostics', openDrawer: 'diagnostics' },
      { target: 'settings-source', title: '第四步:选择要守护的音源', body: '选择主播麦克风、无线麦、声卡输入或直播主混音。图片、文字、显示器采集等无声音源会被过滤。', openDrawer: 'source' },
      { target: 'settings-rules', title: '第五步:设置报警规则', body: '默认连续静音 120 秒报警,90 秒先预警。口播密集可以缩短,访谈或活动直播可以适当延长。', openDrawer: 'rules' },
      { target: 'meter', title: '第六步:不开播也能测试', body: 'OBS 已连接但还没开播时,可以在"诊断与测试"里打开"模拟开播检测",测试电平、静音计时和报警弹窗。' },
      { target: 'settings-system', title: '第七步:按需要开启自启动', body: '固定直播电脑建议开启。下次开机后软件会在后台运行。', openDrawer: 'system' },
      { target: 'meter', title: '第八步:直播中常用大电平表', body: '中栏中间的大电平表显示实时 dB 与距离报警的倒计时。静音阈值可在电平表上拖动调节。' },
      { target: 'connection-status', title: '最后:窗口关闭后仍在后台运行', body: '关闭主窗口只是隐藏到后台,检测仍会继续。需要完全退出时,从托盘或菜单栏选择"退出"。' }
    ],
    []
  );

  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const [layout, setLayout] = useState<{ rect: { left: number; top: number; width: number; height: number; right: number; bottom: number }; card: { left: number; top: number; width: number } } | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const lastLayoutRef = useRef<typeof layout>(null);
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
    let raf = 0;
    let scrollRaf = 0;
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

    const updateLayout = () => {
      if (disposed || !target) {
        if (lastLayoutRef.current) { lastLayoutRef.current = null; setLayout(null); }
        return;
      }
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
      const next = { rect, card };
      if (!lastLayoutRef.current ||
        lastLayoutRef.current.rect.left !== next.rect.left ||
        lastLayoutRef.current.rect.top !== next.rect.top ||
        lastLayoutRef.current.rect.width !== next.rect.width ||
        lastLayoutRef.current.rect.height !== next.rect.height ||
        lastLayoutRef.current.card.left !== next.card.left ||
        lastLayoutRef.current.card.top !== next.card.top ||
        lastLayoutRef.current.card.width !== next.card.width) {
        lastLayoutRef.current = next;
        setLayout(next);
      }
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
    updateLayout();
    animate();
    timers.push(window.setTimeout(updateLayout, 120));
    timers.push(window.setTimeout(updateLayout, 300));
    if (target) {
      ro = new ResizeObserver(() => updateLayout());
      ro.observe(target);
    }
    window.addEventListener('resize', updateLayout);
    scrollContainer.addEventListener('scroll', updateLayout, true);

    return () => {
      disposed = true;
      ro?.disconnect();
      window.cancelAnimationFrame(raf);
      window.cancelAnimationFrame(scrollRaf);
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', updateLayout);
      scrollContainer.removeEventListener('scroll', updateLayout, true);
      targets.forEach((t) => t.classList.remove('guide-active-target'));
      target?.classList.remove('guide-active-target');
    };
  }, [step.target]);

  return (
    <div className="guide-overlay" role="dialog" aria-modal="true">
      {layout && (
        <div
          className="guide-spotlight"
          style={{
            transform: `translate3d(${layout.rect.left}px, ${layout.rect.top}px, 0)`,
            width: layout.rect.right - layout.rect.left,
            height: layout.rect.bottom - layout.rect.top
          }}
        />
      )}
      <section ref={cardRef} className="guide-card" style={layout ? { left: `${layout.card.left}px`, top: `${layout.card.top}px`, width: `${layout.card.width}px` } : undefined}>
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
              <SlidersHorizontal size={14} /> 展开诊断与测试
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
      </section>
    </div>
  );
};
