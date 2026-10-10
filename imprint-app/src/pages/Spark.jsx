/**
 * 08 续火花（赠送页）：每天互相说一句话就续上一天；攒积分在礼物铺换小礼物；收藏里用上气泡 / 挂件、看兑换记录。
 * 网址：#/spark   ?tab=spark|shop|kept
 * 数据：GET /api/spark、/api/spark/shop、/api/spark/kept，POST /api/spark/redeem 等（字段见 src/lib/mock.js 和 docs/08-续火花.md）
 */
import { useEffect, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Band, TornBox, Tape } from '../design/paper.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import { Avatar } from './Chat.jsx';
import { FlamePrint, GiftArt, Redeem } from '../components/spark/Parts.jsx';
import '../components/chat/chat.css';
import '../components/chat/chatlist.css';
import '../components/spark/spark.css';

const TABS = [['spark', '火花', 'flame'], ['shop', '礼物铺', 'gift'], ['kept', '收藏', 'sparkle']];
const CATS = [['', '全部'], ['bubble', '气泡'], ['pendant', '挂件'], ['date', '约会'], ['real', '真礼物'], ['box', '盲盒']];
const ME = { id: 'me', name: '我', color: '#AED0EE' };
const HIM = { id: 'him', name: '他' };

export default function Spark({ query }) {
  const [tab, setTab] = useState(TABS.some(([k]) => k === query.tab) ? query.tab : 'spark');
  useEffect(() => { if (TABS.some(([k]) => k === query.tab)) setTab(query.tab); }, [query.tab]);
  const pick = (k) => { setTab(k); replaceQuery({ tab: k }); window.scrollTo(0, 0); };
  const back = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
  const head = {
    spark: ['spark', '续火花', '每天互相说一句话，攒一点小礼物。'],
    shop: ['gifts', '小礼物铺', '挑一个喜欢的，留一点期待。'],
    kept: ['kept', '收好的小礼物', '送出的、约好的，都能回来看看。'],
  }[tab];

  return (
    <main className="spark">
      <header className="sp-head">
        <button type="button" className="rbtn" aria-label="返回" onClick={back}><Icon name="back" size={18} stroke={1.5} /></button>
        <span className="serif sp-k">IMPRINT · {head[0].toUpperCase()}</span>
        <h1><span className="hand">{head[0]}</span><span>{head[1]}</span></h1>
        <p>{head[2]}</p>
      </header>
      {tab === 'spark' && <SparkTab />}
      {tab === 'shop' && <ShopTab />}
      {tab === 'kept' && <KeptTab />}
      <nav className="tabbar sp-seg" aria-label="续火花分页">
        {TABS.map(([k, n, ic]) => (
          <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} className={tab === k ? 'on' : ''} onClick={() => pick(k)}><Icon name={ic} size={20} />{n}</button>
        ))}
      </nav>
    </main>
  );
}

function SparkTab() {
  const { data, setData } = useLoad('/api/spark');
  const [tip, setTip] = useState('');
  if (!data) return <div className="card cl-empty sp-pad">正在翻…</div>;
  if (data.available === false) return <div className="card cl-empty sp-pad">暂时连不上，过一会儿再来看看。</div>;
  if (data.recording === false) return <div className="card cl-empty sp-pad">还没有你们的火花记录。不会用参考天数代替；真实统计接入后再从你们的聊天开始计算。</div>;
  const names = data.names;
  const him = { ...HIM, name: names?.him };
  const missed = data.week.find((d) => !d.done);
  const useCard = async () => {
    if (!missed) { setTip(`续火卡留着：哪天断了，在这里补上那一天。每满 ${data.cards.every} 天收到一张。`); return; }
    await api('/api/spark/cards/use', { method: 'POST', body: { date: missed.date } });
    setData((d) => ({ ...d, cards: { ...d.cards, count: d.cards.count - 1 }, week: d.week.map((x) => (x.date === missed.date ? { ...x, done: true } : x)) }));
    setTip('补上了');
  };
  const todayKey = data.now?.slice(0, 10);
  return (
    <div className="sp-body">
      <div className="sp-streak-wrap">
        <TornBox seed={121} className="sp-streak" innerStyle={{ padding: '18px 140px 18px 20px', minHeight: 156 }}>
          <div className="sp-st-k"><Icon name="flame" size={14} />你们的小火苗，{data.streak.days ? '连着呢' : '今天点一下吧'}</div>
          <div className="sp-days"><span className="serif">{data.streak.days}</span>天</div>
          <div className="hand-cn sp-today">{data.streak.today.me && data.streak.today.him ? '今天的火花，也续上了。' : '今天还差一句，就续上了。'}</div>
        </TornBox>
        <div className="sp-print-wrap drop2"><FlamePrint /></div>
        <Tape w={60} h={18} seed={123} className="m-breeze-tape" style={{ right: 36, top: -10, rotate: '-6deg' }} />
      </div>

      <div className="card sp-who">
        <span><span className="sp-av"><Avatar m={ME} size={30} /></span>你 · <b className={data.streak.today.me ? 'ok' : ''}>{data.streak.today.me ? '已说过话' : '还没说'}</b></span>
        <span><span className="sp-av"><Avatar m={him} size={30} /></span>{names?.him} · <b className={data.streak.today.him ? 'ok' : ''}>{data.streak.today.him ? '已回过话' : '还没回'}</b></span>
      </div>

      <ol className="card sp-week" aria-label="最近七天">
        {data.week.map((d) => (
          <li key={d.date} className={`${d.done ? 'done' : ''} ${d.date === todayKey ? 'today' : ''}`}>
            <span className="sp-stamp">{d.done ? <Icon name="check" size={16} stroke={1.8} /> : <Icon name="close" size={12} stroke={1.6} />}</span>
            <span className="serif">{d.date.slice(5).replace('-', '.')}</span>
          </li>
        ))}
      </ol>

      <button type="button" className="card sp-card" onClick={useCard}>
        <span className="sp-card-i"><Icon name="flame" size={16} /></span>
        <span><b>续火卡 · {data.cards.count} 张</b><em>每满 {data.cards.every} 天收到一张，断了的那天可以补上</em></span>
        <span className="sp-go">{missed && data.cards.count ? '补上 →' : '怎么用 →'}</span>
      </button>
      {tip && <div className="rm-tip" role="status">{tip}</div>}

      <div className="sec-head sp-sec"><span className="en" style={{ fontSize: 24 }}>two purses</span><h2 className="zh" style={{ margin: 0, fontSize: 14 }}>两只小钱袋</h2><span className="go">积分分开攒</span></div>
      <div className="sp-purses">
        <div className="card sp-purse"><span className="sp-pav"><Avatar m={ME} size={32} /></span><em>你的钱包</em><b className="serif">{data.wallets.me}</b><small>积分</small></div>
        <div className="card sp-purse him"><span className="sp-pav"><Avatar m={him} size={32} /></span><em>{names?.him} 的钱包</em><b className="serif">{data.wallets.him}</b><small>积分 · 他给你换</small></div>
      </div>

      <div className="sec-head sp-sec"><span className="en" style={{ fontSize: 24 }}>milestones</span><h2 className="zh" style={{ margin: 0, fontSize: 14 }}>攒到这里</h2></div>
      <div className="sp-miles">
        {data.milestones.map((m) => (
          <div key={m.days} className={`card sp-mile ${m.reached ? 'got' : ''}`}>
            <span className="serif"><b>{m.days}</b>天</span>
            <em>{m.reward}</em>
            <i>{m.reached ? <Icon name="check" size={13} stroke={1.8} /> : <Icon name="lock" size={13} stroke={1.5} />}</i>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShopTab() {
  const [cat, setCat] = useState('');
  const [who, setWho] = useState('him');
  const [item, setItem] = useState(null);
  const [tip, setTip] = useState('');
  const { data, setData } = useLoad(`/api/spark/shop${cat ? `?cat=${cat}` : ''}`);
  const names = data?.names || { me: '我', him: '他' };
  if (!data) return <div className="card cl-empty sp-pad">正在翻…</div>;
  if (data.available === false) return <div className="card cl-empty sp-pad">暂时连不上，过一会儿再来看看。</div>;
  if (data.recording === false) return <div className="card cl-empty sp-pad">礼物铺尚未接入真实积分与兑换，参考商品已清空。</div>;
  const him = { ...HIM, name: names.him };
  return (
    <div className="sp-body">
      <div className="card sp-wallet">
        <span><b>{who === 'him' ? `${names.him} 的钱包 · 只看，不代扣` : '我的钱包'}</b>
          <button type="button" onClick={() => setWho((w) => (w === 'him' ? 'me' : 'him'))}>{who === 'him' ? '换成看我的' : `换成看${names.him}的`}</button></span>
        <span className="sp-wallet-n"><b className="serif">{data.wallets[who]}</b>积分</span>
      </div>
      <div className="sp-cats" role="group" aria-label="分类">
        {CATS.map(([k, n]) => <button key={k} type="button" className={`chip ${cat === k ? 'on' : ''}`} aria-pressed={cat === k} onClick={() => setCat(k)}>{n}</button>)}
      </div>
      {tip && <div className="rm-tip" role="status">{tip}</div>}
      <Band tone="l1" seed={51} className="sp-band">
        <div className="sp-grid">
          {data.items.map((g) => (
            <button key={g.id} type="button" className="card sp-gift press" onClick={() => setItem(g)} aria-label={`${g.name}，${g.cost} 分`}>
              <GiftArt art={g.art} me={ME} him={him} />
              <b>{g.name}</b>
              <em>{g.sub}</em>
              <span className="sp-gift-f"><span><span className="serif">{g.cost}</span>分</span><span className={g.owned ? 'ok' : ''}>{g.owned ? '已收好' : '看看 →'}</span></span>
            </button>
          ))}
          {!data.items.length && <div className="card cl-empty">这一类还没有上架</div>}
        </div>
      </Band>
      {item && (
        <Redeem item={item} wallets={data.wallets} names={names} me={ME} him={him} onClose={() => setItem(null)}
          onDone={(r, wallet) => {
            setItem(null);
            if (r.wallets) setData((d) => ({ ...d, wallets: r.wallets, items: d.items.map((x) => (x.id === item.id && (x.cat === 'bubble' || x.cat === 'pendant') ? { ...x, owned: true } : x)) }));
            setTip(wallet === 'him' ? `问过 ${names.him} 了，他点头就换好` : '换好了，在「收藏」里');
            setTimeout(() => setTip(''), 2400);
          }} />
      )}
    </div>
  );
}

function KeptTab() {
  const [sub, setSub] = useState('kept');
  const { data, setData } = useLoad('/api/spark/kept');
  if (!data) return <div className="card cl-empty sp-pad">正在翻…</div>;
  if (data.available === false) return <div className="card cl-empty sp-pad">暂时连不上，过一会儿再来看看。</div>;
  if (data.recording === false) return <div className="card cl-empty sp-pad">这里还没有你们收藏或兑换的小礼物。</div>;
  const toggle = (k) => {
    const active = !k.active;
    setData((d) => ({ ...d, kept: d.kept.map((x) => (x.cat === k.cat ? { ...x, active: x.id === k.id ? active : active ? false : x.active } : x)) }));
    api(`/api/spark/kept/${k.id}/active`, { method: 'POST', body: { active } });
  };
  return (
    <div className="sp-body">
      <div className="sp-cats" role="tablist">
        <button type="button" role="tab" aria-selected={sub === 'kept'} className={`chip ${sub === 'kept' ? 'on' : ''}`} onClick={() => setSub('kept')}>气泡与挂件</button>
        <button type="button" role="tab" aria-selected={sub === 'records'} className={`chip ${sub === 'records' ? 'on' : ''}`} onClick={() => setSub('records')}>兑换记录</button>
      </div>
      <Band tone="l1" seed={52} className="sp-band">
        {sub === 'kept' && (
          <>
            {data.kept.map((k) => {
              const d = new Date(k.at);
              return (
                <div key={k.id} className="card sp-kept">
                  <GiftArt art={k.art} me={ME} him={HIM} />
                  <div>
                    <b>{k.name}</b>
                    <em>{k.cat === 'bubble' ? '气泡' : '挂件'} · {d.getMonth() + 1}月{d.getDate()}日换的</em>
                    <label className="sp-use"><span>{k.active ? '使用中' : '没用上'}</span><input type="checkbox" className="switch" checked={!!k.active} onChange={() => toggle(k)} /></label>
                  </div>
                </div>
              );
            })}
            {!data.kept.length && <div className="card cl-empty">还没有新气泡和挂件。<br />喜欢哪一套，再把它收进来。</div>}
          </>
        )}
        {sub === 'records' && (
          <>
            {data.records.map((r) => {
              const d = new Date(r.at);
              return (
                <div key={r.id} className="card sp-rec">
                  <span className="sp-rec-i"><Icon name="gift" size={18} /></span>
                  <span><b>{r.name}</b><em>{r.by === 'him' ? '他换给你' : '你换的'} · {d.getMonth() + 1}月{d.getDate()}日</em></span>
                  <span className={`sp-rec-s ${r.status}`}>{r.note}</span>
                </div>
              );
            })}
            {!data.records.length && <div className="card cl-empty">还没有换过东西</div>}
          </>
        )}
      </Band>
    </div>
  );
}
