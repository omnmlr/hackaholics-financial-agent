import { workspace } from "../src/lib/agent-workspace/store";
const store = workspace("restart-check");
if (process.argv[2] === "create") {
  const task = await store.createTask({
    title: "Follow up",
    objective: "Review agreement, not execute payment",
    dueAt: "2026-01-01T00:00:00.000Z",
  });
  await store.transition(task.id, task.version, "approve");
  await store.proposeMemory({
    text: "Gerald proposed Friday",
    category: "agreement",
  });
  console.log(JSON.stringify({ created: true }));
} else {
  const result = await store.runDue();
  const saved = await store.snapshot();
  console.log(
    JSON.stringify({
      delivered: result.delivered,
      tasks: saved.tasks.length,
      memories: saved.memories.length,
      notifications: saved.notifications.length,
    }),
  );
}
process.exit(0);
