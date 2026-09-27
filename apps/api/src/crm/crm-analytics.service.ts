import { BadRequestException, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { analyticsGranularity, analyticsRanges, analyticsSeriesParts, AnalyticsPeriod } from "../analytics/analytics-period";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { CRM_DEFAULT_PIPELINE } from "./crm-deal-lifecycle.util";
import { CrmAnalyticsQueryDto } from "./dto/crm-analytics.dto";
import { CrmLeadSource } from "./entities/crm-lead.entity";

type Row = Record<string, any>;
const CRM_TIMEZONE = "Asia/Tehran";
const stalledDays = 14;

function count(value: unknown) { return Number(value ?? 0); }
function rate(numerator: number, denominator: number) { return denominator ? Math.round(numerator / denominator * 1000) / 10 : null; }
function delta(current: number, previous: number) {
  return { value: current, previousValue: previous, changePercent: previous === 0 ? null : Math.round((current - previous) / previous * 1000) / 10, isNew: previous === 0 && current > 0 };
}
function ownerPredicate(column: string, parameter: string) {
  return `(${parameter}::text IS NULL OR (${parameter}::text='UNASSIGNED' AND ${column} IS NULL) OR (${parameter}::text<>'UNASSIGNED' AND ${column}=${parameter}::uuid))`;
}
function maskedUser(alias: string) {
  return `CASE WHEN ${alias}.id IS NULL THEN NULL WHEN ${alias}.phone IS NOT NULL THEN 'اپراتور ·•••'||right(${alias}.phone,4)
    WHEN ${alias}.email IS NOT NULL THEN 'اپراتور '||left(${alias}.email,1)||'…' ELSE 'اپراتور '||left(${alias}.id::text,8) END`;
}

@Injectable()
export class CrmAnalyticsService {
  constructor(private readonly dataSource: DataSource, private readonly subscriptions: SubscriptionsService) {}

  private ranges(query: CrmAnalyticsQueryDto) {
    if (query.period === "custom" ? !query.start || !query.end : query.start !== undefined || query.end !== undefined) {
      throw new BadRequestException("Start and end are allowed only together for a custom CRM analytics range");
    }
    return analyticsRanges(query.period as AnalyticsPeriod, CRM_TIMEZONE, query.start, query.end);
  }

  private periodInfo(query: CrmAnalyticsQueryDto) {
    const ranges = this.ranges(query);
    return { ranges, period: { from: ranges.current.start, to: this.previousDate(ranges.current.endExclusive), previousFrom: ranges.previous.start, previousTo: this.previousDate(ranges.previous.endExclusive), timezone: CRM_TIMEZONE } };
  }

  private previousDate(endExclusive: string) {
    const date = new Date(`${endExclusive}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  async overview(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const [leads, deals, work, funnel] = await Promise.all([
      this.leadPeriodCounts(ranges, query),
      this.dealPeriodCounts(ranges, query),
      this.workSummary(ranges, query),
      this.funnel(query),
    ]);
    const closedDeals = deals.won + deals.lost;
    const previousClosedDeals = deals.previousWon + deals.previousLost;
    return {
      period,
      generatedAt: new Date().toISOString(),
      metrics: {
        leadsCreated: delta(leads.created, leads.previousCreated),
        leadsQualified: delta(leads.qualified, leads.previousQualified),
        leadQualifiedRate: { value: rate(funnel.stages[2]?.value ?? 0, funnel.stages[0]?.value ?? 0), numerator: funnel.stages[2]?.value ?? 0, denominator: funnel.stages[0]?.value ?? 0 },
        wonDeals: delta(deals.won, deals.previousWon),
        lostDeals: delta(deals.lost, deals.previousLost),
        activities: delta(work.activities, work.previousActivities),
        completedTasks: delta(work.completedTasks, work.previousCompletedTasks),
        openDeals: deals.openDeals,
        openPipelineValueToman: deals.pipelineValueToman,
        valuedOpenDeals: deals.valuedOpenDeals,
        dealWinRate: { value: rate(deals.won, closedDeals), numerator: deals.won, denominator: closedDeals },
        previousDealWinRate: { value: rate(deals.previousWon, previousClosedDeals), numerator: deals.previousWon, denominator: previousClosedDeals },
        averageWinSalesCycleDays: deals.averageWinSalesCycleDays,
        overdueTasks: work.overdueTasks,
        overdueTaskRate: { value: rate(work.overdueTasks, work.openTasksWithDueDate), numerator: work.overdueTasks, denominator: work.openTasksWithDueDate },
        taskCompletionRate: { value: rate(work.completedDueTasks, work.dueTasks), numerator: work.completedDueTasks, denominator: work.dueTasks },
        followUpCompletionRate: { value: rate(work.completedDueFollowUps, work.dueFollowUps), numerator: work.completedDueFollowUps, denominator: work.dueFollowUps },
      },
    };
  }

  async funnel(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const rows = await this.dataSource.query<Row[]>(`
      SELECT count(*)::int AS created,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_lead_status_history h WHERE h.lead_id=l.id AND h.next_status='CONTACTED'))::int AS contacted,
        count(*) FILTER (WHERE l.qualified_at IS NOT NULL)::int AS qualified,
        count(*) FILTER (WHERE l.converted_at IS NOT NULL)::int AS converted,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_deals d WHERE d.originating_lead_id=l.id AND d.archived_at IS NULL))::int AS deals,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_deals d WHERE d.originating_lead_id=l.id AND d.archived_at IS NULL AND d.status='WON'))::int AS won
      FROM crm_leads l
      WHERE l.archived_at IS NULL
        AND l.created_at >= $1::date::timestamp AT TIME ZONE $3 AND l.created_at < $2::date::timestamp AT TIME ZONE $3
        AND ${ownerPredicate("l.owner_id", "$4")} AND ($5::text IS NULL OR l.source=$5)
    `, [ranges.current.start, ranges.current.endExclusive, CRM_TIMEZONE, query.ownerId ?? null, query.source ?? null]);
    const row = rows[0] ?? {};
    const values = [count(row.created), count(row.contacted), count(row.qualified), count(row.converted), count(row.deals), count(row.won)];
    const labels = ["سرنخ ثبت‌شده", "تماس برقرارشده", "واجد شرایط", "فرصت فروش", "برد"];
    const keys = ["created", "contacted", "qualified", "deal", "won"];
    const funnelValues = [values[0]!, values[1]!, values[2]!, values[4]!, values[5]!];
    return {
      period,
      cohort: "Leads created during the selected range; each Lead is counted once for every stage it has ever reached.",
      stages: funnelValues.map((value, index) => ({ key: keys[index], label: labels[index], value, fromPreviousRate: index === 0 ? null : rate(value, funnelValues[index - 1]!) })),
      leadsConvertedToOrganization: { value: values[3], rate: rate(values[3]!, values[0]!) },
    };
  }

  async pipeline(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const filters = [query.ownerId ?? null, query.source ?? null, query.pipelineKey ?? null, query.expectedPlanId ?? null];
    const dealWhere = `d.archived_at IS NULL AND ${ownerPredicate("d.owner_id", "$1")}
      AND ($2::text IS NULL OR l.source=$2) AND ($3::text IS NULL OR d.pipeline_key=$3)
      AND ($4::uuid IS NULL OR d.expected_plan_id=$4)`;
    const [stageRows, visitRows, stalledCountRows, stalledRows] = await Promise.all([
      this.dataSource.query<Row[]>(`
        SELECT d.stage,count(*)::int AS deals,COALESCE(sum(d.estimated_amount_toman),0)::text AS "estimatedAmountToman",
          count(d.estimated_amount_toman)::int AS "valuedDeals"
        FROM crm_deals d LEFT JOIN crm_leads l ON l.id=d.originating_lead_id
        WHERE ${dealWhere} AND d.status='OPEN' GROUP BY d.stage
      `, filters),
      this.dataSource.query<Row[]>(`
        WITH selected_deals AS (
          SELECT d.id,d.status,d.closed_at,d.won_at FROM crm_deals d LEFT JOIN crm_leads l ON l.id=d.originating_lead_id WHERE ${dealWhere}
        ), visits AS (
          SELECT h.deal_id,h.to_stage AS stage,h.created_at AS entered_at,d.status,d.closed_at,d.won_at,
            lead(h.created_at) OVER (PARTITION BY h.deal_id ORDER BY h.created_at,h.id) AS exited_at
          FROM crm_deal_stage_history h JOIN selected_deals d ON d.id=h.deal_id
        ), period_visits AS (
          SELECT * FROM visits v WHERE v.entered_at >= $5::date::timestamp AT TIME ZONE $7
            AND v.entered_at < $6::date::timestamp AT TIME ZONE $7
        )
        SELECT v.stage,count(*)::int AS visits,
          round(avg(greatest(0,extract(epoch FROM (COALESCE(v.exited_at,CASE WHEN v.status='OPEN' THEN now() ELSE v.closed_at END)-v.entered_at))/86400.0))::numeric,1)::float8 AS "averageDays",
          count(DISTINCT v.deal_id)::int AS "dealsEntered",
          count(DISTINCT v.deal_id) FILTER (WHERE EXISTS (
            SELECT 1 FROM crm_deal_stage_history next WHERE next.deal_id=v.deal_id AND next.created_at>v.entered_at
              AND CASE next.to_stage WHEN 'DISCOVERY' THEN 0 WHEN 'DEMO_SCHEDULED' THEN 1 WHEN 'DEMO_COMPLETED' THEN 2 WHEN 'TRIAL_PROPOSED' THEN 3 WHEN 'TRIAL_ACTIVE' THEN 4 ELSE 5 END >
                  CASE v.stage WHEN 'DISCOVERY' THEN 0 WHEN 'DEMO_SCHEDULED' THEN 1 WHEN 'DEMO_COMPLETED' THEN 2 WHEN 'TRIAL_PROPOSED' THEN 3 WHEN 'TRIAL_ACTIVE' THEN 4 ELSE 5 END
          ) OR (v.status='WON' AND v.won_at>v.entered_at))::int AS "dealsProgressed"
        FROM period_visits v GROUP BY v.stage
      `, [...filters, ranges.current.start, ranges.current.endExclusive, CRM_TIMEZONE]),
      this.stalledDealsCount(filters, dealWhere),
      this.stalledDealsList(filters, dealWhere),
    ]);
    const stages = CRM_DEFAULT_PIPELINE.stages.map((stage) => {
      const current = stageRows.find((row) => row.stage === stage.key);
      const visits = visitRows.find((row) => row.stage === stage.key);
      const entered = count(visits?.dealsEntered);
      const progressed = count(visits?.dealsProgressed);
      return {
        stage: stage.key,
        label: stage.key,
        openDeals: count(current?.deals),
        pipelineValueToman: String(current?.estimatedAmountToman ?? "0"),
        valuedDeals: count(current?.valuedDeals),
        visits: count(visits?.visits),
        averageVisitDays: visits?.averageDays == null ? null : Number(visits.averageDays),
        dealsEntered: entered,
        dealsProgressed: progressed,
        progressionRate: rate(progressed, entered),
      };
    });
    return { period, pipelineKey: query.pipelineKey ?? "ucafe-default", snapshot: "Current open Deals; the date range applies to stage visits and progression cohorts.", stages,
      stalled: { thresholdDays: stalledDays, total: count(stalledCountRows[0]?.total), items: stalledRows } };
  }

  async sources(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const knownSources = Object.values(CrmLeadSource);
    const rows = await this.dataSource.query<Row[]>(`
      WITH source_keys AS (SELECT unnest($1::text[]) AS source UNION ALL SELECT 'UNKNOWN_DIRECT'),
      leads AS (
        SELECT l.source,count(*)::int AS "leadsCreated",
          count(*) FILTER (WHERE l.qualified_at IS NOT NULL)::int AS qualified,
          count(*) FILTER (WHERE l.converted_at IS NOT NULL)::int AS converted
        FROM crm_leads l WHERE l.archived_at IS NULL
          AND l.created_at >= $2::date::timestamp AT TIME ZONE $4 AND l.created_at < $3::date::timestamp AT TIME ZONE $4
          AND ${ownerPredicate("l.owner_id", "$5")} AND ($6::text IS NULL OR l.source=$6)
        GROUP BY l.source
      ), deals AS (
        SELECT COALESCE(l.source,'UNKNOWN_DIRECT') AS source,
          count(d.id) FILTER (WHERE d.created_at >= $2::date::timestamp AT TIME ZONE $4 AND d.created_at < $3::date::timestamp AT TIME ZONE $4)::int AS "dealsCreated",
          count(d.id) FILTER (WHERE d.won_at >= $2::date::timestamp AT TIME ZONE $4 AND d.won_at < $3::date::timestamp AT TIME ZONE $4)::int AS "dealsWon",
          count(d.id) FILTER (WHERE d.lost_at >= $2::date::timestamp AT TIME ZONE $4 AND d.lost_at < $3::date::timestamp AT TIME ZONE $4)::int AS "dealsLost"
        FROM crm_deals d LEFT JOIN crm_leads l ON l.id=d.originating_lead_id
        WHERE d.archived_at IS NULL AND (d.created_at >= $2::date::timestamp AT TIME ZONE $4 OR d.won_at >= $2::date::timestamp AT TIME ZONE $4 OR d.lost_at >= $2::date::timestamp AT TIME ZONE $4)
          AND ((d.created_at >= $2::date::timestamp AT TIME ZONE $4 AND d.created_at < $3::date::timestamp AT TIME ZONE $4)
            OR (d.won_at >= $2::date::timestamp AT TIME ZONE $4 AND d.won_at < $3::date::timestamp AT TIME ZONE $4)
            OR (d.lost_at >= $2::date::timestamp AT TIME ZONE $4 AND d.lost_at < $3::date::timestamp AT TIME ZONE $4))
          AND ${ownerPredicate("d.owner_id", "$5")} AND ($6::text IS NULL OR l.source=$6)
          AND ($7::text IS NULL OR d.pipeline_key=$7) AND ($8::uuid IS NULL OR d.expected_plan_id=$8)
        GROUP BY COALESCE(l.source,'UNKNOWN_DIRECT')
      )
      SELECT k.source,"leads"."leadsCreated",COALESCE(leads.qualified,0)::int AS qualified,COALESCE(leads.converted,0)::int AS converted,
        COALESCE(deals."dealsCreated",0)::int AS "dealsCreated",COALESCE(deals."dealsWon",0)::int AS "dealsWon",COALESCE(deals."dealsLost",0)::int AS "dealsLost"
      FROM source_keys k LEFT JOIN leads USING(source) LEFT JOIN deals USING(source) ORDER BY k.source
    `, [knownSources, ranges.current.start, ranges.current.endExclusive, CRM_TIMEZONE, query.ownerId ?? null, query.source ?? null, query.pipelineKey ?? null, query.expectedPlanId ?? null]);
    return {
      period,
      attribution: "Deals use their originating Lead source; Deals without an originating Lead are Unknown / Direct.",
      items: rows.map((row) => {
        const leadCount = count(row.leadsCreated), qualified = count(row.qualified), converted = count(row.converted), won = count(row.dealsWon), lost = count(row.dealsLost);
        return { source: row.source, leadsCreated: leadCount, qualified, qualificationRate: rate(qualified, leadCount), converted, leadConversionRate: rate(converted, leadCount),
          dealsCreated: count(row.dealsCreated), dealsWon: won, dealsLost: lost, dealWinRate: rate(won, won + lost), closedDeals: won + lost };
      }),
    };
  }

  async work(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const [summary, typeRows, series] = await Promise.all([
      this.workSummary(ranges, query),
      this.dataSource.query<Row[]>(`
        SELECT a.activity_type AS type,a.outcome,count(*)::int AS count FROM crm_activities a
        WHERE a.archived_at IS NULL AND a.occurred_at >= $1::date::timestamp AT TIME ZONE $3 AND a.occurred_at < $2::date::timestamp AT TIME ZONE $3
          AND ${ownerPredicate("a.actor_user_id", "$4")} GROUP BY a.activity_type,a.outcome ORDER BY a.activity_type,a.outcome NULLS FIRST
      `, [ranges.current.start, ranges.current.endExclusive, CRM_TIMEZONE, query.ownerId ?? null]),
      this.activitySeries(ranges.current, query),
    ]);
    return { period, metrics: summary, activitiesByType: typeRows.map((row) => ({ type: row.type, outcome: row.outcome, count: count(row.count) })), activitySeries: series };
  }

  async owners(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const rows = await this.dataSource.query<Row[]>(`
      WITH bounds AS (SELECT $1::date::timestamp AT TIME ZONE $3 AS range_start,$2::date::timestamp AT TIME ZONE $3 AS range_end), owner_ids AS (
        SELECT l.owner_id AS id FROM crm_leads l CROSS JOIN bounds b WHERE l.archived_at IS NULL AND l.created_at>=b.range_start AND l.created_at<b.range_end
          AND ${ownerPredicate("l.owner_id", "$7")}
        UNION SELECT d.owner_id FROM crm_deals d CROSS JOIN bounds b WHERE d.archived_at IS NULL AND (d.status='OPEN' OR d.closed_at>=b.range_start AND d.closed_at<b.range_end)
          AND ${ownerPredicate("d.owner_id", "$7")}
        UNION SELECT a.actor_user_id FROM crm_activities a CROSS JOIN bounds b WHERE a.archived_at IS NULL AND a.occurred_at>=b.range_start AND a.occurred_at<b.range_end
          AND ${ownerPredicate("a.actor_user_id", "$7")}
        UNION SELECT t.assigned_to_user_id FROM crm_tasks t WHERE t.archived_at IS NULL AND t.status='OPEN' AND ${ownerPredicate("t.assigned_to_user_id", "$7")}
      ), lead_stats AS (
        SELECT l.owner_id AS id,count(*)::int AS "leadsCreated",count(*) FILTER (WHERE l.qualified_at IS NOT NULL)::int AS qualified,
          count(*) FILTER (WHERE l.converted_at IS NOT NULL)::int AS converted
        FROM crm_leads l CROSS JOIN bounds b WHERE l.archived_at IS NULL AND l.created_at>=b.range_start AND l.created_at<b.range_end
          AND ($4::text IS NULL OR l.source=$4) AND ${ownerPredicate("l.owner_id", "$7")} GROUP BY l.owner_id
      ), deal_stats AS (
        SELECT d.owner_id AS id,count(*) FILTER (WHERE d.status='OPEN')::int AS "openDeals",
          count(*) FILTER (WHERE d.won_at>=b.range_start AND d.won_at<b.range_end)::int AS won,
          count(*) FILTER (WHERE d.lost_at>=b.range_start AND d.lost_at<b.range_end)::int AS lost
        FROM crm_deals d LEFT JOIN crm_leads l ON l.id=d.originating_lead_id CROSS JOIN bounds b
        WHERE d.archived_at IS NULL AND ($4::text IS NULL OR l.source=$4) AND ($5::text IS NULL OR d.pipeline_key=$5)
          AND ($6::uuid IS NULL OR d.expected_plan_id=$6) AND (d.status='OPEN' OR d.closed_at>=b.range_start AND d.closed_at<b.range_end)
          AND ${ownerPredicate("d.owner_id", "$7")}
        GROUP BY d.owner_id
      ), activity_stats AS (
        SELECT a.actor_user_id AS id,count(*)::int AS activities FROM crm_activities a CROSS JOIN bounds b
        WHERE a.archived_at IS NULL AND a.occurred_at>=b.range_start AND a.occurred_at<b.range_end AND ${ownerPredicate("a.actor_user_id", "$7")} GROUP BY a.actor_user_id
      ), task_stats AS (
        SELECT t.assigned_to_user_id AS id,count(*) FILTER (WHERE t.status='OPEN')::int AS "openTasks",
          count(*) FILTER (WHERE t.status='OPEN' AND t.due_at<now())::int AS "overdueTasks"
        FROM crm_tasks t WHERE t.archived_at IS NULL AND t.status='OPEN' AND ${ownerPredicate("t.assigned_to_user_id", "$7")} GROUP BY t.assigned_to_user_id
      )
      SELECT ids.id,CASE WHEN ids.id IS NULL THEN 'بدون مسئول' ELSE ${maskedUser("u")} END AS label,
        COALESCE(ls."leadsCreated",0)::int AS "leadsCreated",COALESCE(ls.qualified,0)::int AS qualified,COALESCE(ls.converted,0)::int AS converted,
        COALESCE(ds."openDeals",0)::int AS "openDeals",COALESCE(ds.won,0)::int AS won,COALESCE(ds.lost,0)::int AS lost,
        COALESCE(a.activities,0)::int AS activities,COALESCE(t."openTasks",0)::int AS "openTasks",COALESCE(t."overdueTasks",0)::int AS "overdueTasks"
      FROM owner_ids ids LEFT JOIN users u ON u.id=ids.id LEFT JOIN lead_stats ls ON ls.id IS NOT DISTINCT FROM ids.id
      LEFT JOIN deal_stats ds ON ds.id IS NOT DISTINCT FROM ids.id LEFT JOIN activity_stats a ON a.id IS NOT DISTINCT FROM ids.id
      LEFT JOIN task_stats t ON t.id IS NOT DISTINCT FROM ids.id ORDER BY label,ids.id
    `, [ranges.current.start, ranges.current.endExclusive, CRM_TIMEZONE, query.source ?? null, query.pipelineKey ?? null, query.expectedPlanId ?? null, query.ownerId ?? null]);
    return { period, ownerSemantics: "Lead/Deal owner, Activity performer, and Task assignee are reported from their own current source fields.", items: rows.map((row) => {
      const won = count(row.won), lost = count(row.lost);
      return { ...row, leadsCreated: count(row.leadsCreated), qualified: count(row.qualified), converted: count(row.converted), openDeals: count(row.openDeals), won, lost,
        dealWinRate: rate(won, won + lost), activities: count(row.activities), openTasks: count(row.openTasks), overdueTasks: count(row.overdueTasks) };
    }) };
  }

  async scoring(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const rows = await this.dataSource.query<Row[]>(`
      SELECT CASE WHEN ls.configured=false THEN 'UNCONFIGURED' WHEN ls.overall_score<=39 THEN 'LOW' WHEN ls.overall_score<=69 THEN 'MEDIUM' WHEN ls.overall_score<=84 THEN 'HIGH' ELSE 'VERY_HIGH' END AS band,
        count(*)::int AS leads,count(*) FILTER (WHERE l.status='QUALIFIED')::int AS qualified,
        count(*) FILTER (WHERE l.status='CONVERTED')::int AS converted,
        round(avg(ls.fit_score)::numeric,1)::float8 AS "averageFit",round(avg(ls.engagement_score)::numeric,1)::float8 AS "averageEngagement",
        round(avg(ls.overall_score)::numeric,1)::float8 AS "averageOverall"
      FROM crm_leads l JOIN crm_lead_scores ls ON ls.lead_id=l.id
      WHERE l.archived_at IS NULL AND l.created_at >= $1::date::timestamp AT TIME ZONE $3 AND l.created_at < $2::date::timestamp AT TIME ZONE $3
        AND ${ownerPredicate("l.owner_id", "$4")} AND ($5::text IS NULL OR l.source=$5)
      GROUP BY band
    `, [ranges.current.start, ranges.current.endExclusive, CRM_TIMEZONE, query.ownerId ?? null, query.source ?? null]);
    const bands = ["UNCONFIGURED", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"];
    const labels: Record<string, string> = { UNCONFIGURED: "تنظیم‌نشده", LOW: "کم · ۰ تا ۳۹", MEDIUM: "متوسط · ۴۰ تا ۶۹", HIGH: "زیاد · ۷۰ تا ۸۴", VERY_HIGH: "خیلی زیاد · ۸۵ تا ۱۰۰" };
    return { period, interpretation: "Rule-based score bands are descriptive, not conversion probabilities. Converted Leads retain their last score; active Leads use their current score.", bands: bands.map((band) => {
      const row = rows.find((item) => item.band === band);
      const leads = count(row?.leads), converted = count(row?.converted);
      return { band, label: labels[band]!, leads, qualified: count(row?.qualified), converted, observedConversionRate: rate(converted, leads),
        averageFit: row?.averageFit == null ? null : Number(row.averageFit), averageEngagement: row?.averageEngagement == null ? null : Number(row.averageEngagement), averageOverall: row?.averageOverall == null ? null : Number(row.averageOverall) };
    }) };
  }

  async automation(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const rows = await this.dataSource.query<Row[]>(`
      WITH bounds AS (SELECT $1::date::timestamp AT TIME ZONE $3 AS range_start,$2::date::timestamp AT TIME ZONE $3 AS range_end), execution_stats AS (
        SELECT e.workflow_id,count(*)::int AS executions,count(*) FILTER (WHERE e.status='SUCCEEDED')::int AS succeeded,
          count(*) FILTER (WHERE e.status='FAILED')::int AS failed,count(*) FILTER (WHERE e.status IN ('SUCCEEDED','FAILED'))::int AS terminal,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_workflow_action_executions a WHERE a.workflow_execution_id=e.id AND (a.attempt>1 OR a.manual_retry_count>0)))::int AS "retriedExecutions"
        FROM crm_workflow_executions e CROSS JOIN bounds b WHERE e.created_at>=b.range_start AND e.created_at<b.range_end GROUP BY e.workflow_id
      ), task_stats AS (
        SELECT e.workflow_id,count(DISTINCT t.id)::int AS "automationTasksCreated"
        FROM crm_tasks t JOIN crm_workflow_action_executions a ON a.id=t.automation_action_execution_id
        JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id CROSS JOIN bounds b
        WHERE t.created_at>=b.range_start AND t.created_at<b.range_end GROUP BY e.workflow_id
      )
      SELECT w.id AS "workflowId",w.name,COALESCE(e.executions,0)::int AS executions,COALESCE(e.succeeded,0)::int AS succeeded,
        COALESCE(e.failed,0)::int AS failed,COALESCE(e.terminal,0)::int AS terminal,COALESCE(e."retriedExecutions",0)::int AS "retriedExecutions",
        COALESCE(t."automationTasksCreated",0)::int AS "automationTasksCreated"
      FROM crm_workflows w LEFT JOIN execution_stats e ON e.workflow_id=w.id LEFT JOIN task_stats t ON t.workflow_id=w.id
      WHERE e.workflow_id IS NOT NULL OR t.workflow_id IS NOT NULL ORDER BY w.name,w.id
    `, [ranges.current.start, ranges.current.endExclusive, CRM_TIMEZONE]);
    const items = rows.map((row) => ({ ...row, executions: count(row.executions), succeeded: count(row.succeeded), failed: count(row.failed), terminal: count(row.terminal),
      retriedExecutions: count(row.retriedExecutions), automationTasksCreated: count(row.automationTasksCreated), successRate: rate(count(row.succeeded), count(row.terminal)) }));
    return { period, semantics: "Execution time is the matched Workflow execution's createdAt; success rate excludes RUNNING, RETRYING, and PENDING executions.",
      summary: items.reduce((sum, item) => ({ executions: sum.executions + item.executions, succeeded: sum.succeeded + item.succeeded, failed: sum.failed + item.failed,
        terminal: sum.terminal + item.terminal, retriedExecutions: sum.retriedExecutions + item.retriedExecutions, automationTasksCreated: sum.automationTasksCreated + item.automationTasksCreated }),
        { executions: 0, succeeded: 0, failed: 0, terminal: 0, retriedExecutions: 0, automationTasksCreated: 0 }), items };
  }

  async customers(query: CrmAnalyticsQueryDto) {
    const { ranges, period } = this.periodInfo(query);
    const organizations = await this.dataSource.query<Array<{ coffeeShopId: string }>>(
      "SELECT coffee_shop_id AS \"coffeeShopId\" FROM crm_organizations WHERE archived_at IS NULL AND coffee_shop_id IS NOT NULL ORDER BY id",
    );
    const customerMetrics = await this.subscriptions.getCrmAnalytics(organizations.map((row) => row.coffeeShopId), ranges.current, CRM_TIMEZONE, query.subscriptionPlanId);
    return { period, linkedOrganizations: organizations.length, definition: "Paid customer counts use the linked Tenant's effective ACTIVE Subscription and require a recorded non-legacy paid payment. Trial facts use Subscription trial dates and TRIAL_TO_PAID payment operations.", ...customerMetrics };
  }

  private async leadPeriodCounts(ranges: ReturnType<typeof analyticsRanges>, query: CrmAnalyticsQueryDto) {
    const rows = await this.dataSource.query<Row[]>(`
      WITH bounds AS (
        SELECT $1::date::timestamp AT TIME ZONE $5 AS current_start,$2::date::timestamp AT TIME ZONE $5 AS current_end,
               $3::date::timestamp AT TIME ZONE $5 AS previous_start,$4::date::timestamp AT TIME ZONE $5 AS previous_end
      )
      SELECT count(*) FILTER (WHERE l.created_at>=b.current_start AND l.created_at<b.current_end)::int AS created,
        count(*) FILTER (WHERE l.created_at>=b.previous_start AND l.created_at<b.previous_end)::int AS "previousCreated",
        count(*) FILTER (WHERE l.qualified_at>=b.current_start AND l.qualified_at<b.current_end)::int AS qualified,
        count(*) FILTER (WHERE l.qualified_at>=b.previous_start AND l.qualified_at<b.previous_end)::int AS "previousQualified"
      FROM crm_leads l CROSS JOIN bounds b WHERE l.archived_at IS NULL AND ${ownerPredicate("l.owner_id", "$6")} AND ($7::text IS NULL OR l.source=$7)
    `, [ranges.current.start, ranges.current.endExclusive, ranges.previous.start, ranges.previous.endExclusive, CRM_TIMEZONE, query.ownerId ?? null, query.source ?? null]);
    const row = rows[0] ?? {};
    return { created: count(row.created), previousCreated: count(row.previousCreated), qualified: count(row.qualified), previousQualified: count(row.previousQualified) };
  }

  private async dealPeriodCounts(ranges: ReturnType<typeof analyticsRanges>, query: CrmAnalyticsQueryDto) {
    const rows = await this.dataSource.query<Row[]>(`
      WITH bounds AS (
        SELECT $1::date::timestamp AT TIME ZONE $5 AS current_start,$2::date::timestamp AT TIME ZONE $5 AS current_end,
               $3::date::timestamp AT TIME ZONE $5 AS previous_start,$4::date::timestamp AT TIME ZONE $5 AS previous_end
      )
      SELECT count(*) FILTER (WHERE d.won_at>=b.current_start AND d.won_at<b.current_end)::int AS won,
        count(*) FILTER (WHERE d.won_at>=b.previous_start AND d.won_at<b.previous_end)::int AS "previousWon",
        count(*) FILTER (WHERE d.lost_at>=b.current_start AND d.lost_at<b.current_end)::int AS lost,
        count(*) FILTER (WHERE d.lost_at>=b.previous_start AND d.lost_at<b.previous_end)::int AS "previousLost",
        round(avg(extract(epoch FROM (d.won_at-d.created_at))/86400.0) FILTER (WHERE d.won_at>=b.current_start AND d.won_at<b.current_end)::numeric,1)::float8 AS "averageWinSalesCycleDays",
        count(*) FILTER (WHERE d.status='OPEN')::int AS "openDeals",
        COALESCE(sum(d.estimated_amount_toman) FILTER (WHERE d.status='OPEN'),0)::text AS "pipelineValueToman",
        count(d.estimated_amount_toman) FILTER (WHERE d.status='OPEN')::int AS "valuedOpenDeals"
      FROM crm_deals d LEFT JOIN crm_leads l ON l.id=d.originating_lead_id CROSS JOIN bounds b
      WHERE d.archived_at IS NULL AND ${ownerPredicate("d.owner_id", "$6")} AND ($7::text IS NULL OR l.source=$7)
        AND ($8::text IS NULL OR d.pipeline_key=$8) AND ($9::uuid IS NULL OR d.expected_plan_id=$9)
    `, [ranges.current.start, ranges.current.endExclusive, ranges.previous.start, ranges.previous.endExclusive, CRM_TIMEZONE,
      query.ownerId ?? null, query.source ?? null, query.pipelineKey ?? null, query.expectedPlanId ?? null]);
    const row = rows[0] ?? {};
    return { won: count(row.won), previousWon: count(row.previousWon), lost: count(row.lost), previousLost: count(row.previousLost),
      averageWinSalesCycleDays: row.averageWinSalesCycleDays == null ? null : Number(row.averageWinSalesCycleDays), openDeals: count(row.openDeals),
      pipelineValueToman: String(row.pipelineValueToman ?? "0"), valuedOpenDeals: count(row.valuedOpenDeals) };
  }

  private async workSummary(ranges: ReturnType<typeof analyticsRanges>, query: CrmAnalyticsQueryDto) {
    const rows = await this.dataSource.query<Row[]>(`
      WITH bounds AS (
        SELECT $1::date::timestamp AT TIME ZONE $5 AS current_start,$2::date::timestamp AT TIME ZONE $5 AS current_end,
               $3::date::timestamp AT TIME ZONE $5 AS previous_start,$4::date::timestamp AT TIME ZONE $5 AS previous_end
      ), completion_events AS (
        SELECT e.target_id AS task_id,e.created_at,t.kind,t.due_at,t.assigned_to_user_id,t.status,t.archived_at,
          row_number() OVER (PARTITION BY e.target_id ORDER BY e.created_at,e.id) AS ordinal
        FROM platform_audit_events e JOIN crm_tasks t ON t.id::text=e.target_id
        WHERE e.target_type='crm_task' AND e.action='crm.task.completed' AND t.archived_at IS NULL
          AND ${ownerPredicate("t.assigned_to_user_id", "$6")}
      ), metrics AS (
        SELECT (SELECT count(*) FROM crm_activities a CROSS JOIN bounds b WHERE a.archived_at IS NULL AND ${ownerPredicate("a.actor_user_id", "$6")} AND a.occurred_at>=b.current_start AND a.occurred_at<b.current_end)::int AS activities,
          (SELECT count(*) FROM crm_activities a CROSS JOIN bounds b WHERE a.archived_at IS NULL AND ${ownerPredicate("a.actor_user_id", "$6")} AND a.occurred_at>=b.previous_start AND a.occurred_at<b.previous_end)::int AS "previousActivities",
          (SELECT count(*) FROM completion_events c CROSS JOIN bounds b WHERE c.created_at>=b.current_start AND c.created_at<b.current_end)::int AS "completedTasks",
          (SELECT count(*) FROM completion_events c CROSS JOIN bounds b WHERE c.created_at>=b.previous_start AND c.created_at<b.previous_end)::int AS "previousCompletedTasks",
          (SELECT count(*) FROM crm_tasks t WHERE t.archived_at IS NULL AND t.status='OPEN' AND ${ownerPredicate("t.assigned_to_user_id", "$6")})::int AS "openTasks",
          (SELECT count(*) FROM crm_tasks t WHERE t.archived_at IS NULL AND t.status='OPEN' AND t.due_at IS NOT NULL AND t.due_at<now() AND ${ownerPredicate("t.assigned_to_user_id", "$6")})::int AS "overdueTasks",
          (SELECT count(*) FROM crm_tasks t WHERE t.archived_at IS NULL AND t.status='OPEN' AND t.kind='FOLLOW_UP' AND ${ownerPredicate("t.assigned_to_user_id", "$6")})::int AS "openFollowUps",
          (SELECT count(*) FROM crm_tasks t WHERE t.archived_at IS NULL AND t.status='OPEN' AND t.kind='FOLLOW_UP' AND t.due_at IS NOT NULL AND t.due_at<now() AND ${ownerPredicate("t.assigned_to_user_id", "$6")})::int AS "overdueFollowUps",
          (SELECT count(*) FROM crm_tasks t WHERE t.archived_at IS NULL AND t.status='OPEN' AND t.due_at IS NOT NULL AND ${ownerPredicate("t.assigned_to_user_id", "$6")})::int AS "openTasksWithDueDate",
          (SELECT count(*) FROM crm_tasks t CROSS JOIN bounds b WHERE t.archived_at IS NULL AND t.status<>'CANCELED' AND t.due_at>=b.current_start AND t.due_at<b.current_end AND ${ownerPredicate("t.assigned_to_user_id", "$6")})::int AS "dueTasks",
          (SELECT count(*) FROM completion_events c CROSS JOIN bounds b WHERE c.ordinal=1 AND c.due_at>=b.current_start AND c.due_at<b.current_end AND c.status<>'CANCELED')::int AS "completedDueTasks",
          (SELECT count(*) FROM crm_tasks t CROSS JOIN bounds b WHERE t.archived_at IS NULL AND t.status<>'CANCELED' AND t.kind='FOLLOW_UP' AND t.due_at>=b.current_start AND t.due_at<b.current_end AND ${ownerPredicate("t.assigned_to_user_id", "$6")})::int AS "dueFollowUps",
          (SELECT count(*) FROM completion_events c CROSS JOIN bounds b WHERE c.ordinal=1 AND c.kind='FOLLOW_UP' AND c.due_at>=b.current_start AND c.due_at<b.current_end AND c.status<>'CANCELED')::int AS "completedDueFollowUps"
      ) SELECT * FROM metrics
    `, [ranges.current.start, ranges.current.endExclusive, ranges.previous.start, ranges.previous.endExclusive, CRM_TIMEZONE, query.ownerId ?? null]);
    const row = rows[0] ?? {};
    return { activities: count(row.activities), previousActivities: count(row.previousActivities), completedTasks: count(row.completedTasks), previousCompletedTasks: count(row.previousCompletedTasks),
      openTasks: count(row.openTasks), overdueTasks: count(row.overdueTasks), openTasksWithDueDate: count(row.openTasksWithDueDate), dueTasks: count(row.dueTasks),
      openFollowUps: count(row.openFollowUps), overdueFollowUps: count(row.overdueFollowUps), completedDueTasks: count(row.completedDueTasks), dueFollowUps: count(row.dueFollowUps), completedDueFollowUps: count(row.completedDueFollowUps) };
  }

  private stalledFilter(filters: unknown[], dealWhere: string) {
    return `WITH selected_deals AS (
      SELECT d.id,d.title,d.stage,d.owner_id,d.created_at,d.status,d.organization_id,d.originating_lead_id FROM crm_deals d LEFT JOIN crm_leads l ON l.id=d.originating_lead_id
      WHERE ${dealWhere} AND d.status='OPEN'
    ), stale AS (
      SELECT d.id,d.title,d.stage,d.owner_id,d.created_at,h.created_at AS "stageEnteredAt",a.last_activity_at AS "lastActivityAt"
      FROM selected_deals d
      JOIN LATERAL (SELECT created_at FROM crm_deal_stage_history WHERE deal_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1) h ON TRUE
      LEFT JOIN LATERAL (
        SELECT max(a.occurred_at) AS last_activity_at
        FROM crm_activities a LEFT JOIN crm_contacts c ON c.id=a.contact_id
        WHERE a.archived_at IS NULL AND (a.deal_id=d.id OR a.organization_id=d.organization_id
          OR a.lead_id=d.originating_lead_id OR c.organization_id=d.organization_id)
      ) a ON TRUE
      WHERE h.created_at<=now()-($${filters.length + 1}::int * interval '1 day')
        AND (a.last_activity_at IS NULL OR a.last_activity_at<=now()-($${filters.length + 1}::int * interval '1 day'))
    )`;
  }

  private async stalledDealsCount(filters: unknown[], dealWhere: string) {
    const values = [...filters, stalledDays];
    const rows = await this.dataSource.query<Row[]>(`${this.stalledFilter(filters, dealWhere)} SELECT count(*)::int AS total FROM stale`, values);
    return rows;
  }

  private async stalledDealsList(filters: unknown[], dealWhere: string) {
    const values = [...filters, stalledDays];
    return this.dataSource.query<Row[]>(`${this.stalledFilter(filters, dealWhere)}
      SELECT s.id,s.title,s.stage,s.created_at AS "createdAt",s."stageEnteredAt",s."lastActivityAt",
        round(extract(epoch FROM (now()-s."stageEnteredAt"))/86400.0)::int AS "daysInStage",
        ${maskedUser("u")} AS "ownerLabel"
      FROM stale s LEFT JOIN users u ON u.id=s.owner_id ORDER BY s."stageEnteredAt",s.id LIMIT 20
    `, values);
  }

  private async activitySeries(range: { start: string; endExclusive: string }, query: CrmAnalyticsQueryDto) {
    const parts = analyticsSeriesParts(analyticsGranularity(range), "a.occurred_at", "$4");
    return this.dataSource.query<Row[]>(`
      WITH bounds AS (
        SELECT $1::date AS local_start,$2::date AS local_end,$1::date::timestamp AT TIME ZONE $4 AS current_start,
          $2::date::timestamp AT TIME ZONE $4 AS current_end
      ), slots AS (${parts.slots}), buckets AS (
        SELECT ${parts.bucket} AS bucket,count(*)::int AS value FROM crm_activities a CROSS JOIN bounds b
        WHERE a.archived_at IS NULL AND a.occurred_at>=b.current_start AND a.occurred_at<b.current_end AND ${ownerPredicate("a.actor_user_id", "$3")}
        GROUP BY 1
      ) SELECT ${parts.textBucket} AS bucket,COALESCE(buckets.value,0)::int AS value FROM slots s LEFT JOIN buckets ON buckets.bucket=s.bucket ORDER BY s.bucket
    `, [range.start, range.endExclusive, query.ownerId ?? null, CRM_TIMEZONE]);
  }
}
