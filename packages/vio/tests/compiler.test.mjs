import assert from "node:assert/strict";
import { test } from "node:test";
import { compileSfc } from "../dist/compiler.mjs";

await test("SFC compilation targets vio/core, strips TS and keeps normal Vue list/model expressions", () => {
  const code = compileSfc(
    `<script setup lang="ts">
    import { ref } from "vue";
    import { VBox, VEntry, VLabel } from "vio";
    const query = ref<string>(""); const items: string[] = ["one", "two"];
    </script><template><VBox><VEntry v-model="query"/><VLabel v-for="item in items" :key="item">{{ item }}</VLabel></VBox></template>`,
    "list.vue",
  );
  assert.match(code, /from "vio"/);
  assert.match(code, /renderList/);
  assert.match(code, /onUpdate:modelValue/);
  assert.doesNotMatch(code, /runtime-dom|ref<string>|items: string\[\]/);
});

await test("template-only and Options API SFCs receive a render function", () => {
  for (const script of [
    "",
    '<script>export default { data: () => ({ greeting: "hello" }) }</script>',
  ]) {
    const code = compileSfc(
      `${script}<template><gtk-label>{{ greeting }}</gtk-label></template>`,
      "options.vue",
    );
    assert.match(code, /__vio_component.render = __vio_render/);
    assert.match(code, /gtk-label/);
  }
});

await test("scoped styles use GTK classes instead of DOM attributes and have lifecycle cleanup", () => {
  const code = compileSfc(
    '<template><gtk-label class="heading">hello</gtk-label></template><style scoped>.heading { font-size: 22px; }</style>',
    "scoped.vue",
  );
  assert.match(code, /withStyles/);
  assert.match(code, /\.heading\.vio-[a-f\d]+/);
  assert.doesNotMatch(code, /\[data-v-/);
});

await test("unsupported DOM semantics fail with actionable diagnostics", () => {
  assert.throws(
    () => compileSfc('<template><gtk-label v-html="text"/></template>', "bad.vue"),
    /DOM directive/,
  );
  assert.throws(
    () => compileSfc('<template><gtk-entry v-model="query"/></template>', "bad.vue"),
    /supported on VEntry/,
  );
  assert.throws(
    () => compileSfc('<template><gtk-button @clicked.prevent="click"/></template>', "bad.vue"),
    /DOM event modifiers/,
  );
  assert.throws(() => compileSfc('<template src="x.html"/>', "bad.vue"), /external SFC blocks/);
});
