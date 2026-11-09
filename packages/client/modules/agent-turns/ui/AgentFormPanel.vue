<script setup lang="ts">
import { computed, provide } from "vue";
import {
  AgentWidget,
  formChromeKey,
  formPresetKey,
  widgetReplyKey,
  type WidgetReply,
} from "../../widget-runtime/index.ts";

/**
 * A widget block used as an answer: the same markup the agent wrote, mounted on its own so it can
 * live in the composer or in a sent message. The wrapper supplies the form state the chat needs:
 * values to show again and whether the controls may be changed.
 */
const props = defineProps<{
  source: string;
  /** The answer already sent; `<Form>` fields show these values instead of their initials. */
  values?: unknown;
  readonly?: boolean;
  /** The composer owns the single send button; the form does not draw its own. */
  composer?: boolean;
  /** The project whose trusted widgets the form may contain. */
  projectId?: string;
}>();
const emit = defineEmits<{
  submit: [text: string, data: unknown, summary?: string];
  submittable: [value: boolean];
}>();

const readonly = computed(() => props.readonly === true);
const submitters = new Set<() => boolean | void>();
provide(formChromeKey, {
  composer: props.composer === true,
  registerSubmit(submit) {
    submitters.add(submit);
    emit("submittable", true);
    return () => {
      submitters.delete(submit);
      emit("submittable", submitters.size > 0);
    };
  },
});
function submit() {
  for (const handler of submitters) if (handler() === true) return true;
  return false;
}
defineExpose({ submit });
const seeded = computed<Record<string, unknown>>(() =>
  props.values && typeof props.values === "object" ? (props.values as Record<string, unknown>) : {},
);
provide(formPresetKey, { readonly, values: seeded.value });
provide(widgetReplyKey, ((text, data, summary) =>
  emit("submit", text, data, summary)) as WidgetReply);
</script>

<template>
  <AgentWidget :source="source" :complete="true" :project-id="projectId" />
</template>
