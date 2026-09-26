import assert from "node:assert/strict";
import test from "node:test";
import { canQualifyLead, canTransitionLead, canUnqualifyLead } from "./crm-lead-lifecycle.util";
import { CrmLeadStatus as S } from "./entities/crm-lead.entity";

test("lead lifecycle allows documented transitions and keeps terminal states closed", () => {
  assert.equal(canTransitionLead(S.New, S.AttemptingContact), true);
  assert.equal(canTransitionLead(S.AttemptingContact, S.Contacted), true);
  assert.equal(canQualifyLead(S.Contacted), true);
  assert.equal(canQualifyLead(S.New), false);
  assert.equal(canUnqualifyLead(S.Qualified), true);
  assert.equal(canTransitionLead(S.Converted, S.New), false);
  assert.equal(canTransitionLead(S.Unqualified, S.Contacted), false);
});
