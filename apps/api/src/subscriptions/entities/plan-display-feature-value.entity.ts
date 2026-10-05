import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { SubscriptionPlan } from "./subscription-plan.entity";
import { PlanDisplayFeatureDefinition } from "./plan-display-feature-definition.entity";

@Entity({ name: "plan_display_feature_values" })
export class PlanDisplayFeatureValue {
  @PrimaryColumn({ name: "plan_id", type: "uuid" }) planId!: string;
  @PrimaryColumn({ name: "feature_definition_id", type: "uuid" }) featureDefinitionId!: string;
  @Column({ type: "varchar", length: 160 }) value!: string;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @ManyToOne(() => SubscriptionPlan, { onDelete: "CASCADE" }) @JoinColumn({ name: "plan_id" }) plan!: SubscriptionPlan;
  @ManyToOne(() => PlanDisplayFeatureDefinition, { onDelete: "CASCADE" }) @JoinColumn({ name: "feature_definition_id" }) definition!: PlanDisplayFeatureDefinition;
}
