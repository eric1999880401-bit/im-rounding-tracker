import { useState, type FormEvent } from "react";
import { createAccountWithEmail, requestPasswordReset, signInWithEmail } from "../firebase/auth";

function formatAuthError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

  if (code === "auth/network-request-failed") {
    return "Firebase Auth 連線失敗。請確認目前網址是 http://localhost:5173/，並檢查網路或防火牆；Codex in-app browser 有時會擋住外部 Firebase 請求。";
  }

  if (code === "auth/unauthorized-domain") {
    return "Firebase Auth 拒絕此網域。請在 Firebase Console 的 Authorized domains 加入 localhost。";
  }

  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Email 或 password 不正確。";
  }

  return error instanceof Error ? error.message : "Authentication failed.";
}

function AuthPage() {
  const [email, setEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [errorMessage, setErrorMessage] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setStatusMessage("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else if (mode === "reset") {
        await requestPasswordReset(email);
        setStatusMessage("Password reset email sent. Please check your inbox.");
      } else {
        await createAccountWithEmail(email, password, userName);
      }
    } catch (error) {
      setErrorMessage(formatAuthError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="panel auth-card" onSubmit={handleSubmit}>
        <h1>IM Rounding Tracker</h1>
        <p className="privacy-warning">Use de-identified data only.</p>
        <p className="muted">Login is required before any patient data is shown.</p>

        {mode === "signup" && (
          <label>
            Username
            <input
              type="text"
              autoComplete="username"
              value={userName}
              onChange={(event) => setUserName(event.target.value)}
              required
            />
          </label>
        )}

        <label>
          Email
          <input
            type="text"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            pattern="^[^\s@]+@[^\s@]+\.[^\s@]+$"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        {mode !== "reset" && (
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
            />
          </label>
        )}

        {errorMessage && <p className="error-message">{errorMessage}</p>}
        {statusMessage && <p className="status-message">{statusMessage}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Please wait..." : mode === "login" ? "Log in" : mode === "reset" ? "Send reset email" : "Create account"}
        </button>

        {mode === "login" && (
          <button type="button" className="text-button" onClick={() => setMode("reset")}>
            Forgot password?
          </button>
        )}

        <button
          type="button"
          className="secondary"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "Need an account? Sign up" : "Back to log in"}
        </button>
      </form>
    </main>
  );
}

export default AuthPage;
