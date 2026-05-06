import type { LanguagePreference, ThemePreference, UserPreferences } from "../types";
import { useT } from "../i18n";

interface SettingsPageProps {
  preferences: UserPreferences;
  onChange: (preferences: UserPreferences) => void;
}

function SettingsPage({ preferences, onChange }: SettingsPageProps) {
  const t = useT();
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>{t("settings.title")}</h2>
        </div>
      </header>
      <section className="panel form-grid">
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
    </div>
  );
}

export default SettingsPage;
