import { MochiNode } from './MochiNode';
import './SplashScreen.css';

/** Brief branded launch screen: logo + slogan, then the app fades in. */
export function SplashScreen() {
  return (
    <div className="splash" role="status" aria-label="麻薯正在启动">
      <div className="splash-stage">
        <div className="splash-orbit" aria-hidden="true">
          <span className="splash-node splash-node--a" />
          <span className="splash-node splash-node--b" />
          <span className="splash-node splash-node--c" />
          <span className="splash-ring" />
        </div>
        <div className="splash-mark">
          <MochiNode size={86} />
        </div>
      </div>
      <h1 className="splash-title">麻薯</h1>
      <p className="splash-slogan">记录每一天</p>
      <div className="splash-progress" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
