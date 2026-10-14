import { Link } from 'react-router';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import type { DuplicateMatch } from '@/lib/crm';

/** Returns the possible duplicates from a 409 duplicate response, or null for other errors. */
export function duplicatesFrom(err: unknown): DuplicateMatch[] | null {
  if (err instanceof ApiError && err.code === 'duplicate') {
    return (err.details?.duplicates as DuplicateMatch[] | undefined) ?? [];
  }
  return null;
}

/** Warns that a record may already exist; the user can open the match or create anyway. */
export function DuplicateWarningDialog({
  what,
  basePath,
  matches,
  pending,
  onCancel,
  onContinue,
}: {
  what: string;
  basePath: string;
  matches: DuplicateMatch[];
  pending: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This {what} may already exist</AlertDialogTitle>
          <AlertDialogDescription>
            Open the existing record, or continue to create a new one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid gap-2" aria-label="Possible duplicates">
          {matches.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <span className="truncate">{m.name}</span>
                  {m.archived && <Badge variant="secondary">Archived</Badge>}
                </div>
                <div className="text-muted-foreground text-xs">
                  {m.detail && <span>{m.detail} · </span>}
                  Same {m.matchedOn.join(' and ')}
                </div>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to={`${basePath}/${m.id}`}>Open {m.name}</Link>
              </Button>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onContinue();
            }}
          >
            Create anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
