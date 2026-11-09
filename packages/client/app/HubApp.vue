<script setup lang="ts">
import { provide, ref } from "vue";
import { createCommandService } from "@projector/core/modules/ide/index.ts";
import { commandHostKey } from "../common/utilities/commands.ts";
import { HubConsole } from "../modules/hub/index.ts";
// The public shell has commands but never starts a device runner, keybindings or event streams.
const sdk = createCommandService();
const revision = ref(0);
sdk.subscribe(() => revision.value++);
provide(commandHostKey, {
  createScope: sdk.createScope,
  revision,
  reportError: (error) => console.error(error),
});
</script>
<template><HubConsole /></template>
