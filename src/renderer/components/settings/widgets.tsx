import React, { useEffect, useState } from 'react';

interface NumberFieldProps {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}

export const NumberField: React.FC<NumberFieldProps> = ({ value, min, max, step, suffix, onChange }) => {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '-' || trimmed === '.') { setText(String(value)); return; }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) { setText(String(value)); return; }
    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    setText(String(next));
    if (next !== value) onChange(next);
  };

  const stepBy = (direction: -1 | 1) => {
    const next = Math.min(max, Math.max(min, value + step * direction));
    setText(String(next));
    onChange(next);
  };

  return (
    <div className="number-field">
      <button type="button" className="number-field-step" onClick={() => stepBy(-1)} aria-label="减少数值">−</button>
      <div className="number-field-input-wrap">
        <input
          className="number-field-input"
          inputMode="numeric"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => commit(text)}
          onKeyDown={(event) => { if (event.key === 'Enter') commit(text); }}
        />
        {suffix && <span className="number-field-suffix">{suffix}</span>}
      </div>
      <button type="button" className="number-field-step" onClick={() => stepBy(1)} aria-label="增加数值">+</button>
    </div>
  );
};

interface ToggleRowProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description?: string;
  id?: string;
}

export const ToggleRow: React.FC<ToggleRowProps> = ({ checked, onChange, title, description, id }) => (
  <label className={`toggle-row ${checked ? 'on' : ''}`} htmlFor={id}>
    <div className="toggle-row-body">
      <span className="toggle-row-title">{title}</span>
      {description && <span className="toggle-row-sub">{description}</span>}
    </div>
    <span className="toggle-row-switch" aria-hidden="true">
      <span className="toggle-row-thumb" />
    </span>
    <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="toggle-row-input" />
  </label>
);

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-item ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
