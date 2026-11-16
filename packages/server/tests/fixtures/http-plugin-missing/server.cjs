// A broken route plugin: the manifest declares `status` but the code registers nothing.
exports.createPlugin = () => ({ agents: [], balances: [] });
