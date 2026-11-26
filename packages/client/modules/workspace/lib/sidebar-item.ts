export interface SidebarItem {
  id: string;
  title: string;
  /** Shared icon name; the rail renders it through the icon service. */
  icon: string;
  badge: number;
  command?: string;
  /** Родительский раздел: иконка стоит рядом с ним в общей подложке. */
  group?: string;
  /** Вид раздела, по которому берутся компонент и подписи. */
  kind?: string;
  /** Временный раздел можно закрыть. */
  closable?: boolean;
  /** Служебный раздел (Hub, корзина): живёт в нижней группе вертикальной полосы. */
  utility?: boolean;
}
