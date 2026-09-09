import React, { useState } from 'react';
import { Activity, MonitorUp, Radio, ShieldCheck } from 'lucide-react';

const CLIENT_RELEASE_NOTES = [
  { icon: Activity, title: '开播准备进度可见', detail: '新增毛玻璃动态进度弹窗，显示当前启动步骤、恢复位置和输出投影状态；支持收起后台继续。' },
  { icon: MonitorUp, title: '一键开播与投影位置修复', detail: '改善中文输出投影识别，保存布局立即写入配置，等待 OBS 就绪后打开并恢复投影位置。' },
  { icon: Activity, title: '默认恢复经典绿色', detail: '设置 → 系统与更新中可切换经典绿和暖黄色，导航、图标和按钮同步变色。' },
  { icon: Radio, title: '浮窗缩放与反馈', detail: '拖动边角实时按比例缩放；静音满 3 秒闪红色描边，恢复讲话闪绿色。' },
  { icon: ShieldCheck, title: '虚拟摄像头确认检测', detail: '开启虚拟摄像头后先显示 5 秒确认提示，点击开始检测后才启动音频与机位检测。' }
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
