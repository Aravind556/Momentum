import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
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
import { TasksPage } from "./features/tasks/TasksPage";
import { TodayPage } from "./features/today/TodayPage";

export function App() {
  const session = authClient.useSession();
  const location = useLocation();

  if (session.isPending) return <Spinner label="Loading Momentum" />;

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
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/calendar" element={<PlannerPage />} />
        <Route path="/planner" element={<OldPlannerRedirect />} />
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

/** Old /planner links (bookmarks, notifications) land on the page that now holds that tab. */
function OldPlannerRedirect() {
  const [params] = useSearchParams();
  const tab = params.get("tab");
  if (tab === "tasks") return <Navigate to="/tasks" replace />;
  if (tab === "classes" || tab === "availability" || tab === "commitments") return <Navigate to="/calendar?tab=setup" replace />;
  return <Navigate to="/calendar" replace />;
}
