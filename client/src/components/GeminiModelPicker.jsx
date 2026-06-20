import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { api } from "../lib/api.js";
import {
  AI_MODEL_CHANGE_EVENT,
  getSelectedAiModel,
  getSelectedAiProvider,
  setSelectedAiModel,
  setSelectedAiProvider,
} from "../lib/aiModel.js";

const PROVIDERS = [
  { id: "gemini", label: "Gemini", keyHint: "GEMINI_API_KEY" },
  { id: "groq", label: "Groq", keyHint: "GROQ_API_KEY" },
];

export default function GeminiModelPicker({
  aiEnabled,
  variant = "button",
  onModelChange,
}) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(getSelectedAiProvider);
  const [selected, setSelected] = useState(getSelectedAiModel);
  const [configuredProviders, setConfiguredProviders] = useState({
    gemini: false,
    groq: false,
  });
  const inMenu = variant === "menu";

  const loadProviders = useCallback(async () => {
    if (!aiEnabled) return;
    try {
      const data = await api.listAiProviders();
      const map = { gemini: false, groq: false };
      for (const p of data.providers || []) {
        if (p.id === "gemini" || p.id === "groq") map[p.id] = Boolean(p.configured);
      }
      setConfiguredProviders(map);
    } catch {
      /* health may still report providers */
    }
  }, [aiEnabled]);

  const loadModels = useCallback(
    async (providerId = getSelectedAiProvider()) => {
      if (!aiEnabled) return;
      setLoading(true);
      try {
        const data = await api.listAiModels(providerId);
        setModels(data.models || []);
        if (data.providers) {
          setConfiguredProviders((prev) => ({ ...prev, ...data.providers }));
        }
        const stored = getSelectedAiModel();
        const ids = new Set((data.models || []).map((m) => m.id));
        if (ids.size && !ids.has(stored) && data.defaultModel) {
          setSelectedAiModel(data.defaultModel);
          setSelected(data.defaultModel);
        }
        if (data.activeProvider) {
          setProvider(data.activeProvider);
        } else {
          setProvider(providerId);
        }
      } catch (err) {
        toast.error(err.message || "Could not load AI models");
      } finally {
        setLoading(false);
      }
    },
    [aiEnabled],
  );

  useEffect(() => {
    loadProviders();
    loadModels();
  }, [loadProviders, loadModels]);

  useEffect(() => {
    const onChange = (e) => {
      const detail = e.detail || {};
      setProvider(detail.provider || getSelectedAiProvider());
      setSelected(detail.model || getSelectedAiModel());
    };
    window.addEventListener(AI_MODEL_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(AI_MODEL_CHANGE_EVENT, onChange);
  }, []);

  if (!aiEnabled) return null;

  const current = models.find((m) => m.id === selected);
  const label = current?.displayName || selected;
  const providerMeta = PROVIDERS.find((p) => p.id === provider);
  const providerLabel = providerMeta?.label || provider;
  const providerConfigured = configuredProviders[provider];

  const pickProvider = async (id) => {
    if (!configuredProviders[id]) {
      const hint = PROVIDERS.find((p) => p.id === id)?.keyHint || "API key";
      toast.error(`Set ${hint} in server/.env and restart the server.`, {
        duration: 5000,
      });
    }
    setSelectedAiProvider(id);
    setProvider(id);
    setModels([]);
    await loadModels(id);
    if (configuredProviders[id]) {
      toast.success(`AI provider: ${id}`, { duration: 2500 });
      onModelChange?.(getSelectedAiModel());
    }
  };

  const pick = (id) => {
    if (!providerConfigured) {
      toast.error(
        `Set ${providerMeta?.keyHint || "API key"} in server/.env to use ${providerLabel}.`,
        { duration: 5000 },
      );
      return;
    }
    setSelectedAiModel(id);
    setSelected(id);
    setOpen(false);
    toast.success(`AI model: ${id}`, { duration: 2500 });
    onModelChange?.(id);
  };

  const providerPicker = (
    <div className={inMenu ? "px-3 pb-2" : "border-b border-ink-100 px-3 py-2"}>
      <p className="mb-1 text-2xs font-medium text-ui-fg-muted">Provider</p>
      <div className="flex gap-1">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={
              configuredProviders[p.id]
                ? `Use ${p.label}`
                : `Set ${p.keyHint} in server/.env`
            }
            className={`rounded-md px-2 py-1 text-2xs font-medium transition ${
              p.id === provider
                ? "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
                : configuredProviders[p.id]
                  ? "bg-ui-inset text-ui-fg-subtle hover:bg-ink-50 dark:hover:bg-ink-800/80"
                  : "bg-ui-inset text-ui-fg-muted opacity-70 hover:opacity-100"
            }`}
            onClick={() => pickProvider(p.id)}
          >
            {p.label}
            {!configuredProviders[p.id] ? " · setup" : ""}
          </button>
        ))}
      </div>
    </div>
  );

  const modelList = (
    <ul
      role="listbox"
      className={
        inMenu
          ? "max-h-48 overflow-y-auto"
          : "absolute right-0 z-50 mt-1 max-h-[min(70vh,420px)] w-[min(100vw-2rem,22rem)] overflow-y-auto rounded-lg border border-ui-border/80 bg-ui-panel py-1 shadow-lg"
      }
    >
      {providerPicker}
      {!providerConfigured ? (
        <li className="px-3 py-2 text-2xs text-amber-700 dark:text-amber-300">
          Set {providerMeta?.keyHint} in server/.env, restart the server, then
          pick a model below.
        </li>
      ) : null}
      {inMenu ? (
        <li className="px-3 py-1.5 text-2xs text-ui-fg-muted">
          Separate limits per model — switch if one is exhausted.
        </li>
      ) : (
        <li className="border-b border-ink-100 px-3 py-2 text-2xs text-ui-fg-muted">
          Free tiers have separate limits per model — switch provider or model
          if one is exhausted.
        </li>
      )}
      {models.length === 0 && !loading ? (
        <li className="px-3 py-2 text-xs text-ui-fg-muted">No models listed</li>
      ) : null}
      {models.map((m) => (
        <li key={m.id} role="option" aria-selected={m.id === selected}>
          <button
            type="button"
            className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-xs transition hover:bg-ink-50 dark:hover:bg-ink-800/80 ${
              m.id === selected
                ? "bg-brand-50/80 text-brand-800 dark:bg-brand-900/30 dark:text-brand-200"
                : "text-ui-fg"
            } ${!providerConfigured ? "opacity-80" : ""}`}
            onClick={() => pick(m.id)}
          >
            <span className="font-medium">{m.displayName || m.id}</span>
            <span className="font-mono text-2xs text-ui-fg-muted">{m.id}</span>
            {m.description ? (
              <span className="text-2xs text-ui-fg-muted">{m.description}</span>
            ) : null}
            {m.recommendedForFreeTier ? (
              <span className="pill-emerald mt-0.5">Free tier</span>
            ) : null}
          </button>
        </li>
      ))}
      <li
        className={inMenu ? "px-3 py-2" : "border-t border-ink-100 px-3 py-2"}
      >
        <button
          type="button"
          className="text-2xs text-brand-600 hover:underline dark:text-brand-300"
          onClick={() => loadModels(provider)}
          disabled={loading}
        >
          Refresh model list
        </button>
      </li>
    </ul>
  );

  if (inMenu) {
    return (
      <div>
        <p className="mb-1 px-3 text-xs font-medium text-ui-fg">
          {loading ? "Loading models…" : `${providerLabel}: ${label}`}
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
        title="AI provider and model used for tailor, auto-tag, enrich, and JD match"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {loading ? "Models…" : `${providerLabel}: ${label}`}
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
