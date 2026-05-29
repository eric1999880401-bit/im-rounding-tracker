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
Orders:
- Abx: ceftriaxone D3.
DC:
- Barrier: O2 requirement.`;

function SettingsPage({ preferences, userName, onChange, onRefreshAiStyleProfile, onSwitchUser }: SettingsPageProps) {
  const t = useT();
  const roundingLayout = normalizeRoundingLayoutPreferences(preferences.roundingLayout);
  const keywordRules = normalizeKeywordHighlightRules(preferences.keywordHighlightRules);

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
        label: "New highlight",
        pattern: "",
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
            <p className="muted">Board, SOAP preview, and Print use these display preferences. This does not change patient data.</p>
          </div>
        </div>

        <div className="settings-preset-row">
          <button type="button" className="secondary" onClick={() => applyAppearancePreset("morning")}>Morning round dense</button>
          <button type="button" className="secondary" onClick={() => applyAppearancePreset("readable")}>Readable print</button>
          <button type="button" className="secondary" onClick={() => applyAppearancePreset("presentation")}>Presentation clean</button>
        </div>

        <div className="form-grid">
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
              <option value="normal">重點完整</option>
              <option value="compact">Compact</option>
              <option value="ultra-compact">Ultra-compact</option>
            </select>
          </label>
          <label>
            Font size
            <select value={roundingLayout.printFontSize} onChange={(event) => updateLayout({ printFontSize: event.target.value as PrintFontSize })}>
              <option value="small">Small</option>
              <option value="default">Default</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label>
            Line spacing
            <select value={roundingLayout.printLineSpacing} onChange={(event) => updateLayout({ printLineSpacing: event.target.value as PrintLineSpacing })}>
              <option value="tight">Tight</option>
              <option value="normal">Normal</option>
              <option value="airy">Airy</option>
            </select>
          </label>
          <label>
            Section padding
            <select value={roundingLayout.printPadding} onChange={(event) => updateLayout({ printPadding: event.target.value as PrintPadding })}>
              <option value="dense">Dense</option>
              <option value="balanced">Balanced</option>
            </select>
          </label>
          <label>
            Board density
            <select value={roundingLayout.boardDensity} onChange={(event) => updateLayout({ boardDensity: event.target.value as PrintDensity })}>
              <option value="normal">重點完整</option>
              <option value="compact">Compact</option>
              <option value="ultra-compact">Ultra-compact</option>
            </select>
          </label>
          <label>
            A/P 顯示
            <select value={roundingLayout.apDisplayMode} onChange={(event) => updateLayout({ apDisplayMode: event.target.value as typeof roundingLayout.apDisplayMode })}>
              <option value="separate">分開 problem blocks</option>
              <option value="merged">合併一行 A/P</option>
            </select>
          </label>
          <label>
            藥囑顯示
            <select value={roundingLayout.orderDisplayMode} onChange={(event) => updateLayout({ orderDisplayMode: event.target.value as OrderDisplayMode })}>
              <option value="summary">重點摘要</option>
              <option value="category">分類摘要</option>
              <option value="collapsed">完整收起</option>
            </select>
          </label>
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
            <p className="muted">Personal highlight rules for Board, SOAP preview, and Print. These never edit SOAP text.</p>
          </div>
          <button type="button" className="secondary" onClick={addKeywordRule}>Add rule</button>
        </div>

        {keywordRules.length === 0 ? (
          <p className="muted">No keyword rule yet. Try Teicoplanin, Cr, INR, culture, or discharge.</p>
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
                    <option value="containsInsensitive">contains, ignore case</option>
                    <option value="contains">contains</option>
                    <option value="exact">exact word</option>
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
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>Preview sample</h3>
            <p className="muted">Fake SOAP preview for layout, keyword highlights, and lab reference display.</p>
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
            <p className="muted">Abstracts your reviewed SOAP style. It does not store old SOAP text or raw pasted notes.</p>
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
          <p className="muted">No style profile yet. Save a few reviewed SOAP notes, then refresh.</p>
        )}
      </section>
    </div>
  );
}

export default SettingsPage;
