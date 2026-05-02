import { useState, type FormEvent } from "react";
import { createAccountWithEmail, signInWithEmail } from "../firebase/auth";

function AuthPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else {
        await createAccountWithEmail(email, password);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed.");
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

        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

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

        {errorMessage && <p className="error-message">{errorMessage}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </form>
    </main>
  );
}

export default AuthPage;
