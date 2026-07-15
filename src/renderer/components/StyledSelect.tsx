import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Palette } from 'lucide-react';
import { ATEM_MORANDI_COLORS } from '../../shared/atemPalette';

export interface StyledSelectOption<T extends string | number> {
  value: T;
  label: string;
  description?: string;
  swatch?: string;
}

interface StyledSelectProps<T extends string | number> {
  value: T;
  options: StyledSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  placeholder?: string;
}

interface PopoverPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placeAbove: boolean;
}

function popoverPosition(element: HTMLElement, preferredWidth?: number): PopoverPosition {
  const rect = element.getBoundingClientRect();
  const margin = 10;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(viewportWidth - margin * 2, Math.max(rect.width, preferredWidth ?? 0));
  const availableBelow = viewportHeight - rect.bottom - margin;
  const availableAbove = rect.top - margin;
  const placeAbove = availableBelow < 180 && availableAbove > availableBelow;
  const maxHeight = Math.max(120, Math.min(300, placeAbove ? availableAbove - 6 : availableBelow - 6));
  const left = Math.min(viewportWidth - width - margin, Math.max(margin, rect.left));
  return {
    top: placeAbove ? rect.top - 8 : rect.bottom + 8,
    left,
    width,
    maxHeight,
    placeAbove
  };
}

export function StyledSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  placeholder = '请选择'
}: StyledSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => triggerRef.current && setPosition(popoverPosition(triggerRef.current, 220));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`styled-select ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`styled-select-trigger ${open ? 'open' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="styled-select-value">
          {selected?.swatch && <i style={{ background: selected.swatch }} />}
          <b>{selected?.label ?? placeholder}</b>
        </span>
        <ChevronDown size={16} />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          className={`styled-select-menu ${position.placeAbove ? 'above' : ''}`}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            top: position.placeAbove ? position.top : position.top,
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
            transform: position.placeAbove ? 'translateY(-100%)' : undefined
          }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={active}
                className={`styled-select-option ${active ? 'active' : ''}`}
                key={String(option.value)}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                {option.swatch && <i className="styled-select-swatch" style={{ background: option.swatch }} />}
                <span><b>{option.label}</b>{option.description && <small>{option.description}</small>}</span>
                {active && <Check size={16} />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}

export function MorandiColorPicker({ value, onChange, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => triggerRef.current && setPosition(popoverPosition(triggerRef.current, 214));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);

  return (
    <div className="morandi-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`morandi-picker-trigger ${open ? 'open' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <i style={{ background: value }} />
        <Palette size={14} />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          className={`morandi-picker-menu ${position.placeAbove ? 'above' : ''}`}
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            transform: position.placeAbove ? 'translateY(-100%)' : undefined
          }}
        >
          <strong>机位识别色</strong>
          <span>低饱和配色，适合长时间监看</span>
          <div className="morandi-picker-grid">
            {ATEM_MORANDI_COLORS.map((color, index) => (
              <button
                type="button"
                key={color}
                className={color.toUpperCase() === value.toUpperCase() ? 'active' : ''}
                style={{ background: color }}
                aria-label={`莫兰迪颜色 ${index + 1}`}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
              >
                {color.toUpperCase() === value.toUpperCase() && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
