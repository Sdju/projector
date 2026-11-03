import { shallowReactive } from "vue";

/**
 * Панели с состоянием (чат агента, форма настроек) нельзя размонтировать при скрытии блока
 * или переносе вкладки. Они живут вне дока и телепортируются в элемент-хост видимой вкладки.
 */
export function createPanelHosts() {
  const hosts = shallowReactive<Record<string, HTMLElement | undefined>>({});
  return {
    hosts,
    register(id: string, element: HTMLElement) {
      hosts[id] = element;
    },
    unregister(id: string, element: HTMLElement) {
      // A moved tab mounts its new host before the old one unmounts.
      if (hosts[id] === element) delete hosts[id];
    },
  };
}
export type PanelHosts = ReturnType<typeof createPanelHosts>;
