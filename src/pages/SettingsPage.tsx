import type { LanguagePreference, PrintDensity, RoundingLayoutPreset, UserPreferences, ThemePreference } from "../types";
import { useT } from "../i18n";
import {
  layoutPresetLabels,
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

function SettingsPage({ preferences, userName, onChange, onRefreshAiStyleProfile, onSwitchUser }: SettingsPageProps) {
  const t = useT();
  const roundingLayout = normalizeRoundingLayoutPreferences(preferences.roundingLayout);
  const updateLayout = (patch: Partial<typeof roundingLayout>) => {
    onChange({ ...preferences, roundingLayout: normalizeRoundingLayoutPreferences({ ...roundingLayout, ...patch }) });
  };
  const updatePreset = (preset: RoundingLayoutPreset) => {
    updateLayout({ preset, visibleSections: visibleSectionsForPreset(preset) });
  };
  const updateSection = (sectionId: keyof typeof roundingLayout.visibleSections, checked: boolean) => {
    updateLayout({ visibleSections: { ...roundingLayout.visibleSections, [sectionId]: checked } });
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
          <select
            value={preferences.theme}
            onChange={(event) => onChange({ ...preferences, theme: event.target.value as ThemePreference })}
          >
            <option value="light">{t("settings.light")}</option>
            <option value="dark">{t("settings.dark")}</option>
            <option value="system">{t("settings.system")}</option>
          </select>
        </label>
        <label>
          {t("settings.language")}
          <select
            value={preferences.language}
            onChange={(event) => onChange({ ...preferences, language: event.target.value as LanguagePreference })}
          >
            <option value="en">{t("settings.english")}</option>
            <option value="zh-TW">{t("settings.zh")}</option>
          </select>
        </label>
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h3>Rounding layout</h3>
            <p className="muted">Default display for Board, SOAP preview, and Print. This is user preference only, not patient data.</p>
          </div>
        </div>
        <div className="form-grid">
          <label>
            Preset
            <select value={roundingLayout.preset} onChange={(event) => updatePreset(event.target.value as RoundingLayoutPreset)}>
              {(Object.keys(layoutPresetLabels) as RoundingLayoutPreset[]).map((preset) => (
                <option value={preset} key={preset}>{layoutPresetLabels[preset]}</option>
              ))}
            </select>
          </label>
          <label>
            Print density
            <select value={roundingLayout.printDensity} onChange={(event) => updateLayout({ printDensity: event.target.value as PrintDensity })}>
              <option value="normal">Detailed</option>
              <option value="compact">Compact</option>
              <option value="ultra-compact">Ultra compact</option>
            </select>
          </label>
          <label>
            Board density
            <select value={roundingLayout.boardDensity} onChange={(event) => updateLayout({ boardDensity: event.target.value as PrintDensity })}>
              <option value="normal">Detailed</option>
              <option value="compact">Compact</option>
              <option value="ultra-compact">Ultra compact</option>
            </select>
          </label>
          <div className="layout-section-grid span-2">
            {roundingLayoutSections.map((section) => (
              <label className="checkbox-label layout-section-option" key={section.id}>
                <input
                  type="checkbox"
                  checked={roundingLayout.visibleSections[section.id]}
                  onChange={(event) => updateSection(section.id, event.target.checked)}
                />
                {section.label}
              </label>
            ))}
          </div>
        </div>
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
            <span>A/P: ~{preferences.aiStyleProfile.apProblemCount} problems</span>
            <span>{preferences.aiStyleProfile.apLineLimit} line/problem</span>
            <span>Tasks: {preferences.aiStyleProfile.taskStyle}</span>
            <span>Terms: {preferences.aiStyleProfile.preferredTerms.join(", ") || "-"}</span>
          </div>
        ) : (
          <p className="muted">No style profile yet. Save a few reviewed SOAP notes, then refresh.</p>
        )}
      </section>
    </div>
  );
}

export default SettingsPage;
