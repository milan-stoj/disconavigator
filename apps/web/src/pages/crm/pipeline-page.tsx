import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  formatCents,
  OPPORTUNITY_STAGES,
  STAGE_LABELS,
  type OpportunityStage,
} from '@disco/shared';
import { AlertTriangle, CalendarDays, GripVertical, MoreHorizontal, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { LossReasonDialog } from '@/components/crm/loss-reason-dialog';
import { OpportunityFormDialog } from '@/components/crm/opportunity-form';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, useChangeStage, useOpportunities, type Opportunity } from '@/lib/crm';
import { cn } from '@/lib/utils';

/** Won and Lost columns only show opportunities closed this recently. */
const CLOSED_WINDOW_DAYS = 30;

const stageOf = (id: string | number | undefined) =>
  OPPORTUNITY_STAGES.find((s) => s === id) as OpportunityStage | undefined;

/** Pointer drags use what is under the pointer; keyboard drags use overlap with a column. */
const collisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const hits = pointerWithin(args);
    if (hits.length) return hits;
  }
  return rectIntersection(args);
};

/** Left/right arrows jump a dragged card to the neighbouring column. */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context: { collisionRect, droppableRects, droppableContainers } },
) => {
  const direction = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  if (!direction || !collisionRect) return undefined;
  event.preventDefault();
  const columns = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.left - b.left);
  const center = collisionRect.left + collisionRect.width / 2;
  const current = columns.findIndex((r) => center >= r.left && center <= r.left + r.width);
  const target =
    current === -1
      ? direction > 0
        ? columns.find((r) => r.left > center)
        : [...columns].reverse().find((r) => r.left + r.width < center)
      : columns[current + direction];
  if (!target) return undefined;
  return {
    x: target.left + (target.width - collisionRect.width) / 2,
    y: target.top + 48,
  };
};

export function PipelinePage() {
  const navigate = useNavigate();
  const [closedSince] = useState(() =>
    new Date(Date.now() - CLOSED_WINDOW_DAYS * 86_400_000).toISOString(),
  );
  const opportunities = useOpportunities({ closedSince });
  const changeStage = useChangeStage();
  const [creating, setCreating] = useState(false);
  const [losing, setLosing] = useState<Opportunity | null>(null);
  const [dragging, setDragging] = useState<Opportunity | null>(null);

  const byStage = useMemo(() => {
    const groups = Object.fromEntries(
      OPPORTUNITY_STAGES.map((s) => [s, [] as Opportunity[]]),
    ) as Record<OpportunityStage, Opportunity[]>;
    for (const o of opportunities.data ?? []) groups[o.stage].push(o);
    return groups;
  }, [opportunities.data]);
  const find = (id: string | number) => opportunities.data?.find((o) => o.id === id);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnKeyboardCoordinates }),
  );

  const move = (o: Opportunity, stage: OpportunityStage) => {
    if (o.stage === stage) return;
    if (stage === 'lost') setLosing(o);
    else changeStage.mutate({ id: o.id, change: { stage } });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const o = find(active.id);
    const stage = stageOf(over?.id);
    if (o && stage) move(o, stage);
  };

  const title = (id: string | number) => find(id)?.title ?? 'Opportunity';
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${title(active.id)}. Use left and right arrows to choose a stage, space to drop, escape to cancel.`,
    onDragOver: ({ active, over }) => {
      const stage = stageOf(over?.id);
      return stage ? `${title(active.id)} is over ${STAGE_LABELS[stage]}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const stage = stageOf(over?.id);
      return stage
        ? `${title(active.id)} dropped in ${STAGE_LABELS[stage]}.`
        : `${title(active.id)} was not moved.`;
    },
    onDragCancel: ({ active }) => `Moving ${title(active.id)} was cancelled.`,
  };

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={`Leads from first contact to booked. Won and Lost show the last ${CLOSED_WINDOW_DAYS} days.`}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New opportunity
          </Button>
        }
      />
      {opportunities.isPending ? (
        <div className="flex gap-3 overflow-hidden">
          {OPPORTUNITY_STAGES.map((s) => (
            <Skeleton key={s} className="h-64 w-72 shrink-0" />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'To move this opportunity, press space. Use left and right arrows to choose a stage, then press space to drop or escape to cancel.',
            },
          }}
          onDragStart={({ active }) => setDragging(find(active.id) ?? null)}
          onDragCancel={() => setDragging(null)}
          onDragEnd={onDragEnd}
        >
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
            {OPPORTUNITY_STAGES.map((stage) => (
              <StageColumn key={stage} stage={stage} items={byStage[stage]}>
                {byStage[stage].map((o) => (
                  <OpportunityCard
                    key={o.id}
                    opportunity={o}
                    onMove={(s) => move(o, s)}
                    onOpen={() => navigate(`/pipeline/${o.id}`)}
                  />
                ))}
              </StageColumn>
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {dragging && <CardBody opportunity={dragging} className="shadow-lg" />}
          </DragOverlay>
        </DndContext>
      )}
      {creating && <OpportunityFormDialog opportunity={null} onClose={() => setCreating(false)} />}
      {losing && (
        <LossReasonDialog
          title={losing.title}
          pending={changeStage.isPending}
          onClose={() => setLosing(null)}
          onConfirm={(change) =>
            changeStage.mutate({ id: losing.id, change }, { onSuccess: () => setLosing(null) })
          }
        />
      )}
    </>
  );
}

function StageColumn({
  stage,
  items,
  children,
}: {
  stage: OpportunityStage;
  items: Opportunity[];
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = items.reduce((sum, o) => sum + (o.estimatedValueCents ?? 0), 0);
  const headingId = `stage-${stage}`;
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        'bg-muted/40 flex w-72 shrink-0 snap-start flex-col gap-2 rounded-lg border p-2 transition-colors',
        isOver && 'border-primary bg-primary/5',
      )}
    >
      <header className="flex items-baseline justify-between gap-2 px-1 pt-1">
        <h2 id={headingId} className="text-sm font-semibold">
          {STAGE_LABELS[stage]}{' '}
          <span className="text-muted-foreground font-normal">{items.length}</span>
        </h2>
        {total > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">{formatCents(total)}</span>
        )}
      </header>
      <ul className="flex min-h-24 flex-col gap-2" aria-labelledby={headingId}>
        {children}
      </ul>
    </section>
  );
}

function CardBody({
  opportunity: o,
  className,
  handle,
  menu,
}: {
  opportunity: Opportunity;
  className?: string;
  handle?: React.ReactNode;
  menu?: React.ReactNode;
}) {
  return (
    <div className={cn('bg-card flex gap-1 rounded-md border p-2 text-sm', className)}>
      {handle}
      <div className="min-w-0 flex-1 py-1">
        <Link
          to={`/pipeline/${o.id}`}
          className="line-clamp-2 font-medium hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {o.title}
        </Link>
        {(o.organizationName ?? o.contactName) && (
          <div className="text-muted-foreground truncate text-xs">
            {o.organizationName ?? o.contactName}
          </div>
        )}
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {o.eventDate && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3" aria-hidden />
              {formatDate(o.eventDate)}
            </span>
          )}
          {o.estimatedValueCents !== null && (
            <span className="tabular-nums">{formatCents(o.estimatedValueCents)}</span>
          )}
        </div>
        {o.needsLossReason && (
          <Badge variant="outline" className="mt-1 gap-1">
            <AlertTriangle className="size-3" aria-hidden /> Needs loss reason
          </Badge>
        )}
      </div>
      {menu}
    </div>
  );
}

function OpportunityCard({
  opportunity: o,
  onMove,
  onOpen,
}: {
  opportunity: Opportunity;
  onMove: (stage: OpportunityStage) => void;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: o.id,
  });
  // Mouse and touch can drag the whole card; the keyboard only drags from the grip button, so
  // Enter on the title link or the menu button does not start a drag.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  return (
    <li
      ref={setNodeRef}
      {...pointerListeners}
      className={cn('touch-manipulation', isDragging && 'opacity-40')}
    >
      <CardBody
        opportunity={o}
        handle={
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            onKeyDown={onKeyDown as React.KeyboardEventHandler | undefined}
            type="button"
            aria-label={`Move ${o.title}`}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -my-1 cursor-grab rounded-sm px-0.5 outline-none focus-visible:ring-[3px]"
          >
            <GripVertical className="size-4" aria-hidden />
          </button>
        }
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${o.title}`}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              {OPPORTUNITY_STAGES.filter((s) => s !== o.stage).map((s) => (
                <DropdownMenuItem key={s} onSelect={() => onMove(s)}>
                  {STAGE_LABELS[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
    </li>
  );
}
