import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Clapperboard,
  ExternalLink,
  FileUp,
  FolderOpen,
  Globe2,
  LoaderCircle,
  MapPin,
  MonitorPlay,
  Play,
  RadioTower,
  ScanSearch,
  Save,
  ShieldCheck,
  SlidersHorizontal
} from 'lucide-react';
import type {
  AppConfig,
  PreflightAppId,
  PreflightAppStatus,
  PreflightCheckResult,
  PreflightDiscoveryItem,
  PreflightLaunchResult,
  PreflightPathSource,
  PreflightSettings
} from '../../shared/types';

const APP_META: Record<PreflightAppId, {
  name: string;
  description: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = {
  obs: { name: 'OBS', description: '直播画面、音频与推流', Icon: RadioTower },
  douyin: { name: '平台直播工具', description: '抖音、淘宝、美团等平台直播软件', Icon: Clapperboard },
  browser: { name: '浏览器', description: '直播后台与运营页面', Icon: Globe2 },
  software_control: { name: 'Software Control', description: '直播设备控制软件', Icon: SlidersHorizontal },
  cosmic_cat: { name: '宇宙猫检测', description: '以管理员身份启动检测工具', Icon: ShieldCheck }
};

const SOURCE_LABELS: Record<PreflightPathSource, string> = {
  manual: '手动设置',
  standard: '标准安装目录',
  registry: 'Windows 注册表',
  start_menu: '开始菜单',
  desktop: '桌面快捷方式',
  unknown: '未识别来源'
};

const POSITIONABLE_APP_IDS = new Set<PreflightAppId>(['obs', 'douyin', 'browser', 'software_control']);

interface PreflightCheckPageProps {
  draft: AppConfig;
  search: string;
  onChange: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => void;
}

type BusyState = 'discover' | 'all' | 'layout' | 'projector' | PreflightAppId | null;

export const PreflightCheckPage: React.FC<PreflightCheckPageProps> = ({ draft, search, onChange }) => {
  const [result, setResult] = useState<PreflightCheckResult | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [expanded, setExpanded] = useState<Set<PreflightAppId>>(() => new Set());
  const [draggingId, setDraggingId] = useState<PreflightAppId | null>(null);
  const [checking, setChecking] = useState(true);
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const checkInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const settings = useMemo<PreflightSettings>(() => ({
    apps: draft.preflightApps,
    projector: draft.preflightProjector,
    windowPlacements: draft.preflightWindowPlacements
  }), [draft.preflightApps, draft.preflightProjector, draft.preflightWindowPlacements]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const runCheck = useCallback(async (nextSettings?: PreflightSettings, showProgress = false) => {
    if (checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    if (showProgress) setChecking(true);
    try {
      const next = await window.obsGuard.checkPreflightApps(nextSettings ?? settingsRef.current);
      if (mountedRef.current) setResult(next);
    } catch (error) {
      if (showProgress && mountedRef.current) {
        setNotice({ tone: 'error', text: error instanceof Error ? error.message : '检测系统进程失败' });
      }
    } finally {
      checkInFlightRef.current = false;
      if (showProgress && mountedRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void runCheck(settingsRef.current, true);
    const refresh = () => {
      if (document.visibilityState === 'visible') void runCheck();
    };
    const interval = window.setInterval(refresh, 4_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [runCheck]);

  const enabledIds = useMemo(() => Object.entries(draft.preflightApps)
    .filter(([, config]) => config.enabled)
    .map(([id]) => id as PreflightAppId), [draft.preflightApps]);
  const runningCount = enabledIds.filter((id) => result?.apps.find((app) => app.id === id)?.state === 'running').length;
  const configuredCount = enabledIds.filter((id) => Boolean(draft.preflightApps[id].path.trim())
    || (id === 'browser' && Boolean(draft.preflightApps.browser.launchUrl.trim()))).length;
  const savedLayoutCount = enabledIds.filter((id) => POSITIONABLE_APP_IDS.has(id) && draft.preflightApps[id].restoreWindowPosition && draft.preflightWindowPlacements[id]).length
    + (draft.preflightProjector.restoreWindowPosition && draft.preflightWindowPlacements.obs_projector ? 1 : 0);
  const selectedLayoutCount = enabledIds.filter((id) => POSITIONABLE_APP_IDS.has(id) && draft.preflightApps[id].restoreWindowPosition).length
    + (draft.preflightProjector.restoreWindowPosition ? 1 : 0);
  const ready = enabledIds.length > 0 && runningCount === enabledIds.length;
  const query = search.trim().toLocaleLowerCase('zh-CN');
  const visibleIds = (Object.keys(APP_META) as PreflightAppId[]).filter((id) => {
    const meta = APP_META[id];
    const label = draft.preflightApps[id].customLabel;
    return !query || `${meta.name} ${meta.description} ${label}`.toLocaleLowerCase('zh-CN').includes(query);
  });

  const updateApps = (id: PreflightAppId, patch: Partial<AppConfig['preflightApps'][PreflightAppId]>) => {
    onChange('preflightApps', { ...draft.preflightApps, [id]: { ...draft.preflightApps[id], ...patch } });
  };

  const mergeDiscoveredPaths = (
    baseSettings: PreflightSettings,
    discovered: PreflightDiscoveryItem[],
    replaceInvalid: boolean
  ) => {
    const apps = { ...baseSettings.apps };
    const added: PreflightAppId[] = [];
    for (const item of discovered) {
      const current = apps[item.id];
      const currentState = result?.apps.find((app) => app.id === item.id)?.state;
      const mayReplace = !current.path.trim() || (replaceInvalid && currentState === 'error');
      if (!mayReplace || current.path === item.path) continue;
      apps[item.id] = { ...current, path: item.path, pathSource: item.source };
      added.push(item.id);
    }
    return { settings: { ...baseSettings, apps }, added };
  };

  const scanApps = async () => {
    setBusy('discover');
    setNotice(null);
    try {
      const discovery = await window.obsGuard.discoverPreflightApps();
      const merged = mergeDiscoveredPaths(settings, discovery.discovered, true);
      if (merged.added.length > 0) onChange('preflightApps', merged.settings.apps);
      const checked = await window.obsGuard.checkPreflightApps(merged.settings);
      setResult(checked);
      const unresolved = enabledIds.filter((id) => checked.apps.find((app) => app.id === id)?.state === 'not_configured');
      if (unresolved.length > 0) {
        setExpanded((current) => new Set([...current, ...unresolved]));
        setNotice({
          tone: 'warning',
          text: merged.added.length > 0
            ? `已自动添加 ${merged.added.length} 个软件路径；还有 ${unresolved.length} 个未找到，请拖入程序或快捷方式。`
            : `${discovery.message} 未找到的项目可直接拖入程序或快捷方式。`
        });
      } else {
        setNotice({ tone: 'success', text: merged.added.length > 0 ? `已自动添加 ${merged.added.length} 个软件路径。` : discovery.message });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '自动扫描软件失败' });
    } finally {
      setBusy(null);
    }
  };

  const applyLaunchResult = (next: PreflightLaunchResult, actionName: string) => {
    setResult(next);
    const failed = Object.keys(next.failures) as PreflightAppId[];
    if (failed.length > 0) {
      const needsManualPath = failed.filter((id) => next.apps.find((app) => app.id === id)?.state === 'not_configured');
      if (needsManualPath.length > 0) setExpanded((current) => new Set([...current, ...needsManualPath]));
      setNotice({
        tone: 'error',
        text: `${failed.map((id) => appDisplayName(id, draft.preflightApps[id].customLabel)).join('、')}启动失败；其他项目已继续执行。${needsManualPath.length > 0 ? ' 自动扫描未找到，请拖入程序或快捷方式。' : ''}`
      });
      return;
    }
    if (next.projector?.state === 'failed') {
      setNotice({ tone: 'warning', text: `开播软件已启动；节目输出投影未打开：${next.projector.message}` });
      return;
    }
    const notReady = enabledIds.filter((id) => next.apps.find((app) => app.id === id)?.state !== 'running');
    setNotice(notReady.length > 0
      ? { tone: 'warning', text: `${actionName}已执行，部分程序仍在启动，可稍后重新检测。` }
      : { tone: 'success', text: next.projector?.message || '开播所需程序均已运行。' });
  };

  const launchAll = async () => {
    setBusy('all');
    setNotice(null);
    try {
      let launchSettings = settings;
      const missingPath = enabledIds.some((id) => !settings.apps[id].path.trim()
        && (result?.apps.find((app) => app.id === id)?.state !== 'running'
          || (id === 'browser' && Boolean(settings.apps.browser.launchUrl.trim()))));
      if (missingPath) {
        const discovery = await window.obsGuard.discoverPreflightApps();
        const merged = mergeDiscoveredPaths(settings, discovery.discovered, false);
        launchSettings = merged.settings;
        if (merged.added.length > 0) onChange('preflightApps', merged.settings.apps);
      }
      applyLaunchResult(await window.obsGuard.launchPreflightApps(launchSettings), '一键开播准备');
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '一键开播准备失败' });
    } finally {
      setBusy(null);
    }
  };

  const launchOne = async (id: PreflightAppId) => {
    setBusy(id);
    setNotice(null);
    try {
      applyLaunchResult(await window.obsGuard.launchPreflightApp(id, settings), appDisplayName(id, draft.preflightApps[id].customLabel));
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : `${appDisplayName(id)}启动失败` });
    } finally {
      setBusy(null);
    }
  };

  const openProjector = async () => {
    setBusy('projector');
    setNotice(null);
    try {
      const projector = await window.obsGuard.openPreflightProjector(settings);
      setNotice({ tone: projector.state === 'failed' ? 'error' : 'success', text: projector.message });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '打开节目输出投影失败' });
    } finally {
      setBusy(null);
    }
  };

  const captureLayout = async () => {
    setBusy('layout');
    setNotice(null);
    try {
      const captured = await window.obsGuard.capturePreflightLayout(settings);
      onChange('preflightWindowPlacements', captured.placements);
      const failures = Object.values(captured.failures).filter(Boolean);
      if (captured.captured.length === 0) {
        setNotice({
          tone: 'warning',
          text: failures[0] || '没有可保存的窗口。请先打开软件，并选择下方需要恢复位置的项目。'
        });
      } else if (failures.length > 0) {
        setNotice({ tone: 'warning', text: `已保存 ${captured.captured.length} 个窗口位置；${failures.join('；')}` });
      } else {
        setNotice({ tone: 'success', text: `已保存 ${captured.captured.length} 个窗口位置，下次由助手启动时会自动恢复。` });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '保存当前布局失败' });
    } finally {
      setBusy(null);
    }
  };

  const applyManualPath = async (id: PreflightAppId, path: string) => {
    const apps = { ...draft.preflightApps, [id]: { ...draft.preflightApps[id], path, pathSource: 'manual' as const } };
    onChange('preflightApps', apps);
    setResult(await window.obsGuard.checkPreflightApps({ ...settings, apps }));
    setNotice({ tone: 'success', text: `${appDisplayName(id, apps[id].customLabel)}路径已添加。` });
  };

  const pickTarget = async (id: PreflightAppId) => {
    try {
      const path = await window.obsGuard.pickPreflightTarget(id);
      if (!path) return;
      await applyManualPath(id, path);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '无法选择快捷方式' });
    }
  };

  const dropTarget = async (id: PreflightAppId, event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggingId(null);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    try {
      const path = window.obsGuard.getDroppedPreflightPath(file);
      if (!path || !/\.(?:exe|lnk|bat|cmd|com|app)$/i.test(path)) {
        setNotice({ tone: 'error', text: '请拖入程序文件或快捷方式（.exe、.lnk、.bat、.cmd 或 .app）。' });
        return;
      }
      await applyManualPath(id, path);
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : '无法读取拖入的程序路径' });
    }
  };

  const toggleExpanded = (id: PreflightAppId) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="preflight-page">
      <header className="page-header preflight-page-header">
        <div className="page-header-title">
          <h1><span>开播检查</span></h1>
          <p className="page-header-subtitle">检查、启动并恢复一套固定的 Windows 开播布局</p>
        </div>
        <div className="preflight-header-actions">
          <button type="button" className="btn-primary preflight-launch-all" onClick={() => void launchAll()} disabled={busy !== null || enabledIds.length === 0}>
            {busy === 'all' ? <LoaderCircle size={17} className="spinning" /> : <Play size={17} />}
            {busy === 'all' ? '正在准备' : '一键开播准备'}
          </button>
        </div>
      </header>

      <section className={`preflight-summary ${ready ? 'ready' : ''}`}>
        <div className="preflight-summary-icon">{ready ? <Check size={26} /> : <CircleAlert size={26} />}</div>
        <div className="preflight-summary-copy">
          <strong>{ready ? '开播程序已就绪' : '开播前仍需检查'}</strong>
          <span>{enabledIds.length === 0 ? '请至少选择一个开播项目' : `已运行 ${runningCount} / ${enabledIds.length} 个已选项目`}</span>
        </div>
        <div className="preflight-summary-stats">
          <div><strong>{configuredCount}/{enabledIds.length}</strong><span>已配置</span></div>
          <div><strong>{runningCount}/{enabledIds.length}</strong><span>运行中</span></div>
          <div><strong>{savedLayoutCount}</strong><span>固定位置</span></div>
          <small>{result ? `${platformName(result.platform)} · ${formatTime(result.checkedAt)}` : '正在读取系统状态'}</small>
        </div>
      </section>

      <section className="preflight-layout" aria-label="固定窗口位置">
        <div className="preflight-layout-heading">
          <div className="preflight-layout-icon"><MapPin size={20} /></div>
          <div>
            <strong>固定窗口位置</strong>
            <span>选择要恢复的软件，摆好当前窗口后保存一次；只移动之后由助手新启动的窗口。</span>
          </div>
          <button type="button" className="preflight-layout-save" onClick={() => void captureLayout()} disabled={busy !== null || selectedLayoutCount === 0}>
            {busy === 'layout' ? <LoaderCircle size={16} className="spinning" /> : <Save size={16} />}
            {busy === 'layout' ? '正在保存' : '保存当前布局'}
          </button>
        </div>
        <div className="preflight-layout-options">
          {enabledIds.filter((id) => POSITIONABLE_APP_IDS.has(id)).map((id) => {
            const enabled = draft.preflightApps[id].restoreWindowPosition;
            const placement = draft.preflightWindowPlacements[id];
            return (
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                className={`preflight-layout-option ${enabled ? 'active' : ''}`}
                onClick={() => updateApps(id, { restoreWindowPosition: !enabled })}
                key={id}
              >
                <span className="preflight-layout-check">{enabled && <Check size={13} />}</span>
                <span>{appDisplayName(id, draft.preflightApps[id].customLabel)}</span>
                <small>{placement ? `已保存 ${formatShortTime(placement.capturedAt)}` : enabled ? '等待保存' : '不恢复'}</small>
              </button>
            );
          })}
          <button
            type="button"
            role="switch"
            aria-checked={draft.preflightProjector.restoreWindowPosition}
            className={`preflight-layout-option ${draft.preflightProjector.restoreWindowPosition ? 'active' : ''}`}
            onClick={() => onChange('preflightProjector', { ...draft.preflightProjector, restoreWindowPosition: !draft.preflightProjector.restoreWindowPosition })}
          >
            <span className="preflight-layout-check">{draft.preflightProjector.restoreWindowPosition && <Check size={13} />}</span>
            <span>OBS 节目投影</span>
            <small>{draft.preflightWindowPlacements.obs_projector ? `已保存 ${formatShortTime(draft.preflightWindowPlacements.obs_projector.capturedAt)}` : draft.preflightProjector.restoreWindowPosition ? '打开投影后保存' : '不恢复'}</small>
          </button>
        </div>
      </section>

      {notice && <div className="preflight-notice" data-tone={notice.tone}>{notice.text}</div>}

      <section className="preflight-list" aria-label="开播程序检查清单">
        <div className="preflight-list-heading">
          <div><h2>准备项目</h2><p>只展开需要调整的项目；配置会实时保存。</p></div>
          <div className="preflight-list-heading-actions">
            <span>{enabledIds.length} 项已选择</span>
            <button type="button" className="preflight-scan-button compact" onClick={() => void scanApps()} disabled={busy !== null}>
              {busy === 'discover' ? <LoaderCircle size={15} className="spinning" /> : <ScanSearch size={15} />}
              {busy === 'discover' ? '正在扫描' : '自动发现'}
            </button>
          </div>
        </div>

        <div className="preflight-list-rows">
          {visibleIds.map((id) => {
            const meta = APP_META[id];
            const config = draft.preflightApps[id];
            const appStatus = result?.apps.find((app) => app.id === id) ?? null;
            const isRunning = appStatus?.state === 'running';
            const canOpenBrowserPage = id === 'browser' && Boolean(config.launchUrl.trim());
            const cannotLaunch = appStatus?.state === 'unsupported' || (!config.path && !canOpenBrowserPage && !isRunning);
            const placement = draft.preflightWindowPlacements[id];
            const Icon = meta.Icon;
            const isExpanded = expanded.has(id);
            return (
              <article className={`preflight-row ${config.enabled ? 'included' : ''} ${isExpanded ? 'expanded' : ''}`} key={id}>
                <div className="preflight-row-main">
                  <div className="preflight-app-icon"><Icon size={21} /></div>
                  <div className="preflight-app-copy">
                    <div className="preflight-app-title">
                      <strong>{appDisplayName(id, config.customLabel)}</strong>
                      {id === 'cosmic_cat' && <span className="preflight-admin-badge">管理员</span>}
                    </div>
                    <span>{meta.description}</span>
                    <span className="preflight-path" title={config.path || '尚未设置快捷方式'}>
                      {config.path ? `${SOURCE_LABELS[config.pathSource]} · ${fileName(config.path)}` : canOpenBrowserPage ? '使用系统默认浏览器' : '尚未设置快捷方式'}
                      {' · '}{id === 'cosmic_cat'
                        ? '管理员后台程序，无窗口位置'
                        : config.restoreWindowPosition
                          ? placement ? `固定位置 ${formatShortTime(placement.capturedAt)}` : '固定位置未保存'
                          : '不恢复位置'}
                    </span>
                  </div>
                  <StatusPill status={appStatus} checking={checking && !result} />
                  <label className="preflight-included-control" title={config.enabled ? '已加入一键开播准备' : '未加入一键开播准备'}>
                    <span>{config.enabled ? '参与准备' : '已跳过'}</span>
                    <button type="button" role="switch" aria-checked={config.enabled} className={`preflight-include-switch ${config.enabled ? 'on' : ''}`} onClick={() => updateApps(id, { enabled: !config.enabled })}><span /></button>
                  </label>
                  <button type="button" className="preflight-expand-button" onClick={() => toggleExpanded(id)} aria-expanded={isExpanded} title={isExpanded ? '收起设置' : '展开设置'}><ChevronDown size={18} /></button>
                </div>

                <div className="preflight-row-details" aria-hidden={!isExpanded}>
                  <div
                    className={`preflight-path-setting ${draggingId === id ? 'dragging' : ''}`}
                    onDragEnter={(event) => { event.preventDefault(); setDraggingId(id); }}
                    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingId(null);
                    }}
                    onDrop={(event) => void dropTarget(id, event)}
                  >
                    <div>
                      <strong>启动程序</strong>
                      <span title={config.path || '尚未设置'}>{config.path || '尚未设置快捷方式或程序路径'}</span>
                      <small><FileUp size={13} />也可以把程序或快捷方式拖到这里</small>
                    </div>
                    <div>
                      <button type="button" className="preflight-tool-button" onClick={() => void pickTarget(id)}><FolderOpen size={16} />{config.path ? '更改' : '选择程序'}</button>
                      <button type="button" className="preflight-tool-button primary" onClick={() => void launchOne(id)} disabled={busy !== null || (isRunning && !canOpenBrowserPage) || cannotLaunch}>
                        {busy === id ? <LoaderCircle size={16} className="spinning" /> : id === 'browser' && canOpenBrowserPage ? <ExternalLink size={16} /> : <Play size={16} />}
                        {id === 'browser' && canOpenBrowserPage ? '打开直播页面' : isRunning ? '正在运行' : '单独打开'}
                      </button>
                    </div>
                  </div>
                  {id === 'douyin' && (
                    <label className="preflight-inline-field">
                      <span>平台备注</span>
                      <input value={config.customLabel} onChange={(event) => updateApps(id, { customLabel: event.target.value })} placeholder="例如：抖音、淘宝、美团" maxLength={32} />
                    </label>
                  )}
                  {id === 'browser' && (
                    <label className="preflight-inline-field wide">
                      <span>启动后打开的页面</span>
                      <div className="preflight-url-input"><Globe2 size={16} /><input value={config.launchUrl} onChange={(event) => updateApps(id, { launchUrl: event.target.value })} placeholder="https://example.com/live" inputMode="url" /></div>
                    </label>
                  )}
                  {id === 'obs' && (
                    <div className="preflight-projector-settings">
                      <div className="preflight-projector-heading"><MonitorPlay size={18} /><div><strong>节目输出投影</strong><span>通过 OBS WebSocket 打开窗口化节目输出</span></div></div>
                      <SettingSwitch title="一键准备时自动打开" description="默认关闭；失败不会影响其他软件启动" checked={draft.preflightProjector.enabled} onChange={(enabled) => onChange('preflightProjector', { ...draft.preflightProjector, enabled })} />
                      <button type="button" className="preflight-projector-button" onClick={() => void openProjector()} disabled={busy !== null}>
                        {busy === 'projector' ? <LoaderCircle size={16} className="spinning" /> : <ExternalLink size={16} />}打开或重试投影
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {visibleIds.length === 0 && <div className="preflight-empty">没有匹配的开播项目</div>}
      </section>
    </div>
  );
};

function SettingSwitch({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="preflight-setting-switch">
      <div><strong>{title}</strong><span>{description}</span></div>
      <button type="button" role="switch" aria-checked={checked} className={`preflight-include-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
    </div>
  );
}

function StatusPill({ status, checking }: { status: PreflightAppStatus | null; checking: boolean }) {
  if (checking || !status) return <span className="preflight-status" data-state="checking"><LoaderCircle size={14} className="spinning" />检测中</span>;
  const labels: Record<PreflightAppStatus['state'], string> = { running: '正在运行', not_running: '未运行', not_configured: '未配置', unsupported: '当前系统不支持', error: '需要处理' };
  return <span className="preflight-status" data-state={status.state} title={status.message}>{labels[status.state]}</span>;
}

function appDisplayName(id: PreflightAppId, customLabel = ''): string {
  if (id === 'douyin' && customLabel.trim()) return `平台直播工具 · ${customLabel.trim()}`;
  return APP_META[id].name;
}

function fileName(path: string): string { return path.split(/[\\/]/).filter(Boolean).pop() || path; }
function formatTime(timestamp: number): string { return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false }); }
function formatShortTime(timestamp: number): string { return new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
function platformName(platform: PreflightCheckResult['platform']): string { return platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS 预览' : 'Linux 预览'; }
