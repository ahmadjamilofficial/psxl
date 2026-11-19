/** Central product identity. Set VITE_PRODUCT_NAME once to rename every branded surface. */
export const BRAND_NAME = import.meta.env.VITE_PRODUCT_NAME?.trim() || "PSXL";
export const ASSISTANT_NAME = `${BRAND_NAME} Assistant`;
export function brandText(value: string): string {
  return value.replaceAll("{{brand}}", BRAND_NAME).replaceAll("{{assistant}}", ASSISTANT_NAME);
}
