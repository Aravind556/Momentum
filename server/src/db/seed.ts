/**
 * DEVELOPMENT SEED DATA — creates two demo accounts sharing a Circle.
 * Never run against production. Accounts: demo@cadence.dev / friend@cadence.dev, password "demo-password".
 */
import { env } from "../env.js";
import { createAuth } from "../auth.js";
import { openDatabase, runMigrations } from "./index.js";
import { createRegistry } from "../integrations/registry.js";
import type { Services } from "../services/context.js";
import { getOrCreateProfile, updateProfile } from "../services/profiles.js";
import { createTask } from "../services/tasks.js";
import { createGoal } from "../services/goals.js";
import { createCircle, createInvitation, acceptInvitation } from "../services/circles.js";
import { createChallenge } from "../services/challenges.js";
import { addDays, taskInputSchema, todayInZone } from "@cadence/shared";

if (env.isProd) throw new Error("Refusing to seed a production database");

const database = await openDatabase({ databaseUrl: env.databaseUrl, pgliteDir: env.pgliteDir });
await runMigrations(database);
const auth = createAuth(database.db);
const s: Services = { db: database.db, now: () => Date.now(), integrations: createRegistry() };
const TZ = process.env.SEED_TIMEZONE || "Asia/Kolkata";

async function user(email: string, name: string) {
  const existing = await database.db.query.user.findFirst({ where: (u, { eq }) => eq(u.email, email) });
  const u = existing ?? (await auth.api.signUpEmail({ body: { email, password: "demo-password", name } })).user;
  const p = await getOrCreateProfile(database.db, { id: u.id, email, name });
  await updateProfile(database.db, u.id, { timezone: TZ, completeOnboarding: true, displayName: name }, Date.now());
  return { id: u.id, fresh: !existing, profile: p };
}

const demo = await user("demo@cadence.dev", "Demo User");
const friend = await user("friend@cadence.dev", "Demo Friend");

if (demo.fresh) {
  const goal = await createGoal(database.db, demo.id, {
    title: "[seed] Interview prep",
    category: "dsa",
    recurrence: { type: "none" },
    priority: 3,
    visibility: "private",
    progressMethod: "tasks",
  });
  const t = (o: Record<string, unknown>) => taskInputSchema.parse(o);
  await createTask(database.db, demo.id, t({ title: "[seed] LeetCode Medium", estimatedMinutes: 50, priority: 3, goalId: goal.id }));
  await createTask(database.db, demo.id, t({ title: "[seed] OS lecture", estimatedMinutes: 75, splittable: true, preferredSessionMinutes: 25 }));
  await createTask(database.db, demo.id, t({ title: "[seed] Side project", estimatedMinutes: 90, splittable: true, preferredSessionMinutes: 45 }));

  const circle = await createCircle(s, demo.id, { name: "[seed] DSA Prep", description: "Demo circle", rankingMode: "balanced" });
  const inv = await createInvitation(s, demo.id, circle.id, {});
  await acceptInvitation(s, friend.id, inv.code);
  const today = todayInZone(TZ);
  await createChallenge(s, demo.id, {
    circleId: circle.id,
    title: "[seed] One problem a day",
    startDate: today,
    endDate: addDays(today, 13),
    metric: "completions",
    individualTarget: 10,
    collectiveTarget: 20,
    taskTemplate: { title: "Solve one problem", estimatedMinutes: 30, splittable: false },
  });
  console.log("Seeded demo data.");
} else {
  console.log("Demo accounts already exist; nothing to do.");
}
console.log("Sign in with demo@cadence.dev / demo-password");
await database.close();
