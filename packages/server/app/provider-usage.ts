import { providerUsageResolver, registerProviderUsage } from "../modules/providers/index.ts";
import { qwencloudUsageResolver } from "../modules/provider-qwencloud/index.ts";

// HMR reloads this composition module; registration must stay idempotent.
if (!providerUsageResolver(qwencloudUsageResolver.kind))
  registerProviderUsage(qwencloudUsageResolver);
