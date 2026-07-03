import type {
  KeywordHighlightColor,
  KeywordHighlightMatchMode,
  KeywordHighlightRule,
  KeywordHighlightStyle,
  LanguagePreference,
  OrderDisplayMode,
  PrintDensity,
  PrintFontSize,
  PrintLineSpacing,
  PrintPadding,
  RoundingLayoutPreset,
  UserPreferences,
  ThemePreference,
} from "../types";
import { ClinicalText } from "../components/ClinicalText";
import { SoapVisualPreview } from "../components/SoapVisualPreview";
import { useT } from "../i18n";
import {
  layoutPresetLabels,
  normalizeKeywordHighlightRules,
  normalizeRoundingLayoutPreferences,
  roundingLayoutSections,
  visibleSectionsForPreset,
} from "../userPreferences";

const appearancePresets = {
  morning: {
    label: "Morning rounds",
    detail: "Small, tight, dense print for carrying the full list.",
  },
  readable: {
    label: "Readable print",
    detail: "Balanced default for routine team rounds.",
  },
  presentation: {
    label: "Large review",
    detail: "Larger text and airier spacing for screen review.",
  },
} as const;

const printDensityLabels: Record<PrintDensity, string> = {
  normal: "Priority detail",
  compact: "Compact",
  "ultra-compact": "Ultra-compact",
};

const printDensityHelp: Record<PrintDensity, string> = {
  normal: "Keeps more labs, imaging, A/P, task, and DC detail.",
  compact: "Shorter lines while preserving high-yield signals.",
  "ultra-compact": "Tightest list for high census; review preview before printing.",
};

const fontSizeLabels: Record<PrintFontSize, string> = {
  small: "Small",
  default: "Default",
  large: "Large",
};

const lineSpacingLabels: Record<PrintLineSpacing, string> = {
  tight: "Tight",
  normal: "Normal",
  airy: "Airy",
};

const paddingLabels: Record<PrintPadding, string> = {
  dense: "Dense",
  balanced: "Balanced",
};

const apDisplayModeLabels: Record<"separate" | "merged", string> = {
  separate: "Separate problem blocks",
  merged: "Merged A/P",
};

const orderDisplayModeLabels: Record<OrderDisplayMode, string> = {
  summary: "High-yield summary",
  category: "By medication category",
  collapsed: "Collapse routine orders",
};

interface SettingsPageProps {
  preferences: UserPreferences;
  userName: string;
  onChange: (preferences: UserPreferences) => void;
  onRefreshAiStyleProfile: () => void;
  onSwitchUser: () => void;
}

const printSampleSoap = `7A-01 IM-A01 67/F
Dx: PNA w/ hypoxemia
S:
- Dyspnea improved, no fever.
O:
- V/S: T 37.0 C, BP 120/70, HR 96, SpO2 95% on NC 2 L.
- Lab: WBC 13.2, Hb 9.4, Cr 2.7, K 3.0.
- Image: CXR 5/25 LLL infiltrate c/w aspiration PNA.
A/P:
# Aspiration PNA / hypoxemia, improving
- On ceftriaxone; f/u sputum/B/C, wean O2 as tolerated.
# AKI / hypokalemia
- Trend Cr/K, avoid nephrotoxins, replace K.
Tasks:
- f/u B/C and sputum culture.
藥囑:
- Abx: ceftriaxone D3.
DC:
- Barrier: O2 requirement.`;

function keywordPreviewText(rule: KeywordHighlightRule) {
  const pattern = rule.pattern.trim();
  if (!pattern) return "Preview: type a keyword to see how it will mark this fake SOAP text.";
  return `Preview: f/u ${pattern}; Cr 2.7, K 5.7, culture pending, discharge barrier.`;
}

function SettingsPage({ preferences, userName, onChange, onRefreshAiStyleProfile, onSwitchUser }: SettingsPageProps) {
  const t = useT();
  const roundingLayout = normalizeRoundingLayoutPreferences(preferences.roundingLayout);
  const keywordRules = normalizeKeywordHighlightRules(preferences.keywordHighlightRules);
  const hiddenSectionCount = roundingLayoutSections.filter((section) => !roundingLayout.visibleSections[section.id]).length;

  const updateLayout = (patch: Partial<typeof roundingLayout>) => {
    onChange({ ...preferences, roundingLayout: normalizeRoundingLayoutPreferences({ ...roundingLayout, ...patch }) });
  };

  const updatePreset = (preset: RoundingLayoutPreset) => {
    updateLayout({ preset, visibleSections: visibleSectionsForPreset(preset) });
  };

  const updateSection = (sectionId: keyof typeof roundingLayout.visibleSections, checked: boolean) => {
    updateLayout({ visibleSections: { ...roundingLayout.visibleSections, [sectionId]: checked } });
  };

  const updateKeywordRules = (nextRules: KeywordHighlightRule[]) => {
    onChange({ ...preferences, keywordHighlightRules: normalizeKeywordHighlightRules(nextRules) });
  };

  const updateKeywordRule = (id: string, patch: Partial<KeywordHighlightRule>) => {
    updateKeywordRules(keywordRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const addKeywordRule = () => {
    updateKeywordRules([
      ...keywordRules,
      {
        id: `kw-${Date.now()}`,
        label: "Creatinine",
        pattern: "Cr",
        matchMode: "containsInsensitive",
        color: "yellow",
        style: "highlight",
        enabled: true,
        priority: keywordRules.length,
      },
    ]);
  };

  const removeKeywordRule = (id: string) => {
    updateKeywordRules(keywordRules.filter((rule) => rule.id !== id));
  };

  const applyAppearancePreset = (preset: "morning" | "readable" | "presentation") => {
    if (preset === "morning") {
      updateLayout({ printDensity: "compact", printFontSize: "small", printLineSpacing: "tight", printPadding: "dense" });
      return;
    }
    if (preset === "presentation") {
      updateLayout({ printDensity: "normal", printFontSize: "large", printLineSpacing: "airy", printPadding: "balanced" });
      return;
    }
    updateLayout({ printDensity: "normal", printFontSize: "default", printLineSpacing: "normal", printPadding: "balanced" });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>{t("settings.title")}</h2>
        </div>
      </header>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>{t("settings.account")}</h3>
            <p className="muted">{t("settings.switchUserHelp")}</p>
          </div>
          <button type="button" className="secondary" onClick={onSwitchUser}>
            {t("action.switchUser")}
          </button>
        </div>
        <div className="utility-row">
          <div>
            <strong>{t("settings.signedInAs")}</strong>
            <div>{userName || "-"}</div>
          </div>
        </div>
      </section>

      <section className="panel form-grid">
        <h3 className="span-2">{t("settings.preferences")}</h3>
        <label>
          {t("settings.theme")}
          <select value={preferences.theme} onChange={(event) => onChange({ ...preferences, theme: event.target.value as ThemePreference })}>
            <option value="light">{t("settings.light")}</option>
            <option value="dark">{t("settings.dark")}</option>
            <option value="system">{t("settings.system")}</option>
          </select>
        </label>
        <label>
          {t("settings.language")}
          <select value={preferences.language} onChange={(event) => onChange({ ...preferences, language: event.target.value as LanguagePreference })}>
            <option value="en">{t("settings.english")}</option>
            <option value="zh-TW">{t("settings.zh")}</option>
          </select>
        </label>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>Rounding layout</h3>
          </div>
        </div>

        <div className="settings-preset-row" aria-label="Print appearance presets">
          {(Object.keys(appearancePresets) as Array<keyof typeof appearancePresets>).map((preset) => (
            <button type="button" className="secondary settings-preset-card" onClick={() => applyAppearancePreset(preset)} key={preset}>
              <strong>{appearancePresets[preset].label}</strong>
              <span>{appearancePresets[preset].detail}</span>
            </button>
          ))}
        </div>

        <div className="form-grid settings-control-grid">
          <label>
            Layout preset
            <select value={roundingLayout.preset} onChange={(event) => updatePreset(event.target.value as RoundingLayoutPreset)}>
              {(Object.keys(layoutPresetLabels) as RoundingLayoutPreset[]).map((preset) => (
                <option value={preset} key={preset}>{layoutPresetLabels[preset]}</option>
              ))}
            </select>
          </label>
          <label>
            Print density
            <select value={roundingLayout.printDensity} onChange={(event) => updateLayout({ printDensity: event.target.value as PrintDensity })}>
              {(Object.keys(printDensityLabels) as PrintDensity[]).map((value) => (
                <option value={value} key={value}>{printDensityLabels[value]}</option>
              ))}
            </select>
            <span className="field-help">{printDensityHelp[roundingLayout.printDensity]}</span>
          </label>
          <label>
            Font size
            <select value={roundingLayout.printFontSize} onChange={(event) => updateLayout({ printFontSize: event.target.value as PrintFontSize })}>
              {(Object.keys(fontSizeLabels) as PrintFontSize[]).map((value) => (
                <option value={value} key={value}>{fontSizeLabels[value]}</option>
              ))}
            </select>
          </label>
          <label>
            Line spacing
            <select value={roundingLayout.printLineSpacing} onChange={(event) => updateLayout({ printLineSpacing: event.target.value as PrintLineSpacing })}>
              {(Object.keys(lineSpacingLabels) as PrintLineSpacing[]).map((value) => (
                <option value={value} key={value}>{lineSpacingLabels[value]}</option>
              ))}
            </select>
          </label>
          <label>
            Section padding
            <select value={roundingLayout.printPadding} onChange={(event) => updateLayout({ printPadding: event.target.value as PrintPadding })}>
              {(Object.keys(paddingLabels) as PrintPadding[]).map((value) => (
                <option value={value} key={value}>{paddingLabels[value]}</option>
              ))}
            </select>
          </label>
          <label>
            Board density
            <select value={roundingLayout.boardDensity} onChange={(event) => updateLayout({ boardDensity: event.target.value as PrintDensity })}>
              {(Object.keys(printDensityLabels) as PrintDensity[]).map((value) => (
                <option value={value} key={value}>{printDensityLabels[value]}</option>
              ))}
            </select>
          </label>
          <label>
            A/P display
            <select value={roundingLayout.apDisplayMode} onChange={(event) => updateLayout({ apDisplayMode: event.target.value as typeof roundingLayout.apDisplayMode })}>
              {(Object.keys(apDisplayModeLabels) as Array<typeof roundingLayout.apDisplayMode>).map((value) => (
                <option value={value} key={value}>{apDisplayModeLabels[value]}</option>
              ))}
            </select>
          </label>
          <label>
            Order display
            <select value={roundingLayout.orderDisplayMode} onChange={(event) => updateLayout({ orderDisplayMode: event.target.value as OrderDisplayMode })}>
              {(Object.keys(orderDisplayModeLabels) as OrderDisplayMode[]).map((value) => (
                <option value={value} key={value}>{orderDisplayModeLabels[value]}</option>
              ))}
            </select>
          </label>
          <div className="settings-subsection-heading span-2">
            <strong>Section visibility</strong>
            <span className="muted">{hiddenSectionCount === 0 ? "All sections visible" : `${hiddenSectionCount} section${hiddenSectionCount === 1 ? "" : "s"} hidden in Board/SOAP preview.`}</span>
          </div>
          <div className="layout-section-grid span-2">
            {roundingLayoutSections.map((section) => (
              <label className="checkbox-label layout-section-option" key={section.id}>
                <input type="checkbox" checked={roundingLayout.visibleSections[section.id]} onChange={(event) => updateSection(section.id, event.target.checked)} />
                {section.label}
              </label>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>Keyword highlights</h3>
          </div>
          <button type="button" className="secondary" onClick={addKeywordRule}>Add rule</button>
        </div>

        {keywordRules.length === 0 ? (
          <p className="muted">No keyword rule yet.</p>
        ) : (
          <div className="keyword-rule-list">
            {keywordRules.map((rule) => (
              <article className="keyword-rule-row" key={rule.id}>
                <label className="checkbox-label keyword-rule-enabled">
                  <input type="checkbox" checked={rule.enabled} onChange={(event) => updateKeywordRule(rule.id, { enabled: event.target.checked })} />
                  On
                </label>
                <label>
                  Label
                  <input value={rule.label} onChange={(event) => updateKeywordRule(rule.id, { label: event.target.value })} />
                </label>
                <label>
                  Keyword
                  <input value={rule.pattern} onChange={(event) => updateKeywordRule(rule.id, { pattern: event.target.value })} placeholder="e.g. Teicoplanin" />
                </label>
                <label>
                  Match
                  <select value={rule.matchMode} onChange={(event) => updateKeywordRule(rule.id, { matchMode: event.target.value as KeywordHighlightMatchMode })}>
                    <option value="containsInsensitive">Contains, ignore case</option>
                    <option value="contains">Contains, match case</option>
                    <option value="exact">Exact word, match case</option>
                  </select>
                </label>
                <label>
                  Color
                  <select value={rule.color} onChange={(event) => updateKeywordRule(rule.id, { color: event.target.value as KeywordHighlightColor })}>
                    <option value="red">Red</option>
                    <option value="orange">Orange</option>
                    <option value="yellow">Yellow</option>
                    <option value="blue">Blue</option>
                    <option value="green">Green</option>
                    <option value="purple">Purple</option>
                  </select>
                </label>
                <label>
                  Style
                  <select value={rule.style} onChange={(event) => updateKeywordRule(rule.id, { style: event.target.value as KeywordHighlightStyle })}>
                    <option value="highlight">Highlight</option>
                    <option value="text">Text color</option>
                  </select>
                </label>
                <label>
                  Priority
                  <input type="number" value={rule.priority} onChange={(event) => updateKeywordRule(rule.id, { priority: Number(event.target.value) || 0 })} />
                </label>
                <button type="button" className="secondary" onClick={() => removeKeywordRule(rule.id)}>Remove</button>
                <div className="keyword-rule-preview">
                  <span className="muted">Live preview</span>
                  <ClinicalText value={keywordPreviewText(rule)} keywordRules={[rule]} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>Preview sample</h3>
          </div>
        </div>
        <div className={`settings-print-preview print-page density-${roundingLayout.printDensity} print-font-${roundingLayout.printFontSize} print-line-${roundingLayout.printLineSpacing} print-padding-${roundingLayout.printPadding}`}>
          <ClinicalText value={printSampleSoap} keywordRules={keywordRules} labReferenceDisplay="detail" />
        </div>
        <SoapVisualPreview value={printSampleSoap} layoutPreferences={roundingLayout} keywordRules={keywordRules} compact />
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>AI style profile</h3>
          </div>
          <button type="button" className="secondary" onClick={onRefreshAiStyleProfile}>
            Refresh style
          </button>
        </div>
        {preferences.aiStyleProfile ? (
          <div className="utility-row ai-style-profile-summary">
            <span>A/P voice: {preferences.aiStyleProfile.apVoice}</span>
            <span>Structure: {preferences.aiStyleProfile.apOrganization}</span>
            <span>Shorthand: {preferences.aiStyleProfile.abbreviationStyle}</span>
            <span>Tasks: {preferences.aiStyleProfile.taskStyle}</span>
            <span>Terms: {preferences.aiStyleProfile.preferredTerms.join(", ") || "-"}</span>
            <span className="muted">Density hint only: ~{preferences.aiStyleProfile.typicalApProblemCount} problems / {preferences.aiStyleProfile.typicalApLineLimit} line</span>
          </div>
        ) : (
          <p className="muted">No style profile yet — save reviewed SOAPs first.</p>
        )}
      </section>
    </div>
  );
}

export default SettingsPage;
