import { Phone, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { formatTime, useBooking } from '@/lib/bookings';
import { formatDate } from '@/lib/crm';
import { NotFoundPage } from '@/pages/not-found';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="grid gap-1 border-b py-3 sm:grid-cols-[10rem_1fr] print:grid-cols-[10rem_1fr] print:py-1.5">
      <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

/** A one-page brief for the DJs on the night: readable on a phone and printable. */
export function EventSheetPage() {
  const { id = '' } = useParams();
  const booking = useBooking(id);
  if (booking.error instanceof ApiError && booking.error.status === 404) return <NotFoundPage />;
  if (!booking.data) return <Skeleton className="h-96" />;
  const b = booking.data;
  const contact = b.contact;
  return (
    <article className="mx-auto grid max-w-3xl gap-4" aria-labelledby="sheet-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-muted-foreground text-sm">Event sheet · {b.numberLabel}</p>
          <h1 id="sheet-title" className="text-2xl font-semibold">
            {b.title}
          </h1>
          <p className="text-lg">{formatDate(b.startDate)}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" asChild>
            <Link to={`/bookings/${b.id}?tab=staffing`}>Edit details</Link>
          </Button>
          <Button onClick={() => window.print()}>
            <Printer /> Print
          </Button>
        </div>
      </div>
      <dl>
        <Row label="Venue">{b.organization?.name ?? b.location}</Row>
        <Row label="Address">{b.organization ? b.location : null}</Row>
        <Row label="Venue contact">{b.venueContact}</Row>
        <Row label="Customer">
          {contact && (
            <span className="flex flex-wrap items-center gap-x-3">
              {contact.name}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  className="inline-flex items-center gap-1 underline"
                >
                  <Phone className="size-4" aria-hidden /> {contact.phone}
                </a>
              )}
            </span>
          )}
        </Row>
        <Row label="Load-in">{formatTime(b.loadInTime)}</Row>
        <Row label="Start">{formatTime(b.startTime)}</Row>
        <Row label="End">{formatTime(b.endTime)}</Row>
        <Row label="DJs">
          {b.staff.length > 0 ? (
            <ul aria-label="DJs">
              {b.staff.map((s) => (
                <li key={s.id}>
                  {s.name}
                  {s.phone && (
                    <>
                      {' · '}
                      <a href={`tel:${s.phone}`} className="underline">
                        {s.phone}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            'None assigned yet'
          )}
        </Row>
        <Row label="Channels">{b.channels ? String(b.channels) : null}</Row>
        <Row label="Attendance">{b.expectedAttendance?.toLocaleString()}</Row>
        <Row label="Equipment">
          {b.requirements.length > 0 ? (
            <ul aria-label="Equipment">
              {b.requirements.map((r) => (
                <li key={r.equipmentTypeId}>
                  {r.quantity} × {r.name}
                </li>
              ))}
            </ul>
          ) : null}
        </Row>
        <Row label="Run of show">{b.runOfShow}</Row>
      </dl>
    </article>
  );
}
