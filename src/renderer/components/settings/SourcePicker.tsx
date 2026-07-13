import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Mic2, RefreshCw, Search } from 'lucide-react';
import type { InputOption } from '../../../shared/types';
import { readableInputKind } from '../../utils/status';

interface SourcePickerProps {
  inputs: InputOption[];
  value: string;
  values?: string[];
  onChange: (value: string) => void;
  onChangeMany?: (value: string[]) => void;
  onRefresh: () => void;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export const SourcePicker: React.FC<SourcePickerProps> = ({ inputs, value, values, onChange, onChangeMany, onRefresh }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const positionRafRef = useRef<number | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPosition>({ top: 0, left: 0, width: 0, maxHeight: 320 });

  const selectedValues = values && values.length > 0 ? values : value ? [value] : [];
  const selected = inputs.find((input) => input.inputName === selectedValues[0]);
  const multiSelect = Boolean(onChangeMany);
  const filtered = inputs.filter((input) =>
    input.inputName.toLowerCase().includes(query.trim().toLowerCase())
  );

  // 计算菜单的 viewport 坐标；菜单通过 portal 挂到 body，避免被设置弹窗裁切。
  const computePos = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 14;
    const preferredHeight = 344;
    const below = window.innerHeight - rect.bottom - margin;
    const above = rect.top - margin;
    const shouldOpenAbove = below < 240 && above > below;
    const maxHeight = Math.max(220, Math.min(preferredHeight, shouldOpenAbove ? above : below));
    setMenuPos({
      top: shouldOpenAbove ? Math.max(margin, rect.top - maxHeight - 8) : rect.bottom + 8,
      left: rect.left,
      width: rect.width,
      maxHeight
    });
  }, []);

  // 打开/关闭时计算坐标 + 监听滚动
  useEffect(() => {
    if (open) {
      // 用 rAF 确保 DOM 已布局,再拿坐标
      positionRafRef.current = requestAnimationFrame(() => {
        positionRafRef.current = null;
        computePos();
      });
      const scheduleComputePos = () => {
        if (positionRafRef.current !== null) return;
        positionRafRef.current = requestAnimationFrame(() => {
          positionRafRef.current = null;
          computePos();
        });
      };
      // 监听所有滚动事件(包括 .settings-content 内部滚动)
      window.addEventListener('scroll', scheduleComputePos, true);
      window.addEventListener('resize', scheduleComputePos);
      return () => {
        if (positionRafRef.current !== null) {
          cancelAnimationFrame(positionRafRef.current);
          positionRafRef.current = null;
        }
        window.removeEventListener('scroll', scheduleComputePos, true);
        window.removeEventListener('resize', scheduleComputePos);
      };
    }
    return undefined;
  }, [open, computePos]);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="source-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`source-picker-trigger ${open ? 'open' : ''}`}
        onClick={() => {
          computePos();
          setOpen((next) => !next);
        }}
      >
        <span className="source-picker-icon"><Mic2 size={18} /></span>
        <span className="source-picker-body">
          <span className="source-picker-title">
            {selectedValues.length > 1
              ? `已选择 ${selectedValues.length} 路音源`
              : selected?.inputName || value || '选择可能有声音的 OBS 音源'}
          </span>
          <span className="source-picker-sub">
            {selectedValues.length > 1
              ? selectedValues.join('、')
              : selected
                ? readableInputKind(selected.inputKind)
                : inputs.length > 0
                  ? `${inputs.length} 个可检测音源`
                  : '请先连接 OBS 或刷新音源'}
          </span>
        </span>
        <ChevronDown size={18} className={open ? 'rotate' : ''} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="source-picker-menu"
          style={{
            position: 'fixed',
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`,
            width: `${menuPos.width}px`,
            maxHeight: `${menuPos.maxHeight}px`
          }}
        >
          <div className="source-picker-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索麦克风、声卡、主混音"
              autoFocus
            />
          </div>
          <div className="source-picker-list">
            {filtered.length === 0 ? (
              <div className="source-picker-empty">
                没有可选音频源<br />
                <span className="source-picker-empty-hint">已过滤图片/文字/显示器采集等无声音源</span>
              </div>
            ) : (
              filtered.map((input) => (
                <button
                  key={`${input.inputKind}:${input.inputName}`}
                  type="button"
                  className={`source-picker-option ${selectedValues.includes(input.inputName) ? 'active' : ''}`}
                  onClick={() => {
                    if (!multiSelect) {
                      onChange(input.inputName);
                      setOpen(false);
                      setQuery('');
                      return;
                    }
                    const next = selectedValues.includes(input.inputName)
                      ? selectedValues.filter((name) => name !== input.inputName)
                      : [...selectedValues, input.inputName];
                    onChangeMany?.(next);
                    onChange(next[0] ?? '');
                  }}
                >
                  <Mic2 size={14} />
                  <span className="source-picker-option-copy">
                    <strong>{input.inputName}</strong>
                    <em>{readableInputKind(input.inputKind)}</em>
                  </span>
                  {selectedValues.includes(input.inputName) && <Check size={14} />}
                </button>
              ))
            )}
          </div>
          <button type="button" className="source-picker-refresh" onClick={onRefresh}>
            <RefreshCw size={13} />
            重新读取 OBS 音源
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};
