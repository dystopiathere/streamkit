import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { PublicFooter } from '@/features/public/PublicFooter';
import { fillDocumentDetails, useSeller } from '@/features/public/seller';

/** Соответствие адреса страницы файлу документа в public/legal. */
const DOCUMENT_FILES: Record<string, string> = {
  terms: 'terms.md',
  privacy: 'privacy.md',
  'personal-data': 'personal-data.md',
  cookies: 'cookies.md',
  'room-guest': 'room-guest.md',
  subscription: 'subscription.md',
};

/**
 * Публичные юридические документы.
 *
 * Тексты лежат статикой в `public/legal` и отдаются как есть. Это сознательно:
 * документ должен открываться по прямой ссылке без авторизации, без JS-рендеринга
 * и без похода в базу — в том числе для проверяющего, который просто откроет URL.
 *
 * Markdown выводится моноширинным текстом, без html-рендеринга: превращать
 * юридический текст в HTML на клиенте — лишний код и лишний риск в месте, где
 * важна дословность.
 */
export function LegalPage(): React.JSX.Element {
  const { slug = '' } = useParams();
  const file = DOCUMENT_FILES[slug];
  const seller = useSeller();

  const document = useQuery({
    queryKey: ['legal', slug],
    enabled: Boolean(file),
    queryFn: async () => {
      const response = await fetch(`/legal/${file}`);
      if (!response.ok) throw new Error('Документ недоступен');
      return response.text();
    },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link to="/" className="text-sm text-muted hover:text-fg">
          ← StreamKit
        </Link>

        {!file ? <p className="mt-6">Документ не найден</p> : null}
        {document.isLoading ? <p className="mt-6 text-muted">Загрузка…</p> : null}
        {document.isError ? <p className="mt-6 text-danger">Документ недоступен</p> : null}

        {document.data ? (
          <pre className="mt-6 whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {fillDocumentDetails(document.data, seller.data)}
          </pre>
        ) : null}
      </div>
      <PublicFooter />
    </div>
  );
}
