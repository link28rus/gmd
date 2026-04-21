import HistoryClient from './history-client';

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HistoryClient childId={id} />;
}
