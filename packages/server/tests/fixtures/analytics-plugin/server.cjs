// Trusted plugin fixture: only the analytics reader matters here. The values come from the test
// environment so the installed copy does not need rebuilding.
exports.createAgents = () => [
  {
    id: "fixture-analytics",
    label: "Fixture Analytics",
    program: "fixture-analytics",
    run: async () => {},
    usageLog: {
      agent: "fixture-analytics",
      label: "Fixture token journal",
      roots: () => [process.env.PROJECTOR_FIXTURE_ANALYTICS_ROOT || "/nonexistent"],
      files: async () => [process.env.PROJECTOR_FIXTURE_ANALYTICS_FILE || "/nonexistent/journal"],
      read: async () => [
        {
          session: "fixture-session",
          event: "fixture-event",
          at: Number(process.env.PROJECTOR_FIXTURE_ANALYTICS_AT || Date.now()),
          model: "fixture-model",
          cwd: process.env.PROJECTOR_FIXTURE_ANALYTICS_CWD || "",
          tokens: { input: 100, output: 20, cacheRead: 30, cacheWrite: 5 },
          costSource: "none",
        },
      ],
    },
  },
];
