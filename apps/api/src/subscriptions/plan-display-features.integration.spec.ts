import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { DataSource } from "typeorm";
import source from "../database/data-source";
import { SubscriptionPlan, PlanDisplayFeatureDefinition, PlanDisplayFeatureValue } from "./entities";
import { SubscriptionsService } from "./subscriptions.service";

const integrationUrl = process.env.SUBSCRIPTION_DISPLAY_FEATURE_INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

test("PostgreSQL: display definitions are shared, plan values upsert, duplicates reject, and definition delete cascades", { skip: !integrationUrl && "Set DATABASE_URL or SUBSCRIPTION_DISPLAY_FEATURE_INTEGRATION_DATABASE_URL to run against a migrated development database" }, async () => {
  const db = new DataSource({ type: "postgres", entities: source.options.entities, url: integrationUrl!, synchronize: false, migrationsRun: false });
  await db.initialize();
  const service = new SubscriptionsService(db, {} as never);
  let featureId: string | undefined;
  try {
    const plan = await db.getRepository(SubscriptionPlan).findOneByOrFail({ key: "bronze" });
    const label = `تست ${randomUUID().slice(0, 8)}`;
    const feature = await service.createPlanDisplayFeature({ label, sortOrder: 31 });
    featureId = feature.id;
    await assert.rejects(service.createPlanDisplayFeature({ label: ` ${label} ` }), ConflictException);
    await service.setPlanDisplayFeatureValue(plan.key, feature.id, { value: "ندارد" });
    await service.setPlanDisplayFeatureValue(plan.key, feature.id, { value: "دارد" });
    assert.equal(await db.getRepository(PlanDisplayFeatureValue).countBy({ planId: plan.id, featureDefinitionId: feature.id }), 1);
    assert.equal((await service.getPlanDisplayFeatures([plan.id])).get(plan.id)?.[0]?.value, "دارد");
    const changed = await service.updatePlanDisplayFeatureDefinition(feature.id, { label: `${label} تازه`, sortOrder: 12 });
    assert.equal(changed.sortOrder, 12);
    await service.deletePlanDisplayFeatureDefinition(feature.id);
    featureId = undefined;
    assert.equal(await db.getRepository(PlanDisplayFeatureValue).countBy({ planId: plan.id, featureDefinitionId: feature.id }), 0);
    assert.equal(await db.getRepository(PlanDisplayFeatureDefinition).existsBy({ id: feature.id }), false);
  } finally {
    if (featureId) await db.getRepository(PlanDisplayFeatureDefinition).delete(featureId);
    await db.destroy();
  }
});
