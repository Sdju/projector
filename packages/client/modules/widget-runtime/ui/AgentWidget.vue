<script setup lang="ts">
import { inject, onBeforeUnmount, onErrorCaptured, ref, shallowRef, toRef, watch } from "vue";
import { autoClose, parseWidgetSource } from "../autoclose.ts";
import {
  compileScript,
  compileTemplate,
  loadCompiler,
  type RenderFn,
  type ScriptFn,
} from "../compile.ts";
import { createWidgetHost } from "../host.ts";
import { registeredWidgets } from "../registry.ts";
import { messageScopeKey } from "../scope.ts";

const props = defineProps<{ source: string; complete: boolean }>();
const render = shallowRef<RenderFn>();
const script = shallowRef<ScriptFn>();
const failure = shallowRef("");
/** A different message in the same place gets a fresh host; a longer one keeps it. */
const generation = ref(0);
const Host = createWidgetHost({
  components: registeredWidgets(),
  render,
  script,
  strict: toRef(props, "complete"),
  fail: (error) => (failure.value = message(error)),
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
let lastSource = "";
let lastTemplate = "";
let lastScript: string | undefined;
let frame = 0;

/**
 * The source grows with every chunk. A half-written template is closed (`autoClose`) and its render
 * function swapped into the one mounted host, at most once per frame; a finished source compiles
 * strictly, at once. The same template text is compiled once (cache), so a chunk that adds nothing
 * structural costs nothing.
 */
async function update() {
  frame = 0;
  await loadCompiler();
  if (!props.source.startsWith(lastSource)) generation.value++;
  lastSource = props.source;
  const parsed = parseWidgetSource(props.source);
  const template = props.complete ? parsed.template : autoClose(parsed.template);
  try {
    if (parsed.script !== lastScript) {
      lastScript = parsed.script;
      failure.value = "";
      script.value = parsed.script ? compileScript(parsed.script) : undefined;
    }
    if (template !== lastTemplate) {
      lastTemplate = template;
      failure.value = "";
      render.value = template.trim() ? compileTemplate(template) : undefined;
    }
  } catch (error) {
    // A half-written template that still does not compile is not an error yet.
    if (props.complete) failure.value = message(error);
  }
}
function schedule() {
  if (props.complete || typeof requestAnimationFrame === "undefined") void update();
  else if (!frame) frame = requestAnimationFrame(() => void update());
}
watch(() => [props.source, props.complete], schedule, { immediate: true });
// A name the component missed may be defined by a script that arrived after it: try again.
const sharedScope = inject(messageScopeKey, null);
watch(
  () => sharedScope?.version.value,
  () => (failure.value = ""),
);
onBeforeUnmount(() => frame && cancelAnimationFrame(frame));
onErrorCaptured((error) => {
  // Half a message: a component got data that is not there yet (a chart without its labels). It
  // renders again with the next chunk; only a finished message reports an error.
  if (props.complete) failure.value = message(error);
  return false;
});
</script>

<template>
  <!-- inert while streaming: half a form must not be answerable. -->
  <div class="widget" :inert="!complete">
    <div v-if="failure" class="widget-failure" role="alert">
      <p>{{ failure }}</p>
      <pre>{{ source }}</pre>
    </div>
    <component :is="Host" v-else-if="render" :key="generation" />
    <div v-else class="widget-pending" aria-busy="true" />
  </div>
</template>

<style scoped>
.widget {
  margin: 12px 0;
}
.widget-pending {
  height: 56px;
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
}
.widget-failure {
  color: var(--err);
  font-size: var(--fs-xs);
}
.widget-failure pre {
  color: var(--muted);
  overflow-x: auto;
}
</style>
