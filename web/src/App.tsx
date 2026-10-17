import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { authClient } from "./lib/auth-client";
import { useMe } from "./lib/hooks";
import { Spinner } from "./components/ui";
import { Layout } from "./components/Layout";
import { AuthPage, ResetPasswordPage } from "./pages/Auth";
import { OnboardingPage } from "./pages/Onboarding";
import { TodayPage } from "./pages/Today";
import { PlannerPage } from "./pages/Planner";
import { TasksPage } from "./pages/Tasks";
import { FocusPage } from "./pages/Focus";
import { CirclesPage } from "./pages/Circles";
import { CircleDetailPage } from "./pages/CircleDetail";
import { ChallengesPage, ChallengeDetailPage } from "./pages/Challenges";
import { AnalyticsPage } from "./pages/Analytics";
import { IntegrationsPage } from "./pages/Integrations";
import { PlaylistsPage } from "./pages/Playlists";
import { SettingsPage } from "./pages/Settings";
import { JoinPage } from "./pages/Join";

export function App() {
  const session = authClient.useSession();
  const location = useLocation();

  if (session.isPending) return <Spinner label="Loading Cadence" />;

  if (!session.data) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/forgot" element={<AuthPage mode="forgot" />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />} />
      </Routes>
    );
  }
  return <SignedIn />;
}

function SignedIn() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Spinner label="Loading your workspace" />;
  if (me.isError) return <Spinner label="Reconnecting" />;

  const needsOnboarding = !me.data.profile.onboardedAt;
  if (needsOnboarding && location.pathname !== "/onboarding" && !location.pathname.startsWith("/join")) {
    return <Navigate to="/onboarding" replace />;
  }

  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/login" element={<Navigate to={new URLSearchParams(location.search).get("next") || "/"} replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<TodayPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="/circles" element={<CirclesPage />} />
        <Route path="/circles/:id" element={<CircleDetailPage />} />
        <Route path="/challenges" element={<ChallengesPage />} />
        <Route path="/challenges/:id" element={<ChallengeDetailPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/playlists" element={<PlaylistsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
