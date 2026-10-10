import React, { useState } from 'react';
import { Activity, MonitorUp, ShieldCheck } from 'lucide-react';

const CLIENT_RELEASE_NOTES: Record<string, { icon: typeof Activity; title: string; detail: string }[]> = {
  '1.0.1': [{icon: ShieldCheck,title:'修复 Windows 启动失败',detail:'修正原生组件打包并增加 ATEM 加载保护；这是离线最终版的修复版本。'}],
  '1.0.0': [{icon: MonitorUp,title:'离线开源最终版',detail:'保留本机 OBS 音频检测、浮窗、投影安全区和局域网 ATEM；无监控上报、远程控制或自动更新。'}]
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
