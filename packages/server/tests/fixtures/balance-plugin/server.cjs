// A trusted balance-only plugin: it contributes no agents, only a reader for its own kind.
exports.createPlugin = () => ({
  agents: [],
  balances: [
    {
      kind: "fixturebalance",
      read: async (context) => ({
        status: "ready",
        entries: [{ currency: "USD", total: "3.50", granted: "0", toppedUp: "3.50" }],
        available: true,
        message: context.name ? null : "Провайдер не назван",
      }),
    },
  ],
});
