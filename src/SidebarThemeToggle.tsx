import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type { ThemeMode } from './domain';
import './SidebarThemeToggle.css';

function displayedMode(): ThemeMode {
  return document.documentElement.dataset.mode === 'light' ? 'light' : 'dark';
}

export default function SidebarThemeToggle({ disabled, onToggle }: {
  disabled: boolean;
  onToggle: (mode: ThemeMode) => Promise<void>;
}) {
  const [mode, setMode] = useState(displayedMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(displayedMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    setMode(displayedMode());
    return () => observer.disconnect();
  }, []);
  return <button type="button" className="sidebar-theme-toggle" role="switch" aria-label="Dark mode" aria-checked={mode === 'dark'} disabled={disabled}
    title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} mode`} onClick={() => void onToggle(mode === 'dark' ? 'light' : 'dark')}>
    {mode === 'dark' ? <Moon size={17} /> : <Sun size={17} />}<span>{mode === 'dark' ? 'Dark mode' : 'Light mode'}</span>
    <span className="theme-switch-track" aria-hidden="true"><span /></span>
  </button>;
}
