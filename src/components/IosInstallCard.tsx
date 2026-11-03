import { useEffect, useState } from 'react';
import { Icon } from './Icon';

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

/** True when the app is running from the iOS/Android Home Screen. */
export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorStandalone = window.navigator as NavigatorStandalone;
  return (
    navigatorStandalone.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

/** True for iPhone/iPad (including iPadOS which reports a Mac user agent). */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || /^(iPhone|iPad|iPod)$/.test(navigator.platform);
}

export interface IosInstallCardProps {
  onCopyLink: () => void;
}

/**
 * iPhone-first delivery card: 麻薯 has no server, so the whole app is installed
 * to the Home Screen from Safari and then runs (and saves data) offline.
 */
export function IosInstallCard({ onCopyLink }: IosInstallCardProps) {
  const [installed, setInstalled] = useState(() => isStandaloneMode());
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const onDisplayChange = () => setInstalled(isStandaloneMode());
    media.addEventListener?.('change', onDisplayChange);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => setOfflineReady(Boolean(registration.active)))
        .catch(() => setOfflineReady(false));
    }
    return () => {
      media.removeEventListener?.('change', onDisplayChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const ios = isIosDevice();

  return (
    <div className="install-card">
      <div className="install-card-head">
        <span className={`install-card-icon${installed ? ' is-done' : ''}`}>
          <Icon name={installed ? 'check' : 'external'} size={20} />
        </span>
        <div className="install-card-copy">
          <div className="install-card-title">{installed ? '已装到主屏幕' : '装到 iPhone 上'}</div>
          <div className="install-card-hint">
            {installed
              ? '从主屏幕图标打开，所有记录和助手都在手机上，断网也能用。'
              : '不需要服务器：用 Safari 打开本页，添加到主屏幕即可。'}
          </div>
        </div>
      </div>

      {!installed && ios ? (
        <ol className="install-steps">
          <li>确认现在用的是 <b>Safari</b>（不要在微信/其他 App 内打开）</li>
          <li>点 Safari 底部的「分享」按钮</li>
          <li>选择「添加到主屏幕」，再点「添加」</li>
          <li>以后从主屏幕图标打开就好</li>
        </ol>
      ) : null}

      {!installed && !ios ? (
        <p className="install-card-note">
          在 iPhone / iPad 的 Safari 中打开本页，再点「分享 → 添加到主屏幕」。
        </p>
      ) : null}

      <div className="install-status">
        <span className={`install-pill${online ? '' : ' is-offline'}`}>
          {online ? '在线' : '离线 · 数据仍在本机'}
        </span>
        <span className="install-pill">{offlineReady ? '离线壳已就绪' : '首次加载后可离线'}</span>
        <span className="install-pill">无需服务器</span>
        <span className="install-pill">数据不出设备</span>
      </div>

      <div className="install-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onCopyLink}>
          复制应用链接
        </button>
      </div>
    </div>
  );
}
