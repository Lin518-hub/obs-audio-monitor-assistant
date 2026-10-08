import React, {useEffect, useMemo, useState} from 'react';
import {Eye, Layers, Monitor, Settings2} from 'lucide-react';
import {safetyInsets,safetyOverlayHtml,type ProjectorSafetyConfig,type ProjectorSafetyStatus} from '../../shared/projectorSafety';
import {StyledSelect} from './StyledSelect';
import {ToggleRow} from './settings/widgets';
import './settings/projectorSafety.css';

export function ProjectorSafetyPage({config,onChange,onOpenSettings}: {config:ProjectorSafetyConfig;onChange:(value:ProjectorSafetyConfig)=>void;onOpenSettings:()=>void}) {
  const [status,setStatus]=useState<ProjectorSafetyStatus|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    const refresh=()=>window.obsGuard.getProjectorSafetyStatus().then(value=>{if(active)setStatus(value);}).catch(()=>{if(active)setError('读取投影状态失败，请重新打开此页面');});
    void refresh();const timer=setInterval(refresh,800);return()=>{active=false;clearInterval(timer);};
  },[]);
  const update=(patch:Partial<ProjectorSafetyConfig>)=>onChange({...config,...patch});
  const insets=safetyInsets(config);
  const preview=useMemo(()=>safetyOverlayHtml(config),[config]);
  const opacityControl=(label:string,value:number,min:number,max:number,change:(value:number)=>void)=><label className="safety-opacity"><span>{label}<b>{Math.round(value*100)}%</b></span><input aria-label={label} type="range" min={min} max={max} style={{background:`linear-gradient(to right,var(--brand-600) ${(value*100-min)/(max-min)*100}%,var(--brand-100) 0%)`}} value={Math.round(value*100)} onChange={event=>change(Number(event.target.value)/100)}/></label>;
  return <>
    <div className="page-header"><div className="page-header-title"><h1>投影安全区</h1><p className="page-header-subtitle">检查手机裁切与直播界面遮挡</p></div><button type="button" className="btn-secondary" onClick={onOpenSettings}><Settings2 size={16}/> 比例设置</button></div>
    <div className="safety-workspace">
      <section className="settings-section safety-visual-card"><header className="safety-card-heading"><div><Eye size={18}/><strong>画面预览</strong></div><span>{config.sourceWidth} × {config.sourceHeight}</span></header>
        <div className="safety-preview-stage"><div className="safety-phone-preview" style={{aspectRatio:`${config.sourceWidth}/${config.sourceHeight}`,width:`min(100%, ${Math.min(200,360*config.sourceWidth/config.sourceHeight)}px)`}}><iframe title="投影安全区效果预览" srcDoc={preview} sandbox="" tabIndex={-1}/></div></div>
        <div className="safety-ratio-summary"><span>左右各 <b>{(insets.side*100).toFixed(2)}%</b></span><span>上下各 <b>{(insets.vertical*100).toFixed(2)}%</b></span></div>
        <button type="button" className="btn-secondary" onClick={()=>void window.obsGuard.previewProjectorSafety(config).catch(()=>setError('预览打开失败，请重试'))}><Eye size={16}/> 独立窗口预览</button>
      </section>
      <div className="safety-control-stack">
        <section className="settings-section safety-control-card"><header className="safety-card-heading"><div><Monitor size={18}/><strong>投影显示</strong></div></header>
          <ToggleRow title="开启安全区" description="跟随 OBS 投影，拖动或缩放时暂时隐藏" checked={config.enabled} onChange={enabled=>update({enabled})}/>
          <ToggleRow title="遮挡时自动隐藏" description="默认保持显示，可能覆盖前方窗口；开启后遇到其他窗口遮挡时隐藏" checked={config.hideWhenCovered} onChange={hideWhenCovered=>update({hideWhenCovered})}/>
          <div className={`safety-runtime-state ${error?'has-error':''}`} role="status">{error||status?.message||'正在读取投影状态…'}</div>
          {status && status.targets.length>0 && <StyledSelect ariaLabel="目标投影窗口" value={status.selectedHandle} options={[{value:'',label:'自动选择唯一投影'},...status.targets.map(target=>({value:target.handle,label:target.title,description:`窗口 ${target.handle}`}))]} onChange={handle=>{const target=status.targets.find(item=>item.handle===handle);void window.obsGuard.selectSafetyProjector(handle).then(()=>{setError('');update({targetTitle:target?.title??''});}).catch(()=>setError('选择窗口失败，请重试'));}}/>}
        </section>
        <section className="settings-section safety-control-card"><header className="safety-card-heading"><div><Layers size={18}/><strong>图层与外观</strong></div></header>
          <ToggleRow title="裁切区域标记" checked={config.labels} onChange={labels=>update({labels})}/>
          {opacityControl('灰色遮罩深浅',config.opacity,5,80,value=>update({opacity:value}))}
          <ToggleRow title="直播界面示意" description="头像、评论、商品卡和按钮按苹果截图等比显示" checked={config.platformOverlayEnabled} onChange={platformOverlayEnabled=>update({platformOverlayEnabled})}/>
          {config.platformOverlayEnabled && opacityControl('直播界面深浅',config.platformOverlayOpacity,15,100,value=>update({platformOverlayOpacity:value}))}
        </section>
      </div>
    </div>
  </>;
}
