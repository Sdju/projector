import { onBeforeUnmount, ref, type Ref } from "vue";
import { integrationRequest } from "./client.ts";
import type { DeviceLogin, Integration } from "./client.ts";

/** Device Flow lifecycle shared by GitHub and GitLab: start, poll and cancel. */
export function useDeviceLogin(options: {
  endpoint: string;
  pollEndpoint: string;
  connectedMessage: string;
  save: () => Promise<void>;
  apply: (integration: Integration) => void;
  error: Ref<string>;
  message: Ref<string>;
  action: (task: () => Promise<void>) => Promise<void>;
}) {
  const device = ref<DeviceLogin | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function cancel() {
    clearTimeout(timer);
    device.value = null;
  }

  async function poll(login: DeviceLogin) {
    if (disposed || device.value?.id !== login.id) return;
    try {
      const result = await integrationRequest<{
        pending: boolean;
        interval?: number;
        integration?: Integration;
      }>(options.pollEndpoint, "POST", { id: login.id });
      if (disposed || device.value?.id !== login.id) return;
      if (result.pending) {
        timer = setTimeout(() => void poll(login), (result.interval || 5) * 1000);
        return;
      }
      if (result.integration) options.apply(result.integration);
      cancel();
      options.message.value = options.connectedMessage;
    } catch (err) {
      if (!disposed && device.value?.id === login.id) {
        cancel();
        options.error.value = err instanceof Error ? err.message : "Ошибка входа";
      }
    }
  }

  function start() {
    return options.action(async () => {
      await options.save();
      const data = await integrationRequest<DeviceLogin>(options.endpoint, "POST");
      device.value = data;
      timer = setTimeout(() => void poll(data), data.interval * 1000);
    });
  }

  onBeforeUnmount(() => {
    disposed = true;
    cancel();
  });

  return { device, start, cancel };
}
