/**
 * 04 小屋：他住的地方。此刻在做什么、一起听 / 看入口、照片墙 / 独处 / 表情包三个分页。
 * 网址：#/room   ?tab=photos|solo|stickers
 * 数据：GET /api/room、/api/room/photos、/api/room/solo、/api/stickers（字段见 src/lib/mock.js 和 docs/04-小屋.md）
 */
import { useEffect, useRef, useState } from 'react';
import Icon from '../design/icons.jsx';
import { Band } from '../design/paper.jsx';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { replaceQuery } from '../lib/router.js';
import { NowCard, TogetherRow, PhotoWall, PhotoView, Solo, Stickers } from '../components/room/Parts.jsx';
import '../components/room/room.css';

const TABS = [['photos', '照片墙'], ['solo', '独处'], ['stickers', '表情包']];
const upload = (file, kind) => { const f = new FormData(); f.append('file', file); f.append('kind', kind); return api('/api/chat/upload', { method: 'POST', form: f, timeout: 60000 }); };

export default function Room({ query }) {
  const [tab, setTab] = useState(TABS.some(([k]) => k === query.tab) ? query.tab : 'photos');
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState('');
  const fileIn = useRef(null);
  useEffect(() => { if (TABS.some(([k]) => k === query.tab)) setTab(query.tab); }, [query.tab]);

  const { data: home } = useLoad('/api/room');
  const photoPath = `/api/room/photos${filter === 'fav' ? '?fav=1' : filter === 'chat' ? '?source=chat' : filter ? `?who=${filter}` : ''}`;
  const photos = useLoad(tab === 'photos' ? photoPath : null);
  const solo = useLoad(tab === 'solo' ? '/api/room/solo' : null);
  const stickers = useLoad(tab === 'stickers' ? '/api/stickers' : null);
  const now = home?.now ? new Date(home.now) : new Date();
  const ok = home && home.available !== false;

  const pick = (k) => { setTab(k); replaceQuery({ tab: k }); };
  const addPhotos = async (files) => {
    const list = [...files].slice(0, 9);
    if (!list.length) return;
    setBusy(`正在贴 ${list.length} 张…`);
    try {
      for (const f of list) {
        const u = await upload(f, 'photo');
        const p = await api('/api/room/photos', { method: 'POST', body: { url: u.url, caption: '' } });
        photos.setData((d) => (d?.items ? { ...d, total: d.total + 1, items: [{ ...p, fresh: true }, ...d.items] } : d));
      }
      pick('photos');
    } finally { setBusy(''); }
  };
  const changePhoto = (p) => { setOpen(p); photos.setData((d) => ({ ...d, items: d.items.map((x) => (x.id === p.id ? p : x)) })); };

  return (
    <main className="room">
      <header className="rm-head">
        <h1><span className="hand">the room</span><span>小屋</span></h1>
        <button type="button" className="rbtn" aria-label="贴一张照片" disabled={home?.recording === false} onClick={() => fileIn.current.click()}><Icon name="plus" size={18} stroke={1.5} /></button>
        <p>他住的地方：照片、独处的时候、画的表情</p>
      </header>

      {data_offline(home)}
      {home?.recording === false && <div className="card rm-empty" style={{ margin: '16px 24px 0' }}>小屋还没有你们自己的记录。照片、独处和表情的真实保存尚未接入，参考内容已清空。</div>}
      {ok && <NowCard current={home.current} now={now} />}
      {ok && <TogetherRow listen={home.listen} watch={home.watch} />}

      <div className="rm-tabs" role="tablist" aria-label="小屋分页">
        {TABS.map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => pick(k)}>{n}</button>)}
        <span className="rm-count">{tab === 'photos' && photos.data?.total ? `${photos.data.total} 张` : tab === 'solo' && solo.data?.monthCount ? `这个月 ${solo.data.monthCount} 次` : ''}</span>
      </div>
      {busy && <div className="rm-tip" role="status">{busy}</div>}

      <Band tone="l1" seed={21 + TABS.findIndex(([k]) => k === tab)} className="rm-band">
        {tab === 'photos' && <PhotoWall data={photos.data} filter={filter} setFilter={setFilter} onOpen={setOpen} names={home?.names} />}
        {tab === 'solo' && <Solo data={solo.data} now={now} />}
        {tab === 'stickers' && (home?.recording === false ? <div className="card rm-empty">这里还没有你们的表情。</div> : <Stickers data={stickers.data} setData={stickers.setData} onUpload={upload} />)}
      </Band>

      {open && <PhotoView photo={open} names={home?.names} onClose={() => setOpen(null)} onChange={changePhoto}
        onDelete={(id) => { setOpen(null); photos.setData((d) => ({ ...d, total: d.total - 1, items: d.items.filter((x) => x.id !== id) })); }} />}
      <input ref={fileIn} type="file" accept="image/*" multiple hidden onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }} />
    </main>
  );
}

function data_offline(home) {
  return home?.available === false ? <div className="card rm-empty" style={{ margin: '16px 24px 0' }}>暂时连不上他那边，过一会儿再来。</div> : null;
}
