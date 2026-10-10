/**
 * 底部弹出的纸：上边撕开，点外面或「取消」关掉。
 */
import { useMemo } from 'react';
import { bandPolygon } from './paper.jsx';
import './sheet.css';

export default function Sheet({ open, onClose, label, seed = 12, children }) {
  const clip = useMemo(() => bandPolygon(seed), [seed]);
  if (!open) return null;
  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="sheet-mask" aria-label="关闭" onClick={onClose} />
      <div className="sheet-panel">
        <div className="sheet-bg" style={{ clipPath: clip }} aria-hidden="true" />
        <i className="sheet-handle" aria-hidden="true" />
        <div className="sheet-in">{children}</div>
      </div>
    </div>
  );
}
