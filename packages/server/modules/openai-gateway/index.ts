import { registerGatewayGuard, registerGatewayOrigins } from "../access/index.ts";
import { checkGatewayKey, gatewayOriginAllowed } from "./config.ts";

// With a key the gateway authenticates itself; the LAN password then does not apply to it.
registerGatewayGuard((req) => checkGatewayKey(req.headers.authorization) ?? undefined);
registerGatewayOrigins(gatewayOriginAllowed);

export {
  checkGatewayKey,
  gatewayEnabled,
  gatewayHasKey,
  gatewayOriginAllowed,
  gatewayOrigins,
  setGatewayOrigins,
  setGatewayEnabled,
  setGatewayKey,
} from "./config.ts";
export { GATEWAY_PREFIX, forward, isUpstreamPath, listModels, openAiError } from "./gateway.ts";
