import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { api } from '../lib/api.js';
import {
  GEMINI_MODEL_CHANGE_EVENT,
  getSelectedGeminiModel,
  setSelectedGeminiModel,
} from '../lib/geminiModel.js';

export default function GeminiModelPicker({
  aiEnabled,
  variant = 'button',
  onModelChange,
}) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(getSelectedGeminiModel);
  const inMenu = variant === 'menu';

  const loadModels = useCallback(async () => {
    if (!aiEnabled) return;
    setLoading(true);
    try {
      const data = await api.listGeminiModels();
      setModels(data.models || []);
      const stored = getSelectedGeminiModel();
      const ids = new Set((data.models || []).map((m) => m.id));
      if (ids.size && !ids.has(stored) && data.defaultModel) {
        setSelectedGeminiModel(data.defaultModel);
        setSelected(data.defaultModel);
      }
    } catch (err) {
      toast.error(err.message || 'Could not load Gemini models');
    } finally {
      setLoading(false);
    }
  }, [aiEnabled]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    const onChange = (e) => setSelected(e.detail || getSelectedGeminiModel());
    window.addEventListener(GEMINI_MODEL_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(GEMINI_MODEL_CHANGE_EVENT, onChange);
  }, []);

  if (!aiEnabled) return null;

  const current = models.find((m) => m.id === selected);
  const label = current?.displayName || selected;

  const pick = (id) => {
    setSelectedGeminiModel(id);
    setSelected(id);
    setOpen(false);
    toast.success(`AI model: ${id}`, { duration: 2500 });
    onModelChange?.(id);
  };

  const modelList = (
    <ul
      role="listbox"
      className={
        inMenu
          ? 'max-h-48 overflow-y-auto'
          : 'absolute right-0 z-50 mt-1 max-h-[min(70vh,420px)] w-[min(100vw-2rem,22rem)] overflow-y-auto rounded-lg border border-ink-200/80 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900'
      }
    >
      {inMenu ? (
        <li className="px-3 py-1.5 text-2xs text-ink-500 dark:text-ink-400">
          Separate free-tier limits per model.
        </li>
      ) : (
        <li className="border-b border-ink-100 px-3 py-2 text-2xs text-ink-500 dark:border-ink-800 dark:text-ink-400">
          Free tier has separate daily limits per model — switch if one is exhausted.
        </li>
      )}
      {models.length === 0 && !loading ? (
        <li className="px-3 py-2 text-xs text-ink-500">No models listed</li>
      ) : null}
      {models.map((m) => (
        <li key={m.id} role="option" aria-selected={m.id === selected}>
          <button
            type="button"
            className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition hover:bg-ink-50 dark:hover:bg-ink-800/80 ${
              m.id === selected
                ? 'bg-brand-50/80 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200'
                : 'text-ink-800 dark:text-ink-100'
            }`}
            onClick={() => pick(m.id)}
          >
            <span className="font-medium">{m.displayName || m.id}</span>
            <span className="font-mono text-2xs text-ink-400 dark:text-ink-500">{m.id}</span>
            {m.description ? (
              <span className="text-2xs text-ink-500 dark:text-ink-400">{m.description}</span>
            ) : null}
            {m.recommendedForFreeTier ? (
              <span className="pill-emerald mt-0.5">Free tier</span>
            ) : null}
          </button>
        </li>
      ))}
      <li className={inMenu ? 'px-3 py-2' : 'border-t border-ink-100 px-3 py-2 dark:border-ink-800'}>
        <button
          type="button"
          className="text-2xs text-brand-600 hover:underline dark:text-brand-300"
          onClick={() => loadModels()}
          disabled={loading}
        >
          Refresh list from Google
        </button>
      </li>
    </ul>
  );

  if (inMenu) {
    return (
      <div>
        <p className="mb-1 px-3 text-xs font-medium text-ink-700 dark:text-ink-200">
          {loading ? 'Loading models…' : label}
        </p>
        {modelList}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost btn-xs max-w-[11rem] truncate sm:max-w-[14rem]"
        onClick={() => setOpen((v) => !v)}
        title="Gemini model used for tailor, auto-tag, enrich, and JD match"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {loading ? 'Models…' : `Model: ${label}`}
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close model menu"
            onClick={() => setOpen(false)}
          />
          {modelList}
        </>
      ) : null}
    </div>
  );
}
