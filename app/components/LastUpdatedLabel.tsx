'use client';

interface Props {
  /** ISO-8601 UTC timestamp. If undefined/empty, renders nothing. */
  generatedAt?: string;
}

export default function LastUpdatedLabel({ generatedAt }: Props) {
  if (!generatedAt) return null;

  const date = new Date(generatedAt);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const timeStr = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);

  const label = isToday
    ? `Last updated today at ${timeStr}`
    : `Last updated ${new Intl.DateTimeFormat(undefined, {
        month: 'long',
        day: 'numeric',
      }).format(date)} at ${timeStr}`;

  return (
    <p className="text-xs text-gray-400" aria-live="polite">
      {label}
    </p>
  );
}
