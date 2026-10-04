import type { AppConfig, AppSnapshot, PreflightLaunchResult } from './types.js';
export function setupChecks(config: AppConfig, snapshot: AppSnapshot, verifiedSource: string, alertConfirmed: boolean, trialPassed: boolean, workspaceSkipped = false) {
  return [
    { step: 'connection', label: '连接 OBS', ready: snapshot.connected },
    { step: 'source', label: '选择守护音源', ready: Boolean(config.targetInputName && snapshot.inputs.some(input => input.inputName === config.targetInputName)) },
    { step: 'verify', label: '说话验证与测试报警', ready: Boolean(config.targetInputName && verifiedSource === config.targetInputName && alertConfirmed) },
    { step: 'workspace', label: workspaceSkipped ? '仅音频模式：已跳过开播工作台' : '配置开播工作台并完成试运行', ready: trialPassed || workspaceSkipped }
  ];
}
export function workspaceTrialPassed(config: AppConfig, result: PreflightLaunchResult): boolean {
  const selected = Object.entries(config.preflightApps).filter(([, app]) => app.enabled);
  return selected.length > 0 && !Object.keys(result.failures).length && !Object.keys(result.restoreFailures).length
    && selected.every(([id, app]) => Boolean(app.path.trim() || result.apps.find(item => item.id === id)?.path?.trim() || (id === 'browser' && app.launchUrl.trim()))
      && (id === 'cosmic_cat' || result.apps.some(item => item.id === id && item.state === 'running'))
      && (!app.restoreWindowPosition || Boolean(config.preflightWindowPlacements[id as keyof typeof config.preflightWindowPlacements])))
    && (!config.preflightProjector.enabled || (result.projector?.state === 'opened' || result.projector?.state === 'already_open'))
    && (!config.preflightProjector.restoreWindowPosition || Boolean(config.preflightWindowPlacements.obs_projector));
}
