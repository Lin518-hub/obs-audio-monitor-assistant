import React, { useMemo, useState } from 'react';
import { BellRing, Check, Mic2, Video } from 'lucide-react';

const CLIENT_RELEASE_NOTES = [
  { icon: Mic2, title: '音频提醒统一为 2 分钟', detail: '静音计时和报警提示现在使用统一标准。' },
  { icon: Video, title: '机位计时更清楚', detail: '10 分钟进入超时提醒，电脑端强弹窗仍在 12 分钟出现。' },
  { icon: BellRing, title: '提醒颜色平滑变化', detail: '音频和机位会逐渐变黄，临近提醒时变红。' },
  { icon: Check, title: '支持多个出镜机位', detail: '选中的出镜机位不计时，也不会触发提醒。' }
];

export interface ReleaseCameraOption {
  id: number;
  label: string;
  color: string;
}

export const ReleaseNotesDialog: React.FC<{
  version: string;
  cameraSelectionRequired: boolean;
  cameraOptions: ReleaseCameraOption[];
  initialCameraIds: number[];
  onConfirm: (cameraIds: number[]) => Promise<unknown>;
}> = ({ version, cameraSelectionRequired, cameraOptions, initialCameraIds, onConfirm }) => {
  const validIds = useMemo(() => new Set(cameraOptions.map((option) => option.id)), [cameraOptions]);
  const [selectedIds, setSelectedIds] = useState(() => initialCameraIds.filter((id) => validIds.has(id)));
  const [saving, setSaving] = useState(false);
  const canConfirm = !cameraSelectionRequired || selectedIds.length > 0;

  const toggleCamera = (id: number) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id].sort((a, b) => a - b));
  };

  const confirm = async () => {
    if (!canConfirm || saving) return;
    setSaving(true);
    try {
      await onConfirm(selectedIds);
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
            <p>查看本次客户端变化，并确认不参与机位超时提醒的出镜机位。</p>
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
          {cameraSelectionRequired && (
            <section className="release-camera-setup" aria-labelledby="release-camera-title">
              <div>
                <strong id="release-camera-title">选择出镜机位</strong>
                <p>主播或嘉宾长期出镜的机位不会累计停留时间，也不会触发机位提醒。</p>
              </div>
              <div className="release-camera-grid">
                {cameraOptions.map((option) => {
                  const selected = selectedIds.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={selected ? 'is-selected' : ''}
                      aria-pressed={selected}
                      onClick={() => toggleCamera(option.id)}
                    >
                      <i style={{ backgroundColor: option.color }} />
                      <span><b>{option.id}</b>{option.label}</span>
                      <Check size={16} />
                    </button>
                  );
                })}
              </div>
              {selectedIds.length === 0 && <small>请至少选择一个出镜机位后继续。</small>}
            </section>
          )}
        </div>
        <footer>
          <span>{cameraSelectionRequired ? `已选择 ${selectedIds.length} 个出镜机位` : '设置可稍后在检测规则中调整'}</span>
          <button type="button" className="btn-primary" disabled={!canConfirm || saving} onClick={() => void confirm()}>
            {saving ? '正在保存…' : cameraSelectionRequired ? '确认机位并继续' : '知道了'}
          </button>
        </footer>
      </section>
    </div>
  );
};
