import React, { useState } from 'react';
import { Activity, MonitorUp, ShieldCheck } from 'lucide-react';

const CLIENT_RELEASE_NOTES: Record<string, { icon: typeof Activity; title: string; detail: string }[]> = {
  '3.9.16': [
    { icon: MonitorUp, title: '投影安全区独立入口', detail: '侧栏直接开启、选择投影、调整图层与透明度；分辨率和裁切校准保留在设置，统一控件和间距。' },
    { icon: ShieldCheck, title: '修复投影遮挡误判', detail: '默认保持安全区显示，遮挡隐藏改为可选；忽略鼠标穿透浮层，拖动、缩放和最小化仍自动隐藏。' }
  ],
  '3.9.14': [{ icon: MonitorUp, title: '监控服务器手动重连', detail: '设置中新增服务器连接状态、失败原因、最后同步时间和重新连接按钮，无需重启音频检测。' }],
  '3.9.15': [
    { icon: MonitorUp, title: 'OBS 投影安全区与直播界面示意', detail: '新增手机、阔直板裁切线和匿名直播组件图层；Windows 自动跟随投影，拖动或缩放时隐藏，Mac 支持设置与预览。' },
    { icon: Activity, title: '推流码率显示修复', detail: '根据 OBS 实际推流字节数计算码率，区分未推流与等待采样状态。' },
    { icon: ShieldCheck, title: '首次引导重新排版', detail: '统一步骤宽度、按钮与间距，重新设计音频和报警验证，精简一键开播配置页面。' },
    { icon: Activity, title: '连接错误更容易处理', detail: 'OBS 密码、地址与连接失败改为中文提示；更新弹窗仅展示当前版本内容。' }
  ]
};

export const ReleaseNotesDialog: React.FC<{
  version: string;
  onConfirm: () => Promise<unknown>;
}> = ({ version, onConfirm }) => {
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="release-notes-overlay" role="dialog" aria-modal="true" aria-label={`v${version} 更新内容`}>
      <section className="release-notes-card">
        <header>
          <div>
            <span>客户端更新</span>
            <h2>v{version} 更新内容</h2>
            <p>查看本次客户端变化。已有连接、检测规则和机位设置均保持不变。</p>
          </div>
        </header>
        <div className="release-notes-body">
          <div className="release-notes-list">
            {(CLIENT_RELEASE_NOTES[version.replace(/^v/, '')] || [{ icon: ShieldCheck, title: '版本更新', detail: '本版本包含体验优化与问题修复。' }]).map(({ icon: Icon, title, detail }) => (
              <article key={title}>
                <span><Icon size={18} /></span>
                <div><strong>{title}</strong><p>{detail}</p></div>
              </article>
            ))}
          </div>
        </div>
        <footer>
          <span>更新不会修改当前配置</span>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void confirm()}>
            {saving ? '正在确认…' : '知道了'}
          </button>
        </footer>
      </section>
    </div>
  );
};
