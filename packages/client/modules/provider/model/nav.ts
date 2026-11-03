/** Navigation id of one provider's page, e.g. "provider:p3f2a…". */
export const providerSection = (id: string) => `provider:${id}`;

/** The provider a navigation id points at, or undefined for the other sections. */
export const providerOf = (section: string): string | undefined =>
  section.startsWith("provider:") ? section.slice("provider:".length) : undefined;
