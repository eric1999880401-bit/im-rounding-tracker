import type { LanguagePreference, ThemePreference, UserPreferences } from "../types";
import { useT } from "../i18n";

interface SettingsPageProps {
  preferences: UserPreferences;
  userName: string;
  onChange: (preferences: UserPreferences) => void;
  onSwitchUser: () => void;
}

function SettingsPage({ preferences, userName, onChange, onSwitchUser }: SettingsPageProps) {
  const t = useT();
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
    </div>
  );
}

export default SettingsPage;
