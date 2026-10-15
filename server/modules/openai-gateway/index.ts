import { registerOpenOriginGuard } from "../access/index.ts";
import { checkGatewayKey } from "./config.ts";

// With a key the gateway authenticates itself; the LAN password then does not apply to it.
registerOpenOriginGuard((req) => checkGatewayKey(req.headers.authorization) ?? undefined);

export {
  checkGatewayKey,
  gatewayEnabled,
  gatewayHasKey,
  setGatewayEnabled,
  setGatewayKey,
} from "./config.ts";
export { GATEWAY_PREFIX, forward, isUpstreamPath, listModels, openAiError } from "./gateway.ts";
