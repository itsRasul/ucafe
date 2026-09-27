"use client";

import { useParams } from "next/navigation";
import { CrmWorkflowExecutionPage } from "../../../workflow-page";

export default function WorkflowExecutionRoute() {
  const { executionId } = useParams<{ executionId: string }>();
  return <CrmWorkflowExecutionPage executionId={executionId} />;
}
