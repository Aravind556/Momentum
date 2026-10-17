import { CircleDot } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import { Button, Field, Input } from "../components/ui";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <CircleDot className="size-6 text-accent" aria-hidden />
          <span className="text-lg font-semibold tracking-tight">Cadence</span>
        </div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

export function AuthPage({ mode }: { mode: "login" | "signup" | "forgot" }) {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get("next") || "/";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const r = await authClient.signUp.email({ email, password, name: name || email.split("@")[0]! });
        if (r.error) throw new Error(r.error.message ?? "Could not create account");
        window.location.href = next.startsWith("/join") ? next : "/onboarding";
      } else if (mode === "login") {
        const r = await authClient.signIn.email({ email, password });
        if (r.error) throw new Error(r.error.status === 401 ? "Incorrect email or password" : (r.error.message ?? "Sign-in failed"));
        window.location.href = next;
      } else {
        const r = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
        if (r.error) throw new Error(r.error.message ?? "Could not send reset link");
        setInfo("If an account exists for that email, a reset link has been sent. (In local development the link is printed in the server log.)");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const copy = {
    login: { title: "Welcome back", subtitle: "Sign in to plan your day.", cta: "Sign in" },
    signup: { title: "Create your account", subtitle: "Plan, focus, and stay accountable with friends.", cta: "Create account" },
    forgot: { title: "Reset your password", subtitle: "We'll send you a link to choose a new one.", cta: "Send reset link" },
  }[mode];

  return (
    <Shell title={copy.title} subtitle={copy.subtitle}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {mode === "signup" && (
          <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />}</Field>
        )}
        <Field label="Email">
          {(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
        </Field>
        {mode !== "forgot" && (
          <Field label="Password" hint={mode === "signup" ? "At least 8 characters" : undefined}>
            {(id) => (
              <Input
                id={id}
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            )}
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {info && (
          <p role="status" className="text-sm text-ok">
            {info}
          </p>
        )}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {copy.cta}
        </Button>
      </form>
      <div className="mt-6 space-y-2 text-sm text-muted">
        {mode === "login" && (
          <>
            <p>
              New here? <Link className="text-accent" to={`/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
            </p>
            <p>
              <Link className="text-accent" to="/forgot">Forgot your password?</Link>
            </p>
          </>
        )}
        {mode !== "login" && (
          <p>
            Already have an account? <Link className="text-accent" to={`/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
          </p>
        )}
      </div>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") ? "This reset link is invalid or has expired." : null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    const r = await authClient.resetPassword({ newPassword: password, token });
    setBusy(false);
    if (r.error) setError(r.error.message ?? "Could not reset password");
    else setDone(true);
  };

  return (
    <Shell title="Choose a new password" subtitle="Your other sessions stay signed in until they expire.">
      {done ? (
        <p className="text-sm text-ok">
          Password updated. <Link className="text-accent" to="/login">Sign in</Link>
        </p>
      ) : !token ? (
        <p className="text-sm text-danger">{error ?? "Missing reset token."}</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" hint="At least 8 characters">
            {(id) => <Input id={id} type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
          </Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Update password
          </Button>
        </form>
      )}
    </Shell>
  );
}
