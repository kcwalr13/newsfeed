interface Props {
  batchDate: string;
}

export default function BatchLabel({ batchDate }: Props) {
  if (!batchDate) return null;

  const today = new Date().toISOString().slice(0, 10);

  if (batchDate === today) {
    return (
      <p className="text-sm font-medium text-gray-500 mb-4">Today's Digest</p>
    );
  }

  const formatted = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(batchDate + 'T00:00:00Z'));

  return (
    <p className="text-sm font-medium text-gray-500 mb-4">
      Latest Digest — {formatted}
    </p>
  );
}
