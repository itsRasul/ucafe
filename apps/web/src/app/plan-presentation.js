function featureOrder(feature) {
  return Number.isFinite(feature.order) ? feature.order : 0;
}

function planCardFeatureRows(functionalFeatures, displayFeatures, limit = 7) {
  const orderedFunctional = functionalFeatures
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.included === true || feature.value === true)
    .sort((a, b) => featureOrder(a.feature) - featureOrder(b.feature) || a.index - b.index);
  const functional = orderedFunctional.slice(0, limit).map(({ feature }) => ({
    key: `functional:${feature.key}`,
    label: feature.label,
    checked: true,
    kind: "functional",
  }));
  const remaining = Math.max(0, limit - functional.length);
  const display = [...displayFeatures]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .slice(0, remaining)
    .map((feature) => {
      const value = typeof feature.value === "string" ? feature.value.trim() : "";
      const checked = value === "دارد";
      return {
        key: `display:${feature.key}`,
        label: checked || !value ? feature.label : `${feature.label}: ${value}`,
        checked,
        kind: "display",
      };
    });
  return [...functional, ...display];
}

function buildPlanComparisonRows(featureCatalog, plans) {
  const functionalRows = [...featureCatalog]
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
    .map((feature) => ({
      key: `functional:${feature.key}`,
      featureKey: feature.key,
      label: feature.label,
      kind: "functional",
      values: Object.fromEntries(plans.map((plan) => {
        const value = plan.features.find((item) => item.key === feature.key);
        return [plan.key, value?.included === true || value?.value === true];
      })),
    }));

  const displayDefinitions = new Map();
  for (const plan of plans) for (const feature of plan.displayFeatures ?? []) {
    if (!displayDefinitions.has(feature.key)) displayDefinitions.set(feature.key, feature);
  }
  const displayRows = [...displayDefinitions.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map((feature) => ({
      key: `display:${feature.key}`,
      featureKey: feature.key,
      label: feature.label,
      kind: "display",
      values: Object.fromEntries(plans.map((plan) => [plan.key, plan.displayFeatures?.find((item) => item.key === feature.key)?.value ?? null])),
    }));
  return [...functionalRows, ...displayRows];
}

module.exports = { planCardFeatureRows, buildPlanComparisonRows };
