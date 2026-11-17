import "vue";

/**
 * Vue language tools 4 report every unknown prop on a component, while the UI components
 * intentionally pass attributes through to their root (`title`, `role`, `onClick`, `href`).
 * Keep the Vue 3 default of accepting them, as `checkUnknownProps: false` did before v4.
 */
declare module "vue" {
  interface ComponentCustomProps {
    [attr: string]: unknown;
  }
}
