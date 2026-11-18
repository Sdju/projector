<script setup lang="ts">
import Gdk from "gi:Gdk-4.0";
import GdkPixbuf from "gi:GdkPixbuf-2.0";
import Gio from "gi:Gio-2.0";
import GLib from "gi:GLib-2.0";
import { shallowRef, watch, VImage, VPicture } from "@zede/vio";

const props = defineProps<{ url: string }>();
const size = 32;
const texture = shallowRef<ReturnType<typeof Gdk.Texture.newForPixbuf>>();

watch(
  () => props.url,
  async (url, _, onCleanup) => {
    texture.value = undefined;
    const request = new AbortController();
    const decode = new Gio.Cancellable();
    onCleanup(() => {
      request.abort();
      decode.cancel();
    });

    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return;
      }
      const data = new Uint8Array(await response.arrayBuffer());
      if (request.signal.aborted) return;
      // node-gtk accepts typed arrays, but the generated signature only lists number[].
      const bytes = GLib.Bytes.new(data as unknown as number[]);
      const stream = Gio.MemoryInputStream.newFromBytes(bytes);
      const pixbuf = await new Promise<ReturnType<typeof GdkPixbuf.Pixbuf.newFromStreamFinish>>(
        (resolve, reject) => {
          GdkPixbuf.Pixbuf.newFromStreamAtScaleAsync(
            stream,
            size,
            size,
            true,
            decode,
            (_, result) => {
              try {
                resolve(GdkPixbuf.Pixbuf.newFromStreamFinish(result));
              } catch (error) {
                reject(error);
              }
            },
          );
        },
      );
      if (!request.signal.aborted) texture.value = Gdk.Texture.newForPixbuf(pixbuf);
    } catch {
      // Keep the folder icon when the request fails or GTK cannot decode the image.
    }
  },
  { immediate: true },
);
</script>

<template>
  <VPicture
    v-if="texture"
    :paintable="texture"
    :width-request="size"
    :height-request="size"
    content-fit="contain"
  />
  <VImage v-else icon-name="folder" :pixel-size="size" />
</template>
