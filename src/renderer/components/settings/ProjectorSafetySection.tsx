import React from 'react';
import {safetyInsets, type ProjectorSafetyConfig} from '../../../shared/projectorSafety';
import {StyledSelect} from '../StyledSelect';
import {NumberField} from './widgets';
import './projectorSafety.css';

/** Detailed geometry lives in settings; everyday controls live on the sidebar page. */
export function ProjectorSafetySection({config, onChange}: {config: ProjectorSafetyConfig; onChange: (value: ProjectorSafetyConfig) => void}) {
  const update = (patch: Partial<ProjectorSafetyConfig>) => onChange({...config, ...patch});
  const inset = safetyInsets(config);
  const dimensions = (title: string, width: 'sourceWidth' | 'phoneWidth' | 'wideWidth', height: 'sourceHeight' | 'phoneHeight' | 'wideHeight', hint?: string) => (
    <section className="safety-dimension-group">
      <div className="safety-group-heading"><strong>{title}</strong>{hint && <span>{hint}</span>}</div>
      <div className="safety-dimension-fields">
        <div><span>宽度</span><NumberField ariaLabel={`${title}宽度`} value={config[width]} min={1} max={16384} step={1} suffix="px" onChange={value=>update({[width]:value})}/></div>
        <div><span>高度</span><NumberField ariaLabel={`${title}高度`} value={config[height]} min={1} max={16384} step={1} suffix="px" onChange={value=>update({[height]:value})}/></div>
      </div>
    </section>
  );
  return <div className="settings-section safety-advanced">
    {dimensions('OBS 视频画布','sourceWidth','sourceHeight','填写 OBS 实际使用的画布尺寸')}
    <div className="safety-preset"><span>手机参考机型</span><StyledSelect ariaLabel="手机参考机型" value={config.phoneWidth===1320 && config.phoneHeight===2868?'max':config.phoneWidth===1206 && config.phoneHeight===2622?'pro':'custom'} options={[{value:'max',label:'iPhone 18 Pro Max',description:'1320 × 2868'},{value:'pro',label:'iPhone 18 Pro',description:'1206 × 2622'},{value:'custom',label:'自定义尺寸',description:'在下方修改宽度和高度'}]} onChange={value=>{if(value==='max')update({phoneWidth:1320,phoneHeight:2868});if(value==='pro')update({phoneWidth:1206,phoneHeight:2622});}}/></div>
    {dimensions('手机屏幕','phoneWidth','phoneHeight')}
    {dimensions('阔直板屏幕','wideWidth','wideHeight','默认 Pura X View · 1320 × 2232')}
    <section className="safety-dimension-group">
      <div className="safety-group-heading"><strong>裁切微调</strong><span>正值扩大遮罩，负值缩小遮罩</span></div>
      <div className="safety-dimension-fields">
        <div><span>左右各增加</span><NumberField ariaLabel="左右裁切微调" value={config.sideAdjustment} min={-25} max={25} step={0.1} suffix="%" onChange={value=>update({sideAdjustment:value})}/></div>
        <div><span>上下各增加</span><NumberField ariaLabel="上下裁切微调" value={config.verticalAdjustment} min={-25} max={25} step={0.1} suffix="%" onChange={value=>update({verticalAdjustment:value})}/></div>
      </div>
    </section>
    <div className="safety-ratio-summary"><span>左右各 <b>{(inset.side*100).toFixed(2)}%</b></span><span>上下各 <b>{(inset.vertical*100).toFixed(2)}%</b></span></div>
    <p className="settings-section-hint">比例按居中铺满估算。开启、图层切换和效果预览请使用侧栏的“投影安全区”。</p>
  </div>;
}
