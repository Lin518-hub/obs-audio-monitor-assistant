import React, { useState } from 'react';
import { BellRing, MonitorUp, Radio, ShieldCheck } from 'lucide-react';

const CLIENT_RELEASE_NOTES = [
  { icon: BellRing, title: '报警处理更直接', detail: '正式报警可直接确认或暂停检测，不再进入延后忽略状态。' },
  { icon: MonitorUp, title: '浮窗显示更稳定', detail: '优化缩放过程、恢复尺寸后的文字比例，以及 Windows 圆角边缘。' },
  { icon: Radio, title: '远程连接更平稳', detail: '监控中心断线后采用逐步退避重连，降低网络异常时的额外开销。' },
  { icon: ShieldCheck, title: '现场问题更可追溯', detail: '主进程日志会安全保留，异常摘要可在监控中心查看；原有设置完整保留。' }
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
