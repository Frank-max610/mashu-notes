import { useRef, useState } from 'react';
import { Icon } from '../components/Icon';

export interface HealthSyncScreenProps {
  onImport: (text: string) => Promise<number>;
  onNotify: (message: string) => void;
}

const LAST_KEY = 'mashu.health.lastSync.v1';

function lastSyncLabel(): string {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return '还没有同步过';
    const date = new Date(Number(raw));
    if (Number.isNaN(date.getTime())) return '还没有同步过';
    return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '还没有同步过';
  }
}

/** Apple Watch → Apple 健康 → 快捷指令 → 麻薯. HealthKit itself needs a native shell. */
export function HealthSyncScreen({ onImport, onNotify }: HealthSyncScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lastSync, setLastSync] = useState(lastSyncLabel);
  const [busy, setBusy] = useState(false);
  const url = `${typeof window !== 'undefined' ? window.location.origin + window.location.pathname : ''}?health=`;

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const count = await onImport(text);
      if (count > 0) {
        try {
          localStorage.setItem(LAST_KEY, String(Date.now()));
        } catch {
          /* ignore */
        }
        setLastSync(lastSyncLabel());
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen module-screen health-sync-screen">
      <header className="screen-header">
        <div>
          <h1 className="page-title">Apple 健康同步</h1>
          <p className="brand-date">Apple Watch → 健康 → 麻薯</p>
        </div>
      </header>
      <div className="screen-body">
        <div className="health-sync-status">
          <span className="health-sync-icon"><Icon name="heart" size={20} /></span>
          <div>
            <strong>{lastSync}</strong>
            <p>上次从健康导入的时间</p>
          </div>
        </div>

        <section>
          <div className="section-label">推荐方式 · 快捷指令自动同步</div>
          <ol className="health-sync-steps">
            <li>确认 iPhone「健康」里已经有 Apple Watch 的步数、睡眠、心率、体重数据。</li>
            <li>在「快捷指令」新建个人自动化：每天固定时间运行，读取需要的健康样本。</li>
            <li>把样本整理成 JSON 或 CSV，通过文件或下面的 URL 导入麻薯；URL 参数是 <code>?health=</code>。</li>
            <li>第一次手动跑通后，打开「每天运行」，Apple Watch 数据就会自动进麻薯。</li>
          </ol>
          <div className="health-sync-actions">
            <button type="button" className="btn btn-primary" onClick={() => void navigator.clipboard.writeText(url).then(() => onNotify('同步 URL 已复制，可放进快捷指令'))}>
              复制同步 URL
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? '正在导入…' : '选择健康导出文件'}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".json,.csv,.txt,application/json,text/csv,text/plain"
              hidden
              onChange={(event) => {
                void importFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
          <p className="settings-note">支持 JSON / CSV；同一天同一指标会合并，不会重复堆积。</p>
        </section>

        <section>
          <div className="section-label">关于直接连接 HealthKit</div>
          <p className="settings-note">
            网页版（PWA）无法直接读取 HealthKit，这是 iOS 的安全限制。要做到打开麻薯就自动拉取 Apple Watch 数据，
            需要 Capacitor 原生壳 + HealthKit 权限，并走 Xcode / TestFlight 签名；这需要 Mac 与 Apple 开发者账号。
            当前版本使用「健康 App + 快捷指令」的零服务器方案，数据全部导入本机。
          </p>
        </section>
      </div>
    </div>
  );
}
