import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  ClipboardList,
  FileText,
  KanbanSquare,
  Search,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { NAV_ITEMS } from './nav';

export interface SearchResult {
  kind: 'organization' | 'contact' | 'opportunity' | 'quote' | 'booking';
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
}

const KIND_META: Record<SearchResult['kind'], { label: string; icon: LucideIcon }> = {
  organization: { label: 'Organizations', icon: Building2 },
  contact: { label: 'Contacts', icon: User },
  opportunity: { label: 'Opportunities', icon: KanbanSquare },
  quote: { label: 'Quotes', icon: FileText },
  booking: { label: 'Bookings', icon: ClipboardList },
};

export function matchesNav(query: string, title: string, keywords: string[] = []) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [title, ...keywords].some((s) => s.toLowerCase().includes(q));
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const debounced = useDebouncedValue(query.trim(), 200);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) =>
      api.get<SearchResult[]>(`/api/search?q=${encodeURIComponent(debounced)}`, { signal }),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const navItems = NAV_ITEMS.filter(
    (i) => (!i.adminOnly || isAdmin) && matchesNav(query, i.title, i.keywords),
  );
  const grouped = useMemo(() => {
    const map = new Map<SearchResult['kind'], SearchResult[]>();
    for (const r of search.data ?? []) map.set(r.kind, [...(map.get(r.kind) ?? []), r]);
    return [...map.entries()];
  }, [search.data]);

  const go = (url: string) => {
    setOpen(false);
    setQuery('');
    void navigate(url);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-muted-foreground w-9 justify-start gap-2 px-2 sm:w-56"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <Search />
        <span className="hidden flex-1 text-left sm:inline">Search…</span>
        <KbdGroup className="hidden sm:inline-flex">
          <Kbd className="text-foreground">{isMac ? '⌘' : 'Ctrl'}</Kbd>
          <Kbd className="text-foreground">K</Kbd>
        </KbdGroup>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
        title="Command palette"
        description="Go to a section or search records"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Go to a section or search records…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {navItems.length === 0 && grouped.length === 0 && !search.isFetching && (
              <CommandEmpty>No results found.</CommandEmpty>
            )}
            {navItems.length > 0 && (
              <CommandGroup heading="Go to">
                {navItems.map((item) => (
                  <CommandItem
                    key={item.url}
                    value={`nav:${item.url}`}
                    onSelect={() => go(item.url)}
                  >
                    <item.icon />
                    {item.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {search.isFetching && grouped.length === 0 && (
              <div className="text-muted-foreground flex items-center gap-2 px-3 py-2 text-sm">
                <Spinner /> Searching…
              </div>
            )}
            {grouped.map(([kind, results]) => {
              const meta = KIND_META[kind];
              return (
                <CommandGroup key={kind} heading={meta.label}>
                  {results.map((r) => (
                    <CommandItem key={r.id} value={`${kind}:${r.id}`} onSelect={() => go(r.url)}>
                      <meta.icon />
                      <span className="truncate">{r.title}</span>
                      {r.subtitle && (
                        <span className="text-muted-foreground ml-auto truncate text-xs">
                          {r.subtitle}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
