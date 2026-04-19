import type { Article } from '@/lib/types/article';
import FeedbackButtons from './FeedbackButtons';

interface Props {
  article: Article;
  onClick?: () => void;
}

const EXPLORATION_LABELS: Record<NonNullable<Article['explorationSlotType']>, string> = {
  semantic_stretch: 'Stretch',
  blind_spot_probe: 'Blind spot',
  wildcard:         'Wildcard',
};

export default function ArticleCard({ article, onClick }: Props) {
  const explorationLabel = article.explorationSlotType
    ? EXPLORATION_LABELS[article.explorationSlotType]
    : null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg hover:border-gray-400 hover:shadow-sm transition-all">
      <button
        onClick={onClick}
        className="w-full text-left p-4 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 rounded-lg"
      >
        {article.imageUrl && (
          <img
            src={article.imageUrl}
            alt=""
            className="w-full h-40 object-cover rounded-md mb-3"
          />
        )}
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-2">
          {article.sourceName}
          {explorationLabel && (
            <span className="inline-block px-1.5 py-0.5 text-[10px] font-semibold tracking-wide rounded bg-violet-100 text-violet-700 normal-case">
              {explorationLabel}
            </span>
          )}
        </p>
        <h2 className="text-base font-semibold text-gray-900 leading-snug">
          {article.title}
        </h2>
        {article.description && (
          <p className="mt-1 text-sm text-gray-600 line-clamp-2">{article.description}</p>
        )}
      </button>
      <div className="px-4 pb-3 flex justify-end">
        <FeedbackButtons articleId={article.id} />
      </div>
    </div>
  );
}
