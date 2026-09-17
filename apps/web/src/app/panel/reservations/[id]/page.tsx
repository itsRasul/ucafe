import { PanelReservationDetail } from "../../panel-client";

export default async function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) { return <PanelReservationDetail id={(await params).id} />; }
