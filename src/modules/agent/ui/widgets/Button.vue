<script setup lang="ts">
import { computed, inject, ref } from "vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import { useWidgetReply } from "../../lib/widget-bridge.ts";
import { formKey } from "./form.ts";

const props = defineProps<{
  /** Sends the surrounding `<Form>`'s values to the agent. */
  submit?: boolean;
  /** Puts the form's controls back to their initial values. */
  reset?: boolean;
  /** Sets form controls by name, e.g. `:preset="{ mode: 'fast' }"`. */
  preset?: Record<string, unknown>;
  /** Sends this value to the agent as it is (outside a form, for quick answers). */
  send?: unknown;
  /** A line shown before the data in the message the agent receives. */
  summary?: string;
  sentLabel?: string;
}>();
const form = inject(formKey, null);
const reply = useWidgetReply();
const sentAlone = ref(false);
const sent = computed(() => (props.submit ? !!form?.sent.value : sentAlone.value));
const locked = computed(() => sent.value || !!form?.sent.value);

// Only the click on this button sends: reply() refuses without a fresh user gesture.
function click() {
  if (props.reset) form?.reset();
  if (props.preset) form?.set(props.preset);
  if (props.submit && form && reply(form.values(), props.summary)) form.sent.value = true;
  else if (!props.submit && props.send !== undefined && reply(props.send, props.summary))
    sentAlone.value = true;
}
</script>

<template>
  <UiButton :disabled="locked" @click="click">
    <template v-if="sent">{{ sentLabel ?? "Отправлено" }}</template>
    <slot v-else />
  </UiButton>
</template>
