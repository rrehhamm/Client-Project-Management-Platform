// FR-SRCH-01: header search. From 2 characters it lists the top results grouped by
// type; Enter opens the full results page.
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSearch } from '@/api/comms';
import { Input } from '@/components/ui/input';
import { t } from '@/i18n';

const SEARCH_GROUPS = ['projects', 'tasks', 'files', 'clients', 'contacts'];

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function SearchResults({ data, onPick }) {
  const groups = SEARCH_GROUPS.filter((g) => data.groups[g]?.length);
  if (!groups.length) return <p className="p-3 text-sm text-muted-foreground">{t('search.none', { q: data.q })}</p>;
  return (
    <div className="divide-y">
      {groups.map((g) => (
        <section key={g} aria-label={t(`search.groups.${g}`)} className="py-1">
          <h3 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`search.groups.${g}`)}</h3>
          <ul>
            {data.groups[g].map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => onPick(r)} className="flex w-full cursor-pointer items-baseline gap-2 px-3 py-1.5 text-start text-sm hover:bg-accent focus:bg-accent focus:outline-none">
                  <span className="truncate">{r.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.subtitle}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function SearchBox() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDebounced(q.trim());
  const results = useSearch(term);
  const navigate = useNavigate();
  const box = useRef(null);

  useEffect(() => {
    const close = (e) => !box.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (r) => {
    setOpen(false);
    setQ('');
    navigate(r.link);
  };

  return (
    <form
      ref={box}
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim().length >= 2) {
          setOpen(false);
          navigate(`/search?q=${encodeURIComponent(q.trim())}`);
        }
      }}
    >
      <Search aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className="h-9 w-full bg-background ps-8 shadow-none"
      />
      {open && q.trim().length > 0 ? (
        <div className="absolute start-0 z-40 mt-1 max-h-96 w-full min-w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border bg-card shadow-overlay" aria-live="polite">
          {q.trim().length < 2 ? (
            <p className="p-3 text-sm text-muted-foreground">{t('search.min')}</p>
          ) : results.isPending ? (
            <p className="p-3 text-sm text-muted-foreground">{t('states.loading')}</p>
          ) : results.error ? (
            <p className="p-3 text-sm text-destructive">{results.error.message}</p>
          ) : (
            <SearchResults data={results.data} onPick={pick} />
          )}
        </div>
      ) : null}
    </form>
  );
}
