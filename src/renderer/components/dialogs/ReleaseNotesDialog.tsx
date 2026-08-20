import React, { useState } from 'react';
import { Activity, MonitorUp, Radio, ShieldCheck } from 'lucide-react';

const CLIENT_RELEASE_NOTES = [
  { icon: Activity, title: '检测可以手动控制', detail: '未开播时也能主动开始检测；OBS 开播、录制或虚拟摄像头仍会自动接管。' },
  { icon: MonitorUp, title: '恢复状态更醒目', detail: '连续静音超过 3 秒后恢复讲话，小浮窗会显示一次绿色确认光晕。' },
  { icon: Radio, title: '提醒节奏保持一致', detail: '小浮窗与监控中心统一使用渐黄、渐红的提醒进度，无数据时保持灰色等待。' },
  { icon: ShieldCheck, title: '原有设置保持不变', detail: '更新不会清空音源、机位、窗口位置或直播间配置。' }
];

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
            {CLIENT_RELEASE_NOTES.map(({ icon: Icon, title, detail }) => (
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
