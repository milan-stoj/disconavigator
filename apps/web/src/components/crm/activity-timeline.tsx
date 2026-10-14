import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ACTIVITY_KINDS, activityNoteSchema, type ActivityKind } from '@disco/shared';
import {
  ArrowRightLeft,
  Archive,
  Inbox,
  ArchiveRestore,
  CalendarClock,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/form-dialog';
import { FormField, applyServerErrors } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  ACTIVITY_KIND_LABELS,
  crmKeys,
  logActivity,
  useActivity,
  type ActivityEntry,
  type ActivitySubject,
} from '@/lib/crm';
import { formatDateTime } from '@/lib/inventory';

const KIND_ICONS: Record<string, LucideIcon> = {
  note: MessageSquare,
  call: Phone,
  email: Mail,
  meeting: CalendarClock,
  created: Sparkles,
  stage_changed: ArrowRightLeft,
  archived: Archive,
  restored: ArchiveRestore,
  quote_request: Inbox,
};

/** A record's activity history with a button to log a note, call, email, or meeting. */
export function ActivityTimeline({ subject, id }: { subject: ActivitySubject; id: string }) {
  const activity = useActivity(subject, id);
  const [logging, setLogging] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Activity</h2>
        </CardTitle>
        <CardAction>
          <Button size="sm" variant="outline" onClick={() => setLogging(true)}>
            <Plus /> Log activity
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {activity.isPending ? (
          <div className="grid gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : !activity.data?.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>Log calls, emails, and notes to keep the history.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ActivityList entries={activity.data} />
        )}
      </CardContent>
      {logging && <LogActivityDialog subject={subject} id={id} onClose={() => setLogging(false)} />}
    </Card>
  );
}

/** A list of activity entries, newest first. */
export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  return (
    <ol className="grid gap-4" aria-label="Activity timeline">
      {entries.map((entry) => {
        const Icon = KIND_ICONS[entry.kind] ?? MessageSquare;
        return (
          <li key={entry.id} className="flex gap-3">
            <span className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
              <Icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                <span className="text-foreground font-medium">
                  {ACTIVITY_KIND_LABELS[entry.kind] ?? entry.kind}
                </span>
                <time dateTime={entry.createdAt}>{formatDateTime(entry.createdAt)}</time>
                {entry.authorName && <span>by {entry.authorName}</span>}
              </div>
              {entry.body && (
                <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">{entry.body}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

type LogValues = z.input<typeof activityNoteSchema>;

export function LogActivityDialog({
  subject,
  id,
  onClose,
}: {
  subject: ActivitySubject;
  id: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const form = useForm<LogValues>({
    resolver: zodResolver(activityNoteSchema),
    defaultValues: { kind: 'note', body: '' },
  });
  const save = useMutation({
    mutationFn: (v: LogValues) =>
      logActivity(subject, id, v as { kind: ActivityKind; body: string }),
    onSuccess: (entry) => {
      // Notes also show on linked organization and opportunity timelines.
      void qc.invalidateQueries({ queryKey: ['activity'] });
      void qc.invalidateQueries({ queryKey: crmKeys.organizations });
      toast.success(`${ACTIVITY_KIND_LABELS[entry.kind]} logged`);
      onClose();
    },
    onError: (err) => applyServerErrors(form.setError, err),
  });
  return (
    <FormDialog
      title="Log activity"
      description="Record a call, email, meeting, or note."
      onClose={onClose}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel="Save"
    >
      <FormField
        control={form.control}
        name="kind"
        label="Type"
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id={field.id} aria-invalid={field['aria-invalid']} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {ACTIVITY_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FormField
        control={form.control}
        name="body"
        label="What happened?"
        render={({ field }) => <Textarea {...field} rows={4} autoFocus />}
      />
    </FormDialog>
  );
}
