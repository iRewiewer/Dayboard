import { useId } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import type { ThemePreference } from './domain';
import { THEME_OPTIONS } from './theme';
import './AppearancePanel.css';

export default function AppearancePanel({ value, onChange }: {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  const id = useId();
  const selectedName = THEME_OPTIONS.find((option) => option.id === value.color)?.name ?? 'Green';
  return <section className="settings-section appearance-panel" aria-labelledby={`${id}-heading`}>
    <div className="settings-section-heading appearance-heading">
      <div><h2 id={`${id}-heading`}>Appearance</h2><p>Preview changes here. Save settings to keep them.</p></div>
      <span className="appearance-current" role="status" aria-live="polite">{value.mode === 'dark' ? 'Dark' : 'Light'} · {selectedName}</span>
    </div>
    <fieldset className="appearance-modes">
      <legend>Mode</legend>
      {(['light', 'dark'] as const).map((mode) => <label key={mode} className={`appearance-mode ${value.mode === mode ? 'selected' : ''}`}>
        <input className="sr-only" type="radio" name={`${id}-mode`} value={mode} checked={value.mode === mode} onChange={() => onChange({ ...value, mode })} />
        {mode === 'dark' ? <Moon size={17} /> : <Sun size={17} />}<span>{mode === 'dark' ? 'Dark' : 'Light'}</span>
        {value.mode === mode && <Check size={14} className="mode-check" />}
      </label>)}
    </fieldset>
    <fieldset className="appearance-colors">
      <legend>Color</legend>
      <div className="appearance-color-grid">{THEME_OPTIONS.map((option) => <label key={option.id} className={`appearance-color ${value.color === option.id ? 'selected' : ''}`}>
        <input className="sr-only" type="radio" name={`${id}-accent`} value={option.id} checked={value.color === option.id} onChange={() => onChange({ ...value, color: option.id })} />
        <span className="appearance-swatch" style={{ background: option.swatch }} aria-hidden="true" /><span>{option.name}</span>
        {value.color === option.id && <Check size={13} className="color-check" />}
      </label>)}</div>
    </fieldset>
  </section>;
}
