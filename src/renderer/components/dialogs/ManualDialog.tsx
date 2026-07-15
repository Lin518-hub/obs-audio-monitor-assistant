import React from 'react';
import { BookOpen, Check, X } from 'lucide-react';

export const ManualDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  return (
    <div className="manual-overlay" role="dialog" aria-modal="true">
      <section className="manual-dialog">
        <header className="manual-head">
          <div>
            <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--green-700)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>使用说明书</span>
            <h2 style={{ marginTop: 4 }}>功能与操作</h2>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>
        <div className="manual-sections">
          <article>
            <strong><BookOpen size={14} /> 1. 在 OBS 里启用 WebSocket</strong>
            <p>打开 OBS,点击顶部菜单"工具",进入"WebSocket 服务器设置"。勾选"启用 WebSocket 服务器"。默认端口通常是 4455,如果在 OBS 里设置了服务器密码,就把同一个密码填到本软件里。</p>
          </article>
          <article>
            <strong>2. 连接并选择音源</strong>
            <p>打开设置 → 连接与设备，展开“OBS 连接”并确认主机为 127.0.0.1。连接成功后，在同一页展开“守护音源”，选择主播麦克风、无线领夹麦、声卡输入或直播主混音。图片、文字、显示器采集等无声音源会自动过滤。</p>
          </article>
          <article>
            <strong>3. 设置静音报警规则</strong>
            <p>在设置 → 检测规则中调整静音时长和静音阈值；预警比例、报警外观和提示音位于“提醒与窗口”。默认连续静音 120 秒报警，90 秒时先预警，阈值通常保持 -55 dB。</p>
          </article>
          <article>
            <strong>4. 不开播时测试</strong>
            <p>OBS 已连接但还没推流时，可以在设置 → 维护工具中展开“检测与调试”，打开“模拟开播检测”。这样可以测试静音计时、电平表和报警弹窗，测试完成后请关闭模拟开播。</p>
          </article>
          <article>
            <strong>5. 直播中怎么用</strong>
            <p>平时看主界面顶部状态和中栏大电平表即可。需要临时调试时点"暂停检测";需要常驻角落观察时点"打开小浮窗";连接异常时点"重连 OBS"。</p>
          </article>
          <article>
            <strong>6. 覆盖安装升级</strong>
            <p>本软件支持覆盖安装。下载新版本安装包,直接运行安装即可,本地设置和报警历史会自动保留。</p>
          </article>
        </div>
        <button type="button" className="btn-primary" onClick={onClose} style={{ alignSelf: 'flex-end' }}>
          <Check size={14} /> 我知道了
        </button>
      </section>
    </div>
  );
};
