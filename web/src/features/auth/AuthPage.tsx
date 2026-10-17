import { CircleDot } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authClient } from "../../lib/auth-client";
import { Button, Field, Input } from "../../components/ui";

const USERNAME = /^[a-z0-9_]{3,24}$/;

/** Username + password sign-in. Sign-up also asks for an email, used only for reminders. */
export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get("next") || "/";
  const signup = mode === "signup";
  const nextQuery = next !== "/" ? `?next=${encodeURIComponent(next)}` : "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const name = username.trim().toLowerCase();
    if (signup && !USERNAME.test(name)) return setError("Username: 3–24 characters, lowercase letters, numbers or _");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setBusy(true);
    try {
      if (signup) {
        const r = await authClient.signUp.email({ username: name, email: email.trim(), password, name });
        if (r.error) throw new Error(r.error.message ?? "Could not create account");
      } else {
        const r = await authClient.signIn.username({ username: name, password });
        if (r.error) throw new Error(r.error.status === 401 ? "Incorrect username or password" : (r.error.message ?? "Sign-in failed"));
      }
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <CircleDot className="size-6 text-accent" aria-hidden />
          <span className="text-lg font-semibold tracking-tight">Cadence</span>
        </div>
        <h1 className="text-xl font-semibold">{signup ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">{signup ? "Plan your learning, and study with your friends." : "Sign in to see today's plan."}</p>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Username">
            {(id) => (
              <Input id={id} required value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} />
            )}
          </Field>
          {signup && (
            <Field label="Email" hint="Only used to remind you about pending tasks.">
              {(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
            </Field>
          )}
          <Field label="Password" hint={signup ? "At least 8 characters" : undefined}>
            {(id) => (
              <Input
                id={id}
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? "new-password" : "current-password"}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {signup ? "Create account" : "Sign in"}
          </Button>
        </form>
        <p className="mt-6 text-sm text-muted">
          {signup ? (
            <>
              Already have an account? <Link className="text-accent" to={`/login${nextQuery}`}>Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link className="text-accent" to={`/signup${nextQuery}`}>Create an account</Link>
            </>
          )}
        </p>
      </div>
    </main>
  );
}
