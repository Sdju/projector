// A trusted route-only plugin: no agents, no balances, only declared HTTP endpoints.
exports.createPlugin = (api) => {
  api.http.register({
    id: "status",
    handle: (context) => context.json(200, { ok: true, method: context.method }),
  });
  api.http.register({
    id: "echo",
    handle: async (context) => context.json(200, await context.readJson()),
  });
  api.http.register({
    id: "limited",
    handle: async (context) => context.json(200, { size: (await context.readBody(16)).length }),
  });
  api.http.register({
    id: "local",
    handle: async (context) => context.json(200, { local: await context.readJson() }),
  });
  api.http.register({
    id: "item",
    handle: (context) => context.json(200, { item: context.params.id }),
  });
  api.http.register({
    id: "me",
    handle: (context) => context.json(200, { me: true }),
  });
  api.http.register({
    id: "files",
    handle: (context) => context.json(200, { file: context.params["0"] }),
  });
  return { agents: [], balances: [] };
};
