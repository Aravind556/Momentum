import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { authClient } from "./lib/auth-client";
import { useMe } from "./lib/hooks";
import { Spinner } from "./components/ui";
import { Layout } from "./components/Layout";
import { AuthPage } from "./features/auth/AuthPage";
import { FocusPage } from "./features/focus/FocusPage";
import { GroupDetailPage } from "./features/groups/GroupDetailPage";
import { GroupsPage } from "./features/groups/GroupsPage";
import { JoinPage } from "./features/groups/JoinPage";
import { PlannerPage } from "./features/planner/PlannerPage";
import { ProgressPage } from "./features/progress/ProgressPage";
import { RoadmapDetailPage } from "./features/roadmaps/RoadmapDetailPage";
import { RoadmapsPage } from "./features/roadmaps/RoadmapsPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TodayPage } from "./features/today/TodayPage";

export function App() {
  const session = authClient.useSession();
  const location = useLocation();

  if (session.isPending) return <Spinner label="Loading Cadence" />;

  if (!session.data) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
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

  return (
    <Routes>
      <Route path="/login" element={<Navigate to={new URLSearchParams(location.search).get("next") || "/"} replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<TodayPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/tasks" element={<Navigate to="/planner?tab=tasks" replace />} />
        <Route path="/roadmaps" element={<RoadmapsPage />} />
        <Route path="/roadmaps/:id" element={<RoadmapDetailPage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:id" element={<GroupDetailPage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
