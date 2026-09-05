export interface MenuVariantInput {
  name: string;
  isDefault: boolean;
}

export function validateMenuPricing(basePriceToman: number | null | undefined, variants: MenuVariantInput[]): string | null {
  if (basePriceToman == null && variants.length === 0) return "An item requires a base price or at least one variant";
  if (variants.filter((variant) => variant.isDefault).length > 1) return "Only one variant can be the default";
  const names = variants.map((variant) => variant.name.trim().toLocaleLowerCase("fa"));
  if (new Set(names).size !== names.length) return "Variant names must be unique";
  return null;
}
