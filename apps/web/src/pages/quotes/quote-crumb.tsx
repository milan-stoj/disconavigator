import { useQuote } from '@/lib/quotes';

export function QuoteCrumb({ id }: { id: string }) {
  return <>{useQuote(id).data?.displayNumber ?? 'Quote'}</>;
}
