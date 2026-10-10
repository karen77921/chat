/** 长按菜单：引用 / 复制 / 重新生成（他的）/ 编辑（我的文字）/ 删除，下面一排表情直接回应 */
import Icon from '../../design/icons.jsx';
import { Sticker } from './stickers.jsx';

const QUICK = ['cat-heart', 'cat-smile', 'star', 'moon', 'cat-cry'];

export default function MessageMenu({ m, rect, onClose, onQuote, onCopy, onRegenerate, onEdit, onDelete, onReact }) {
  const top = rect ? Math.min(rect.bottom + 8, window.innerHeight - 330) : 200;
  const mine = m.from === 'me';
  const items = [
    ['quote', '引用', () => onQuote(m)],
    m.type === 'text' && ['copy', '复制', () => onCopy(m)],
    !mine && ['redo', '重新生成这条', () => onRegenerate(m.id)],
    mine && m.type === 'text' && ['pen', '编辑', () => onEdit(m)],
    ['trash', '删除', () => onDelete(m.id), 'danger'],
  ].filter(Boolean);
  return (
    <div className="cmenu-layer" role="dialog" aria-label="消息操作">
      <button type="button" className="cmenu-mask" aria-label="关闭" onClick={onClose} />
      <div className={`cmenu ${mine ? 'me' : 'him'}`} style={{ top: Math.max(120, top) }}>
        <div className="cmenu-list glass">
          {items.map(([ic, name, fn, tone]) => (
            <button key={name} type="button" className={tone || ''} onClick={() => { fn(); onClose(); }}><Icon name={ic} size={18} />{name}</button>
          ))}
        </div>
        {!mine && (
          <div className="cmenu-react glass" role="group" aria-label="用表情回一下">
            {QUICK.map((id) => <button key={id} type="button" onClick={() => { onReact(m.id, id); onClose(); }}><Sticker sticker={{ id }} size={30} /></button>)}
          </div>
        )}
      </div>
    </div>
  );
}
