import { livePlatformOverlaySvg } from '../../../shared/livePlatformOverlay';
import React, {useEffect, useState} from 'react';
import {safetyInsets, type ProjectorSafetyConfig, type ProjectorSafetyStatus} from '../../../shared/projectorSafety';
import './projectorSafety.css';
export function ProjectorSafetySection({config, onChange}: {config: ProjectorSafetyConfig; onChange: (value: ProjectorSafetyConfig) => void}) {
  const [status, setStatus] = useState<ProjectorSafetyStatus | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => window.obsGuard.getProjectorSafetyStatus().then(value => {if (active) setStatus(value);}).catch(() => {if (active) setError('读取投影状态失败，请重新打开设置');});
    void refresh(); const timer = setInterval(refresh, 800);
    return () => {active = false; clearInterval(timer);};
  }, []);
  const update = (patch: Partial<ProjectorSafetyConfig>) => onChange({...config, ...patch});
  const inset = safetyInsets(config);
  const dimension = (label: string, width: 'sourceWidth' | 'phoneWidth' | 'wideWidth', height: 'sourceHeight' | 'phoneHeight' | 'wideHeight') => <div className="safety-dimensions"><span>{label}</span><div><input aria-label={`${label}宽度`} type="number" min="1" max="16384" value={config[width]} onChange={e => update({[width]: Math.max(1, Number(e.target.value))})}/><b>×</b><input aria-label={`${label}高度`} type="number" min="1" max="16384" value={config[height]} onChange={e => update({[height]: Math.max(1, Number(e.target.value))})}/></div></div>;
  return <div className="safety-settings">
    <label className="safety-toggle"><div><strong>显示投影安全区</strong><small>仅覆盖桌面投影 · 鼠标穿透 · 拖动或缩放时自动隐藏</small></div><input type="checkbox" checked={config.enabled} onChange={e => update({enabled: e.target.checked})}/></label>
    <div className="safety-state" role="status">{error || status?.message || '正在读取投影状态…'}</div>
    {status && status.targets.length > 0 && <label className="safety-target">覆盖的 OBS 投影<select value={status.selectedHandle} onChange={e => {const handle=e.target.value; const target=status.targets.find(t=>t.handle===handle); void window.obsGuard.selectSafetyProjector(handle).then(()=>update({targetTitle:target?.title ?? ''})).catch(()=>setError('选择窗口失败，请重试'));}}><option value="">自动选择唯一投影</option>{status.targets.map(t=><option key={t.handle} value={t.handle}>{t.title} · {t.handle}</option>)}</select></label>}
    <div className="safety-layout"><div className="safety-preview" style={{aspectRatio:`${config.sourceWidth}/${config.sourceHeight}`}}><div className="safety-band" style={{left:0,top:0,bottom:0,width:`${inset.side*100}%`,opacity:config.opacity}}/><div className="safety-band" style={{right:0,top:0,bottom:0,width:`${inset.side*100}%`,opacity:config.opacity}}/><div className="safety-band" style={{left:`${inset.side*100}%`,right:`${inset.side*100}%`,top:0,height:`${inset.vertical*100}%`,opacity:config.opacity}}/><div className="safety-band" style={{left:`${inset.side*100}%`,right:`${inset.side*100}%`,bottom:0,height:`${inset.vertical*100}%`,opacity:config.opacity}}/><div className="safety-inner" style={{inset:`${inset.vertical*100}% ${inset.side*100}%`}}/>{config.platformOverlayEnabled && <div style={{position:'absolute',top:0,bottom:0,left:`${inset.side*100}%`,right:`${inset.side*100}%`,opacity:config.platformOverlayOpacity,pointerEvents:'none'}} dangerouslySetInnerHTML={{__html:livePlatformOverlaySvg()}}/>}</div>
    <div className="safety-controls">
      {dimension('OBS 视频画布', 'sourceWidth', 'sourceHeight')}
      <label>手机左右裁切<select value={config.phoneWidth===1320 && config.phoneHeight===2868?'max':config.phoneWidth===1206 && config.phoneHeight===2622?'pro':'custom'} onChange={e=>{if(e.target.value==='max') update({phoneWidth:1320,phoneHeight:2868}); if(e.target.value==='pro') update({phoneWidth:1206,phoneHeight:2622});}}><option value="max">iPhone 18 Pro Max · 1320 × 2868</option><option value="pro">iPhone 18 Pro · 1206 × 2622</option><option value="custom" disabled>自定义（修改下方尺寸）</option></select></label>
      {dimension('手机宽 × 高', 'phoneWidth', 'phoneHeight')}
      {dimension('阔屏宽 × 高', 'wideWidth', 'wideHeight')}
      <small>默认：Pura X View · 1320 × 2232</small>
      <div className="safety-metrics"><span>左 / 右各 <b>{(inset.side*100).toFixed(2)}%</b></span><span>上 / 下各 <b>{(inset.vertical*100).toFixed(2)}%</b></span></div>
    </div></div>
    <label className="safety-range">灰色遮罩深浅 <b>{Math.round(config.opacity*100)}%</b><input type="range" min="5" max="80" value={Math.round(config.opacity*100)} onChange={e=>update({opacity:Number(e.target.value)/100})}/></label>
    <div className="safety-calibration">{(['sideAdjustment','verticalAdjustment'] as const).map((key,i)=><label key={key}>{i===0?'左右':'上下'}微调（百分点）<input type="number" min="-25" max="25" step="0.1" value={config[key]} onChange={e=>update({[key]:Number(e.target.value)})}/></label>)}</div>
    <label className="safety-toggle"><div><strong>叠加直播界面示意</strong><small>按你的苹果截图重绘 · 匿名占位 · 随投影安全区显示</small></div><input type="checkbox" checked={config.platformOverlayEnabled} onChange={e=>update({platformOverlayEnabled:e.target.checked})}/></label>
    {config.platformOverlayEnabled && <label className="safety-range">界面图层深浅 <b>{Math.round(config.platformOverlayOpacity*100)}%</b><input type="range" min="15" max="100" value={Math.round(config.platformOverlayOpacity*100)} onChange={e=>update({platformOverlayOpacity:Number(e.target.value)/100})}/></label>}
    <div className="safety-actions"><label><input type="checkbox" checked={config.labels} onChange={e=>update({labels:e.target.checked})}/> 显示裁切标记</label><button type="button" className="btn btn-secondary" onClick={()=>{void window.obsGuard.previewProjectorSafety(config).catch(()=>setError('预览打开失败，请重试'));}}>打开效果预览</button></div>
    <p className="safety-note">裁切按居中铺满估算；直播界面按截图等比重绘，实际布局可能随平台变化。自动跟随支持 Windows。</p>
  </div>;
}
