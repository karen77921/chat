/** 续火花的各块：火焰印相、礼物卡上的小画、换一个 */
import { useState } from 'react';
import Icon from '../../design/icons.jsx';
import { Cyanotype, Wax } from '../../design/paper.jsx';
import Sheet from '../../design/Sheet.jsx';
import { Avatar } from '../../pages/Chat.jsx';
import { api } from '../../lib/api.js';

/** 蓝晒印相：一支蜡烛 + 白色火焰（代替照片） */
export function FlamePrint({ w = 118, h = 150 }) {
  const cx = w / 2;
  return (
    <div className="sp-print" style={{ width: w, height: h }} aria-hidden="true">
      <Cyanotype w={w} h={h} seed={7} variant="sprig" develop />
      <svg width={w} height={h} className="sp-flame">
        <circle cx={cx} cy={h * 0.42} r={w * 0.34} fill="#fff" opacity=".12" />
        <circle cx={cx} cy={h * 0.42} r={w * 0.22} fill="#fff" opacity=".1" />
        <rect x={cx - w * 0.09} y={h * 0.63} width={w * 0.18} height={h * 0.4} fill="#fff" opacity=".85" />
        <path d={`M${cx} ${h * 0.57}v${h * 0.07}`} stroke="#fff" strokeWidth="1.5" />
        <g className="sp-fire">
          <path fill="#fff" opacity=".95" d={`M${cx} ${h * 0.14}C${cx - w * 0.02} ${h * 0.24} ${cx - w * 0.16} ${h * 0.3} ${cx - w * 0.15} ${h * 0.44}C${cx - w * 0.14} ${h * 0.54} ${cx - w * 0.07} ${h * 0.6} ${cx} ${h * 0.6}C${cx + w * 0.07} ${h * 0.6} ${cx + w * 0.14} ${h * 0.54} ${cx + w * 0.15} ${h * 0.44}C${cx + w * 0.16} ${h * 0.3} ${cx + w * 0.04} ${h * 0.24} ${cx} ${h * 0.14}Z`} />
          <path style={{ fill: 'var(--print-a)' }} d={`M${cx} ${h * 0.3}C${cx - w * 0.03} ${h * 0.4} ${cx - w * 0.07} ${h * 0.5} ${cx} ${h * 0.57}C${cx + w * 0.07} ${h * 0.5} ${cx + w * 0.03} ${h * 0.4} ${cx} ${h * 0.3}Z`} />
        </g>
      </svg>
    </div>
  );
}

/** 礼物卡上的小画 */
export function GiftArt({ art, me, him, tall }) {
  const cls = `sp-art ${tall ? 'tall' : ''}`;
  if (art === 'bubble') return <div className={cls}><span className="sp-b1">你先说，我在听。</span><span className="sp-b2">这句留给你。</span></div>;
  if (art === 'pendant') {
    return (
      <div className={`${cls} sp-pend`}>
        <span className="sp-pa"><Avatar m={me} size={40} /><i className="sp-moon" /></span>
        <span className="sp-pa"><Avatar m={him} size={40} /><i className="sp-star" /></span>
      </div>
    );
  }
  if (art === 'ticket') return <div className={cls}><span className="sp-ticket">两张座位 · 今晚</span></div>;
  if (art === 'book') {
    return <div className={cls}><svg width="56" height="44" viewBox="0 0 56 44" aria-hidden="true"><path d="M4 6q12-4 24 2v32q-12-6-24-2z" fill="var(--sheet)" stroke="var(--print-b)" /><path d="M52 6q-12-4-24 2v32q12-6 24-2z" fill="var(--sheet)" stroke="var(--print-b)" /><path d="M38 6v14l3-3 3 3V5" style={{ fill: 'var(--print-a)' }} stroke="var(--print-c)" /></svg></div>;
  }
  if (art === 'letter') {
    return <div className={cls}><svg width="66" height="46" viewBox="0 0 66 46" aria-hidden="true"><rect x="2" y="4" width="62" height="40" rx="2" fill="var(--sheet)" stroke="var(--print-b)" /><path d="M2 4l31 22L64 4" fill="none" stroke="var(--print-b)" /></svg><Wax size={22} className="sp-wax" /></div>;
  }
  return <div className={cls}><Icon name="gift" size={46} stroke={1} /><span className="serif sp-q">?</span></div>;
}

/** 换一个：用我的积分，或者让他换给我（他同意了才扣） */
export function Redeem({ item, wallets, names, me, him, onClose, onDone }) {
  const [wallet, setWallet] = useState('me');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api('/api/spark/redeem', { method: 'POST', body: { itemId: item.id, wallet } });
      onDone(r, wallet);
    } catch (e) { setErr(e.message || '没换成，再试一次'); } finally { setBusy(false); }
  };
  const opts = [
    ['me', '我的钱包', wallets.me, wallets.me >= item.cost ? '够了' : `还差 ${item.cost - wallets.me} 分`, wallets.me >= item.cost],
    ['him', '让他换给我', wallets.him, '等待接入他确认的流程', false],
  ];
  return (
    <Sheet open onClose={onClose} label={`换「${item.name}」`} seed={53}>
      <GiftArt art={item.art} me={me} him={him} tall />
      <h2 className="sp-r-name">{item.name}</h2>
      <p className="sp-r-sub">{item.sub}{item.cat === 'date' ? '。约好的会出现在「一起」的片单 / 安排里。' : item.cat === 'bubble' || item.cat === 'pendant' ? '。换了以后在「收藏」里打开就能用。' : ''}</p>
      <div className="nc-k">用谁的积分</div>
      <div className="nc-opts" role="radiogroup" aria-label="用谁的积分">
        {opts.map(([k, n, pts, sub, can]) => (
          <button key={k} type="button" role="radio" aria-checked={wallet === k} disabled={!can} className={`card nc-opt ${wallet === k ? 'on' : ''}`} onClick={() => setWallet(k)}>
            <span className="nc-dot">{wallet === k && <i />}</span>
            <span><b>{n}</b><em>{sub}</em></span>
            <span className="serif sp-pts">{pts}</span>
          </button>
        ))}
      </div>
      {err && <div className="ws-err" role="alert">{err}</div>}
      <button type="button" className="btn-main nc-go" disabled={busy || wallets.me < item.cost} onClick={go}>换 · {item.cost} 分</button>
    </Sheet>
  );
}
