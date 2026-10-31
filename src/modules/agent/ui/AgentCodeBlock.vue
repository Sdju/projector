<script setup lang="ts">
import { computed } from "vue";
import hljs from "highlight.js/lib/common";
import { codeLanguage } from "../lib/code-language.ts";

const props = defineProps<{ text: string; diff?: boolean; path?: string }>();
/** The body of a file is highlighted by its name; a diff keeps its own add/remove colors. */
const highlighted = computed(() => {
  const language = codeLanguage(props.path);
  if (props.diff || !language) return "";
  try {
    return hljs.highlight(props.text, { language, ignoreIllegals: true }).value;
  } catch {
    return "";
  }
});
// In a diff the first line is the file path; `- ` and `+ ` lines are removed and added code.
const lines = computed(() =>
  props.text
    .split("\n")
    // The empty line after the path only separates it in plain text; the path row has its own gap.
    .filter((line, index) => !(props.diff && index === 1 && !line))
    .map((line, index) => {
      if (!props.diff) return { line, kind: "" };
      if (index === 0) return { line, kind: "path" };
      if (line.startsWith("- ")) return { line: line.slice(2), kind: "del" };
      if (line.startsWith("+ ")) return { line: line.slice(2), kind: "add" };
      if (line === "@@") return { line: "⋯", kind: "gap" };
      return { line, kind: "" };
    }),
);
</script>

<template>
  <pre v-if="highlighted" class="code highlighted"><code v-html="highlighted" /></pre>
  <pre v-else class="code" :class="{ diff }"><span
    v-for="(row, index) in lines"
    :key="index"
    class="row"
    :class="row.kind"
    >{{ row.line || " " }}</span></pre>
</template>

<style scoped>
.code {
  font: var(--fs-2xs)/1.7 var(--mono);
  color: var(--text-2);
  margin: var(--sp-1) 0 var(--sp-2);
  padding: var(--sp-2) 0;
  border-radius: var(--r-md);
  background: var(--bg-2);
  max-height: 240px;
  overflow: auto;
}
.row {
  display: block;
  padding: 0 var(--sp-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.highlighted code {
  display: block;
  padding: 0 var(--sp-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.highlighted :deep(.hljs-keyword),
.highlighted :deep(.hljs-selector-tag) {
  color: var(--warn);
}
.highlighted :deep(.hljs-string),
.highlighted :deep(.hljs-attr) {
  color: var(--run);
}
.highlighted :deep(.hljs-number),
.highlighted :deep(.hljs-literal) {
  color: var(--err);
}
.highlighted :deep(.hljs-comment) {
  color: var(--faint);
}
.highlighted :deep(.hljs-title),
.highlighted :deep(.hljs-built_in) {
  color: var(--info);
}
.diff .row.add,
.diff .row.del {
  position: relative;
  padding-left: calc(var(--sp-3) + 14px);
}
.diff .row.add::before,
.diff .row.del::before {
  position: absolute;
  left: var(--sp-3);
}
.add {
  background: color-mix(in srgb, var(--run) 14%, transparent);
  color: var(--text);
}
.add::before {
  content: "+";
  color: var(--run);
}
.del {
  background: color-mix(in srgb, var(--err) 14%, transparent);
  color: var(--text-2);
}
.del::before {
  content: "−";
  color: var(--err);
}
.path {
  margin-bottom: var(--sp-1);
  color: var(--muted);
}
.gap {
  color: var(--faint);
}
</style>
