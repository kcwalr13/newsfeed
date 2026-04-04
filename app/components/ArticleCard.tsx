import type { Article } from '@/lib/types/article';
import FeedbackButtons from './FeedbackButtons';

interface Props {
  article: Article;
  onClick?: () => void;
}

export default function ArticleCard({ article, onClick }: Props) {
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
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
          {article.sourceName}
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
