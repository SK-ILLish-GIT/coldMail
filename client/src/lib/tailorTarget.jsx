import { createContext, useCallback, useContext, useState } from "react";

/**
 * Cross-tab deep-link target for the Tailor flow.
 *
 * Replaces the three-doors-into-the-same-modal pattern (TemplateLibrary's
 * `AI Tailor` row button + JDMatcher's `Tailor template` + Tailor tab) with
 * one canonical destination: the Tailor tab. Other surfaces request tailoring
 * by calling `requestTailorTemplate(template)`, which stages the template
 * and asks `App` to switch to the Tailor tab. The Tailor tab consumes the
 * pending request on mount.
 */
const TailorTargetContext = createContext({
  pendingTemplate: null,
  requestTailorTemplate: () => {},
  consumePendingTemplate: () => null,
  pendingResumeTailor: false,
  requestTailorResume: () => {},
  consumePendingResumeTailor: () => {},
});

export function TailorTargetProvider({ onRequestTab, children }) {
  const [pendingTemplate, setPendingTemplate] = useState(null);
  const [pendingResumeTailor, setPendingResumeTailor] = useState(false);

  const requestTailorTemplate = useCallback(
    (template) => {
      if (!template) return;
      setPendingTemplate(template);
      setPendingResumeTailor(false);
      onRequestTab?.("tailor");
    },
    [onRequestTab],
  );

  const requestTailorResume = useCallback(() => {
    setPendingTemplate(null);
    setPendingResumeTailor(true);
    onRequestTab?.("tailor");
  }, [onRequestTab]);

  const consumePendingTemplate = useCallback(() => {
    const t = pendingTemplate;
    setPendingTemplate(null);
    return t;
  }, [pendingTemplate]);

  const consumePendingResumeTailor = useCallback(() => {
    setPendingResumeTailor(false);
  }, []);

  return (
    <TailorTargetContext.Provider
      value={{
        pendingTemplate,
        requestTailorTemplate,
        consumePendingTemplate,
        pendingResumeTailor,
        requestTailorResume,
        consumePendingResumeTailor,
      }}
    >
      {children}
    </TailorTargetContext.Provider>
  );
}

export function useTailorTarget() {
  return useContext(TailorTargetContext);
}
