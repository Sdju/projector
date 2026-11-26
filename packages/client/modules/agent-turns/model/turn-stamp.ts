import { computed, toValue, type MaybeRefOrGetter } from "vue";

export function useTurnStamp(at: MaybeRefOrGetter<number | string | undefined>) {
  const written = computed(() => {
    const value = toValue(at);
    return value ? new Date(value) : undefined;
  });
  const stamp = computed(() =>
    written.value?.toLocaleString("ru", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
  const stampFull = computed(() =>
    written.value?.toLocaleString("ru", { dateStyle: "long", timeStyle: "medium" }),
  );
  return { written, stamp, stampFull };
}
