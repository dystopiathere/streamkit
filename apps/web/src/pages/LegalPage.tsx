import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Markdown, { type Components } from 'react-markdown';
import { Link, useParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { MainContent, NewTabHint, SkipLink, usePageTitle } from '@streamkit/app-kit';
import { PublicFooter } from '@/features/public/PublicFooter';
import { escapeMarkdown, fillDocumentDetails, useSeller } from '@/features/public/seller';

/** Соответствие адреса страницы файлу документа в public/legal. */
const DOCUMENT_FILES: Record<string, string> = {
  terms: 'terms.md',
  privacy: 'privacy.md',
  'personal-data': 'personal-data.md',
  cookies: 'cookies.md',
  'room-guest': 'room-guest.md',
  subscription: 'subscription.md',
};

/** Адреса сервиса в тексте документов — переходы внутри приложения. */
const OWN_HOSTS = new Set(['stream-kit.ru', 'www.stream-kit.ru']);

/**
 * Публичные юридические документы.
 *
 * Тексты лежат статикой в `public/legal`: документ открывается по прямой ссылке
 * без входа и без похода в базу, в том числе файлом `.md` для проверяющего.
 *
 * На странице Markdown превращается в разметку. Раньше текст выводился как
 * есть, и решётки, звёздочки и таблицы из вертикальных черт мешали читать
 * документ, ради которого человек пришёл. Сырой HTML в документах не
 * разрешён (`react-markdown` его не исполняет), а опасные схемы ссылок
 * вычищаются им же — текст остаётся дословным, меняется только оформление.
 */
export function LegalPage(): React.JSX.Element {
  const { t } = useTranslation();
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

  usePageTitle(document.data?.match(/^# (.+)$/m)?.[1] ?? (file ? undefined : t('legal.notFound')));

  return (
    <div className="flex min-h-screen flex-col">
      <SkipLink />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-2">
          <Link to="/" className="py-2 text-sm text-muted hover:text-fg">
            <span aria-hidden="true">← </span>
            {t('legal.back')}
          </Link>
        </div>
      </header>

      <MainContent className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {!file ? <h1 className="text-2xl font-semibold">{t('legal.notFound')}</h1> : null}
        {document.isLoading ? (
          <p role="status" className="text-muted">
            {t('common.loading')}
          </p>
        ) : null}
        {document.isError ? (
          <p role="alert" className="text-danger">
            {t('legal.unavailable')}
          </p>
        ) : null}

        {document.data ? (
          <article className="text-[0.9375rem] leading-relaxed">
            <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
              {fillDocumentDetails(document.data, seller.data, escapeMarkdown)}
            </Markdown>
          </article>
        ) : null}
      </MainContent>
      <PublicFooter />
    </div>
  );
}

function DocumentLink({ href = '', children }: { href?: string; children?: React.ReactNode }) {
  const url = safeUrl(href);
  if (url && OWN_HOSTS.has(url.hostname)) {
    return (
      <Link to={`${url.pathname}${url.hash}`} className="underline hover:text-fg">
        {children}
      </Link>
    );
  }
  if (url?.protocol === 'mailto:' || url?.protocol === 'tel:') {
    return (
      <a href={href} className="underline hover:text-fg">
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-fg">
      {children}
      <NewTabHint />
    </a>
  );
}

function ScrollableTable({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    // Прокручиваемая область должна быть достижима с клавиатуры: иначе правый
    // край таблицы на телефоне не прочитать без мыши и пальца.
    <div
      className="my-4 overflow-x-auto rounded-lg border border-border"
      tabIndex={0}
      role="region"
      aria-label={t('legal.table')}
    >
      <table className="w-full min-w-[32rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

function safeUrl(href: string): URL | null {
  try {
    return new URL(href, window.location.origin);
  } catch {
    return null;
  }
}

const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 text-2xl font-semibold text-balance sm:text-3xl">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-10 mb-3 text-lg font-semibold text-balance sm:text-xl">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mt-6 mb-2 font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-3">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-6">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  a: ({ href, children }) => <DocumentLink href={href}>{children}</DocumentLink>,
  code: ({ children }) => (
    <code className="rounded bg-surface-hover px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
  ),
  table: ({ children }) => <ScrollableTable>{children}</ScrollableTable>,
  thead: ({ children }) => <thead className="bg-surface text-left">{children}</thead>,
  th: ({ children }) => (
    <th scope="col" className="border-b border-border px-3 py-2 align-bottom font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-t border-border px-3 py-2 align-top">{children}</td>,
  hr: () => <hr className="my-8 border-border" />,
};
