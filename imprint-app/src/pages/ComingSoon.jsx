/** 还没做的页面先放一张便签 */
import { TornBox, Cyanotype } from '../design/paper.jsx';

export default function ComingSoon({ title: [zh, en] }) {
  return (
    <main style={{ maxWidth: 430, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + 80px) 24px 140px' }}>
      <TornBox seed={7} innerStyle={{ padding: '28px 26px 30px', display: 'flex', gap: 18, alignItems: 'center' }} style={{ rotate: '-1deg' }}>
        <Cyanotype w={72} h={92} seed={5} variant="sprig" />
        <div>
          <div className="hand" style={{ fontSize: 30, color: 'var(--accent)', lineHeight: 1 }}>{en}</div>
          <div style={{ fontSize: 17, letterSpacing: '.14em', fontWeight: 400, marginTop: 6 }}>{zh}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>这一页还在做，先回首页看看吧。</div>
          <a href="#/" className="btn-main" style={{ marginTop: 14, height: 38, fontSize: 12.5 }}>回首页</a>
        </div>
      </TornBox>
    </main>
  );
}
