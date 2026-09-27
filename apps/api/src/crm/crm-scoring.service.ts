import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";
import { CrmFilterService } from "./crm-filter.service";
import { CreateCrmScoringRuleDto, UpdateCrmScoringRuleDto } from "./dto/crm-scoring.dto";
import { calculateLeadScores, CrmScoringCategory, scoreBand, ScoringContribution, usesLeadScoreField } from "./crm-scoring.util";
import { CrmWorkflowEventService } from "./crm-workflow-event.service";

type Row = Record<string, any>;
type Db = DataSource | EntityManager;
type Rule = { id: string; name: string; description: string | null; category: CrmScoringCategory; criteria: Record<string, unknown>; points: number; enabled: boolean; sortOrder: number; archivedAt: Date | null; createdAt: Date; updatedAt: Date };
type PreparedRule = Rule & { predicate: string };
const batchSize = 100;
const maxSynchronousLeads = 5000;
const advisoryLockKey = 1_129_277_779;
const stableJson = (value: unknown): string => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Row)[key])}`).join(",")}}` : JSON.stringify(value);

@Injectable()
export class CrmScoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmScoringService.name);
  private timer?: NodeJS.Timeout;
  private startupRefresh?: NodeJS.Timeout;

  constructor(private readonly dataSource: DataSource, private readonly filters: CrmFilterService, @Optional() private readonly workflowEvents?: CrmWorkflowEventService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.refreshTimeDependentScores(), 86_400_000);
    this.timer.unref();
    this.startupRefresh = setTimeout(() => void this.refreshTimeDependentScores(), 10_000);
    this.startupRefresh.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.startupRefresh) clearTimeout(this.startupRefresh);
  }

  async listRules() {
    const rules = await this.dataSource.query<Row[]>(`${this.ruleSelect()} WHERE archived_at IS NULL ORDER BY category,sort_order,id`);
    return Promise.all(rules.map(async (rule) => {
      const valid = await this.isValidRule(rule as Rule);
      return { ...rule, criteriaValid: valid, warning: valid ? null : "This rule uses a missing, inactive, or score-derived field." };
    }));
  }

  async createRule(input: CreateCrmScoringRuleDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.validateCriteria(input.criteria, manager);
      await this.lockActiveLeadRows(manager);
      await this.lockConfiguration(manager);
      if (input.enabled !== false) await this.assertRuleCapacity(manager);
      const rows = await manager.query<Row[]>(`
        INSERT INTO crm_scoring_rules(name,description,category,criteria,points,enabled,sort_order,created_by_user_id,updated_by_user_id)
        VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$8) RETURNING id
      `, [input.name, input.description?.trim() || null, input.category, JSON.stringify(input.criteria), input.points, input.enabled ?? true, input.sortOrder ?? 0, actorId]);
      const id = rows[0]!.id as string;
      await this.bumpVersion(manager);
      await this.audit(manager, actorId, "crm.scoring_rule.created", id);
      await this.recalculateAll(manager, "RULE_CHANGED");
      return this.getRule(manager, id);
    });
  }

  async updateRule(id: string, input: UpdateCrmScoringRuleDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.getRule(manager, id, true);
      const criteria = input.criteria ?? current.criteria;
      if (input.criteria !== undefined || input.enabled !== false) await this.validateCriteria(criteria, manager);
      const enabled = input.enabled ?? current.enabled;
      await this.lockActiveLeadRows(manager);
      await this.lockConfiguration(manager);
      if (enabled && !current.enabled) await this.assertRuleCapacity(manager);
      await manager.query(`UPDATE crm_scoring_rules SET name=$2,description=$3,category=$4,criteria=$5::jsonb,points=$6,enabled=$7,sort_order=$8,updated_by_user_id=$9,updated_at=now() WHERE id=$1`, [
        id, input.name ?? current.name, input.description === undefined ? current.description : input.description?.trim() || null,
        input.category ?? current.category, JSON.stringify(criteria), input.points ?? current.points, enabled,
        input.sortOrder ?? current.sortOrder, actorId,
      ]);
      await this.bumpVersion(manager);
      await this.audit(manager, actorId, "crm.scoring_rule.updated", id);
      await this.recalculateAll(manager, "RULE_CHANGED");
      return this.getRule(manager, id);
    });
  }

  async archiveRule(id: string, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.getRule(manager, id, true);
      await this.lockActiveLeadRows(manager);
      await this.lockConfiguration(manager);
      await manager.query("UPDATE crm_scoring_rules SET enabled=false,archived_at=COALESCE(archived_at,now()),updated_by_user_id=$2,updated_at=now() WHERE id=$1", [id, actorId]);
      await this.bumpVersion(manager);
      await this.audit(manager, actorId, "crm.scoring_rule.archived", id);
      await this.recalculateAll(manager, "RULE_CHANGED");
      return { id, archived: true };
    });
  }

  async preview(category: CrmScoringCategory, criteria: Record<string, unknown>) {
    await this.validateCriteria(criteria);
    const values: unknown[] = [];
    const predicate = await this.filters.compile(CrmCustomFieldEntityType.Lead, criteria, values, { entity: "l", organization: "o" });
    const rows = await this.dataSource.query<Row[]>(`SELECT count(*)::text AS total FROM crm_leads l LEFT JOIN crm_organizations o ON o.id=l.organization_id WHERE l.archived_at IS NULL AND l.status<>'CONVERTED' AND (${predicate})`, values);
    return { category, matchCount: Number(rows[0]?.total ?? 0) };
  }

  async getScore(leadId: string) {
    let rows = await this.dataSource.query<Row[]>("SELECT * FROM crm_lead_scores WHERE lead_id=$1", [leadId]);
    if (!rows[0]) {
      await this.recalculateLead(leadId, "MANUAL_RECALCULATION");
      rows = await this.dataSource.query<Row[]>("SELECT * FROM crm_lead_scores WHERE lead_id=$1", [leadId]);
    }
    const score = rows[0];
    if (!score) throw new NotFoundException("CRM lead not found");
    const history = await this.dataSource.query<Row[]>(`SELECT id,fit_score AS "fitScore",engagement_score AS "engagementScore",overall_score AS "overallScore",previous_overall_score AS "previousOverallScore",scoring_version AS "scoringVersion",reason,breakdown,calculated_at AS "calculatedAt" FROM crm_lead_score_history WHERE lead_id=$1 ORDER BY calculated_at DESC,id DESC LIMIT 10`, [leadId]);
    return {
      fit: score.fit_score, engagement: score.engagement_score, overall: score.overall_score,
      band: scoreBand(score.overall_score), configured: score.configured, scoringVersion: score.scoring_version,
      calculatedAt: score.calculated_at, breakdown: score.breakdown, history,
    };
  }

  async recalculateLead(leadId: string, reason = "MANUAL_RECALCULATION", manager?: EntityManager) {
    if (manager) { await this.recalculateLeads(manager, [leadId], reason); return; }
    await this.dataSource.transaction((transaction) => this.recalculateLeads(transaction, [leadId], reason));
    return this.getScore(leadId);
  }

  async recalculateLeadIds(leadIds: string[], reason: string, manager: EntityManager) {
    await this.recalculateLeads(manager, [...new Set(leadIds)], reason);
  }

  async recalculateAllIn(manager: EntityManager, reason: string) { await this.recalculateAll(manager, reason); }

  async recalculateAllActive() {
    return this.dataSource.transaction(async (manager) => {
      await this.lockActiveLeadRows(manager);
      await this.lockConfiguration(manager);
      await this.recalculateAll(manager, "MANUAL_RECALCULATION");
      return { recalculated: true };
    });
  }

  private async recalculateAll(manager: EntityManager, reason: string) {
    const rows = await manager.query<Row[]>("SELECT id FROM crm_leads WHERE archived_at IS NULL AND status<>'CONVERTED' ORDER BY id LIMIT $1", [maxSynchronousLeads + 1]);
    // ponytail: synchronous rescoring is capped at 5,000 active Leads; add a durable batch worker when volume exceeds this.
    if (rows.length > maxSynchronousLeads) throw new ConflictException("Too many active Leads for synchronous score recalculation; use a background batch worker.");
    for (let index = 0; index < rows.length; index += batchSize) {
      await this.recalculateLeads(manager, rows.slice(index, index + batchSize).map((row) => row.id as string), reason);
    }
  }

  private async recalculateLeads(manager: EntityManager, leadIds: string[], reason: string, evaluatedAt = new Date()) {
    if (!leadIds.length) return;
    const leads = await manager.query<Row[]>("SELECT id FROM crm_leads WHERE id=ANY($1::uuid[]) AND archived_at IS NULL AND status<>'CONVERTED' ORDER BY id FOR NO KEY UPDATE", [leadIds]);
    if (!leads.length) return;
    const ids = leads.map((lead) => lead.id as string);
    const [versionRows, sourceRules] = await Promise.all([
      manager.query<Row[]>("SELECT version FROM crm_scoring_state WHERE id=1 FOR SHARE"),
      manager.query<Row[]>(`${this.ruleSelect()} WHERE archived_at IS NULL AND enabled=true ORDER BY category,sort_order,id`),
    ]);
    const version = Number(versionRows[0]?.version ?? 1);
    let values: unknown[] = [ids, evaluatedAt];
    const prepared: PreparedRule[] = [];
    for (const rule of sourceRules) {
      if (usesLeadScoreField(rule.criteria)) continue;
      const candidate = rule as Rule;
      const nextValues = [...values];
      try {
        const predicate = await this.filters.compile(CrmCustomFieldEntityType.Lead, candidate.criteria, nextValues, { entity: "l", organization: "o", evaluationTime: "$2::timestamptz" }, manager);
        if (!predicate) continue;
        values = nextValues;
        prepared.push({ ...candidate, predicate });
      } catch {
        // Archived fields/options/tags leave the rule visible with a warning and stop contributing.
      }
    }
    const matches = prepared.map((rule, index) => `CASE WHEN (${rule.predicate}) THEN true ELSE false END AS "m${index}"`);
    const evaluated = await manager.query<Row[]>(`SELECT l.id,$2::timestamptz AS "evaluationTime"${matches.length ? `,${matches.join(",")}` : ""} FROM crm_leads l LEFT JOIN crm_organizations o ON o.id=l.organization_id WHERE l.id=ANY($1::uuid[]) ORDER BY l.id`, values);
    const byId = new Map(evaluated.map((row) => [row.id as string, row]));
    const configured = sourceRules.length > 0;
    const current = await manager.query<Row[]>("SELECT lead_id,fit_score,engagement_score,overall_score,configured,scoring_version,breakdown FROM crm_lead_scores WHERE lead_id=ANY($1::uuid[])", [ids]);
    const currentById = new Map(current.map((row) => [row.lead_id as string, row]));
    const results = ids.map((id) => {
      const matchRow = byId.get(id);
      const contributions: ScoringContribution[] = prepared.flatMap((rule, index) => matchRow?.[`m${index}`] ? [{ ruleId: rule.id, ruleName: rule.name, category: rule.category, points: rule.points }] : []);
      return { id, ...calculateLeadScores(contributions), configured, version, evaluatedAt };
    });
    const scoreValues: unknown[] = [];
    const scoreRows = results.map((result) => {
      const start = scoreValues.length + 1;
      scoreValues.push(result.id, result.fitScore, result.engagementScore, result.overallScore, result.configured, result.version, JSON.stringify(result.breakdown), result.evaluatedAt);
      return `($${start},$${start + 1},$${start + 2},$${start + 3},$${start + 4},$${start + 5},$${start + 6}::jsonb,$${start + 7})`;
    });
    await manager.query(`INSERT INTO crm_lead_scores(lead_id,fit_score,engagement_score,overall_score,configured,scoring_version,breakdown,calculated_at) VALUES ${scoreRows.join(",")} ON CONFLICT (lead_id) DO UPDATE SET fit_score=EXCLUDED.fit_score,engagement_score=EXCLUDED.engagement_score,overall_score=EXCLUDED.overall_score,configured=EXCLUDED.configured,scoring_version=EXCLUDED.scoring_version,breakdown=EXCLUDED.breakdown,calculated_at=EXCLUDED.calculated_at`, scoreValues);

    const changed = results.filter((result) => {
      const previous = currentById.get(result.id);
      return !previous || Number(previous.fit_score) !== result.fitScore || Number(previous.engagement_score) !== result.engagementScore || Number(previous.overall_score) !== result.overallScore || Boolean(previous.configured) !== result.configured || Number(previous.scoring_version) !== result.version || stableJson(previous.breakdown) !== stableJson(result.breakdown);
    });
    if (changed.length) {
      const historyValues: unknown[] = [];
      const historyRows = changed.map((result) => {
        const previous = currentById.get(result.id);
        const start = historyValues.length + 1;
        historyValues.push(result.id, result.fitScore, result.engagementScore, result.overallScore, previous?.overall_score ?? null, result.version, reason.slice(0, 32), JSON.stringify(result.breakdown), result.evaluatedAt);
        return `($${start},$${start + 1},$${start + 2},$${start + 3},$${start + 4},$${start + 5},$${start + 6},$${start + 7}::jsonb,$${start + 8})`;
      });
      await manager.query(`INSERT INTO crm_lead_score_history(lead_id,fit_score,engagement_score,overall_score,previous_overall_score,scoring_version,reason,breakdown,calculated_at) VALUES ${historyRows.join(",")}`, historyValues);
    }
    for (const result of changed) {
      const previous = currentById.get(result.id);
      if (!previous || Number(previous.fit_score) !== result.fitScore || Number(previous.engagement_score) !== result.engagementScore || Number(previous.overall_score) !== result.overallScore) {
        await this.workflowEvents?.record(manager, { eventType: "LEAD_SCORE_CHANGED", subjectType: "LEAD", subjectId: result.id, eventContext: {
          previousOverallScore: previous?.overall_score ?? null, overallScore: result.overallScore,
          previousFitScore: previous?.fit_score ?? null, fitScore: result.fitScore,
          previousEngagementScore: previous?.engagement_score ?? null, engagementScore: result.engagementScore,
        } });
      }
    }
  }

  private async refreshTimeDependentScores() {
    const rules = await this.dataSource.query<Row[]>("SELECT criteria FROM crm_scoring_rules WHERE enabled=true AND archived_at IS NULL");
    if (!rules.some((row) => (row.criteria?.conditions ?? []).some((condition: Row) => condition.field === "daysSinceLastActivity"))) return;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let locked = false;
    try {
      const lock = await runner.query("SELECT pg_try_advisory_lock($1) AS locked", [advisoryLockKey]);
      locked = Boolean(lock[0]?.locked);
      if (!locked) return;
      let afterId: string | null = null;
      while (true) {
        const leads = await runner.manager.query<Row[]>("SELECT id FROM crm_leads WHERE archived_at IS NULL AND status<>'CONVERTED' AND ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2", [afterId, batchSize]);
        if (!leads.length) break;
        await runner.startTransaction();
        try {
          await this.recalculateLeads(runner.manager, leads.map((row) => row.id as string), "SCHEDULED_REFRESH");
          await runner.commitTransaction();
        } catch (error) {
          await runner.rollbackTransaction();
          throw error;
        }
        afterId = leads.at(-1)!.id as string;
      }
    } catch {
      this.logger.error("Scheduled Lead score refresh failed.");
    } finally {
      if (locked) await runner.query("SELECT pg_advisory_unlock($1)", [advisoryLockKey]).catch(() => undefined);
      await runner.release();
    }
  }

  private async validateCriteria(criteria: Record<string, unknown>, manager: EntityManager = this.dataSource.manager) {
    if (usesLeadScoreField(criteria)) throw new BadRequestException("Scoring rules cannot depend on scores.");
    const values: unknown[] = [];
    const predicate = await this.filters.compile(CrmCustomFieldEntityType.Lead, criteria, values, { entity: "l", organization: "o" }, manager);
    if (!predicate) throw new BadRequestException("A scoring rule needs at least one condition.");
  }

  private async isValidRule(rule: Rule) {
    try { await this.validateCriteria(rule.criteria); return true; } catch { return false; }
  }

  private async assertRuleCapacity(manager: EntityManager) {
    const rows = await manager.query<Row[]>("SELECT count(*)::int AS total FROM crm_scoring_rules WHERE enabled=true AND archived_at IS NULL");
    if (Number(rows[0]?.total ?? 0) >= 100) throw new ConflictException("A maximum of 100 scoring rules can be enabled at a time.");
  }

  private async lockConfiguration(manager: EntityManager) {
    await manager.query("SELECT version FROM crm_scoring_state WHERE id=1 FOR UPDATE");
  }

  private async lockActiveLeadRows(manager: EntityManager) {
    const rows = await manager.query<Row[]>("SELECT id FROM crm_leads WHERE archived_at IS NULL AND status<>'CONVERTED' ORDER BY id LIMIT $1 FOR NO KEY UPDATE", [maxSynchronousLeads + 1]);
    if (rows.length > maxSynchronousLeads) throw new ConflictException("Too many active Leads for synchronous score recalculation; use a background batch worker.");
  }

  private async bumpVersion(manager: EntityManager) {
    await manager.query("UPDATE crm_scoring_state SET version=version+1 WHERE id=1");
  }

  private ruleSelect() {
    return `SELECT id,name,description,category,criteria,points,enabled,sort_order AS "sortOrder",archived_at AS "archivedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM crm_scoring_rules`;
  }

  private async getRule(manager: Db, id: string, lock = false): Promise<Rule> {
    const rows = await manager.query<Row[]>(`${this.ruleSelect()} WHERE id=$1 AND archived_at IS NULL ${lock ? "FOR UPDATE" : ""}`, [id]);
    if (!rows[0]) throw new NotFoundException("CRM scoring rule not found");
    return rows[0] as Rule;
  }

  private async audit(manager: EntityManager, actorId: string, action: string, id: string) {
    await manager.query("INSERT INTO platform_audit_events(actor_user_id,action,target_type,target_id,summary) VALUES($1,$2,'crm_scoring_rule',$3,'{}'::jsonb)", [actorId, action, id]);
  }
}
