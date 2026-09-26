import { CrmWorkspace } from "../../workspace";

export default async function CrmContactPage({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  return <CrmWorkspace mode="contact" contactId={contactId} />;
}
