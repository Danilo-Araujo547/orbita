import { useState } from "react";
import type { FormEvent } from "react";
import { request, signIn } from "../api";
import type { Session } from "../types";
import { ThemeToggle } from "./ThemeToggle";
import LoginScene from "./LoginScene";
import "../login.css";

export default function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState("admin"),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [show, setShow] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(username, password);
      onLogin(await request<Session>("/api/v1/auth/session/"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="lg">
      <LoginScene />
      <div className="lg-theme">
        <ThemeToggle />
      </div>
      <header className="lg-brand">
        <div className="orbita-logo" role="img" aria-label="Órbita">
          <span className="orbita-logo__symbol" aria-hidden="true" />
          <span aria-hidden="true">
            órbita<span className="orbita-logo__dot">.</span>
          </span>
        </div>
      </header>
      <section className="lg-panel">
        <form className="lg-form" onSubmit={submit}>
          <h1>Entrar</h1>
          <div className="lg-field">
            <label className="lg-label" htmlFor="lg-user">Usuário</label>
            <div className="lg-box">
              <input
                id="lg-user"
                className="lg-input"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="lg-field">
            <label className="lg-label" htmlFor="lg-pass">Senha</label>
            <div className="lg-box">
              <input
                id="lg-pass"
                className="lg-input"
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                className="lg-eye"
                type="button"
                onClick={() => setShow((s) => !s)}
              >
                {show ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </div>
          {error && (
            <div className="inline-error" role="alert">
              {error}
            </div>
          )}
          <button className="lg-go" type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </section>
      <footer className="lg-meta">AME Votuporanga · Painel operacional</footer>
    </main>
  );
}
