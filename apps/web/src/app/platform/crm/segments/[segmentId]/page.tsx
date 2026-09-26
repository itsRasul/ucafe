import { CrmSegmentDetailPage } from "../../metadata-pages";

export default async function CrmSegmentPage({ params }: { params: Promise<{ segmentId: string }> }) {
  const { segmentId } = await params;
  return <CrmSegmentDetailPage segmentId={segmentId} />;
}
