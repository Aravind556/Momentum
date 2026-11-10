import { BarChart3, BellRing, CalendarCheck, CircleDot, Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { authClient } from "../../lib/auth-client";
import { Button, Field, Input } from "../../components/ui";

const USERNAME = /^[a-z0-9_]{3,24}$/;

const FEATURES = [
  { icon: CalendarCheck, title: "Your day, planned for you", text: "Tasks, roadmaps and revisions placed into your free time." },
  { icon: BellRing, title: "Reminders that know what's left", text: "Nudges only for what isn't done yet — never for finished work." },
  { icon: BarChart3, title: "Progress you can see", text: "Everything you finish, streaks and focus time in one chart." },
];

/** Username + password sign-in. Sign-up also asks for an email, used only for reminders. */
export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

  const switchLink = signup ? (
    <>
      Already have an account?{" "}
      <Link className="font-medium text-accent" to={`/login${nextQuery}`}>
        Sign in
      </Link>
    </>
  ) : (
    <>
      New here?{" "}
      <Link className="font-medium text-accent" to={`/signup${nextQuery}`}>
        Create an account
      </Link>
    </>
  );

  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      {/* Desktop: a brand panel beside the form. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-accent p-12 text-accent-ink lg:flex xl:p-16">
        <div className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full border-[48px] border-current opacity-10" aria-hidden />
        <div className="flex items-center gap-2">
          <CircleDot className="size-6" aria-hidden />
          <span className="text-lg font-semibold tracking-tight">Momentum</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-4xl leading-tight font-semibold tracking-tight xl:text-5xl">Make every day count.</p>
          <ul className="mt-10 space-y-6">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <f.icon className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  <span className="block font-semibold">{f.title}</span>
                  <span className="block text-sm opacity-80">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm opacity-70">Plan it · Get reminded · See your progress</p>
      </aside>

      <div className="flex flex-col items-center px-5 pt-[max(1.75rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:justify-center sm:py-12 short:pt-4">
        <div className="w-full max-w-sm sm:rounded-2xl sm:border sm:border-line sm:bg-surface sm:p-8 sm:shadow-xl lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none short:sm:p-5">
          {/* Phones and tablets: the brand sits above the form (the panel covers it on desktop). */}
          <div className="mb-6 sm:mb-8 lg:hidden short:mb-4 short:flex short:items-baseline short:gap-2">
            <div className="flex items-center gap-2">
              <CircleDot className="size-6 text-accent" aria-hidden />
              <span className="text-lg font-semibold tracking-tight">Momentum</span>
            </div>
            <p className="mt-1 text-sm text-muted short:mt-0">Make every day count.</p>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight short:text-lg">{signup ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-1 mb-5 text-sm text-muted sm:mb-6 short:mb-3">{signup ? "Plan your day, get reminded, and see your progress." : "Sign in to see today's plan."}</p>
          <form onSubmit={submit} className="space-y-4 short:space-y-2.5" noValidate>
            <Field label="Username">
              {(id) => (
                <Input
                  id={id}
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="next"
                  maxLength={24}
                />
              )}
            </Field>
            {signup && (
              <Field label="Email" hint="Only used to remind you about pending tasks.">
                {(id) => <Input id={id} type="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" enterKeyHint="next" />}
              </Field>
            )}
            <Field label="Password" hint={signup ? "At least 8 characters" : undefined}>
              {(id) => (
                <div className="relative">
                  <Input
                    id={id}
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={signup ? "new-password" : "current-password"}
                    enterKeyHint="go"
                    className="pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted hover:text-fg"
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
              )}
            </Field>
            {error && (
              <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" className="w-full" loading={busy}>
              {signup ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted short:mt-3">{switchLink}</p>
        </div>
      </div>
    </main>
  );
}
