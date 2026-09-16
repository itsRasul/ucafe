import { PanelOrderDetail } from "../../panel-client";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) { return <PanelOrderDetail id={(await params).id} />; }
