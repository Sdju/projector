import { mediaAdapter, registerMediaAdapter } from "../modules/media/index.ts";
import { openAiMediaAdapter } from "../modules/media-openai/index.ts";
import { qwencloudAdapter } from "../modules/media-qwencloud/index.ts";

/** Встроенные адаптеры: общий сервис не знает ни одного вида провайдера. */
export function registerBuiltinMediaAdapters(): void {
  for (const adapter of [qwencloudAdapter, openAiMediaAdapter]) {
    if (!mediaAdapter(adapter.kind)) registerMediaAdapter(adapter);
  }
}

registerBuiltinMediaAdapters();
