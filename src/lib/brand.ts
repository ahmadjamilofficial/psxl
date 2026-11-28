/** Canonical product identity. SEO and app metadata must never inherit the legacy Wab name. */
export const BRAND_NAME = "PSXL";
export const ASSISTANT_NAME = `${BRAND_NAME} Assistant`;
export function brandText(value: string): string {
  return value.replaceAll("{{brand}}", BRAND_NAME).replaceAll("{{assistant}}", ASSISTANT_NAME);
}
