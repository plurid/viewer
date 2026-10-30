import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { ResourceRead } from '../../../domain/contracts';
import type {
  Calendar,
  CalendarEvent,
  CalendarTime,
  ContactBook,
  Contact,
  ContactDate,
  ContactValue,
} from '../../../domain/previews/data/cards';
import type { PreviewContext } from '../contracts';
import type { ParsedText, SourceReader } from '../ParsedDocument';
import { cardLimits, decodeFoldedText, readCards } from '../../../domain/previews/data/cards';
import { ParsedDocument } from '../ParsedDocument';
import { usePreviewScroll } from '../scroll';

type Cards = Calendar | ContactBook;

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/**
 * The bounded text read, unless it holds U+FFFD: a writer that folded inside a UTF-8 character
 * left bytes that decode only once the fold is removed, so the file's bytes are unfolded instead.
 */
const readCardText: SourceReader = async (resource, services, signal) => {
  const read = await services.read(resource.id);
  if (read.binary || read.truncated || !read.text.includes('�')) return read;
  try {
    const response = await fetch(resource.url, { signal });
    if (!response.ok) return read;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 4_000_000) return read;
    return { ...read, text: decodeFoldedText(bytes) };
  } catch {
    return read;
  }
};

function readCardDocument(read: ResourceRead): ParsedText<Cards> {
  const document = readCards(read.text);
  switch (document.kind) {
    case 'variant-calls':
      return {};
    case 'unknown':
      return {
        notice: 'No calendar or contact entries were found, so the file is shown as text.',
      };
    case 'calendar':
    case 'contacts': {
      const limited = document.truncated
        ? `Showing the first ${cardLimits.entries.toLocaleString()} entries.`
        : '';
      const partial = read.truncated ? 'Only the first 4 MB of this file is read.' : '';
      return { document, notice: [partial, limited].filter(Boolean).join(' ') || undefined };
    }
  }
}

const cardsLabel = (cards: Cards) => (cards.kind === 'calendar' ? 'Calendar' : 'Contacts');

function cardsSummary(cards: Cards): string {
  if (cards.kind === 'contacts') return plural(cards.contacts.length, 'contact', 'contacts');
  const events = plural(cards.events.length, 'event', 'events');
  if (!cards.todos.length) return events;
  return `${events} · ${plural(cards.todos.length, 'task', 'tasks')}`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** A calendar time on this computer's clock: its instant, or its wall clock where none is fixed. */
function localDate(time: CalendarTime): Date {
  if (time.instant !== undefined) return new Date(time.instant);
  return new Date(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** The day or days an event takes, and its times. */
function eventWhen(event: CalendarEvent): { date: string; time: string } {
  const { start, end } = event;
  if (!start) return { date: 'No date', time: '' };
  const from = localDate(start);
  if (event.allDay) {
    // an all-day event ends as the day after it starts: its last day is a moment earlier
    const last = end ? new Date(localDate(end).getTime() - 1) : undefined;
    const days = last && last > from && !sameDay(from, last);
    return {
      date: days
        ? `${dateFormat.format(from)} – ${dateFormat.format(last)}`
        : dateFormat.format(from),
      time: 'All day',
    };
  }
  const until = end ? localDate(end) : undefined;
  let range = timeFormat.format(from);
  if (until && sameDay(from, until)) range += ` – ${timeFormat.format(until)}`;
  else if (until) range += ` – ${dateFormat.format(until)}, ${timeFormat.format(until)}`;
  // a zone this computer does not know is shown as written, beside its wall-clock time
  const zone = start.zone && start.instant === undefined ? ` (${start.zone})` : '';
  return { date: dateFormat.format(from), time: range + zone };
}

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="card-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function CalendarView({ calendar }: { calendar: Calendar }) {
  return (
    <>
      {calendar.name && <h2 className="cards-title">{calendar.name}</h2>}
      <section aria-label="Events">
        <h3 className="cards-heading">Events</h3>
        {!calendar.events.length && <p className="muted">This calendar has no events.</p>}
        <ol className="calendar-events">
          {calendar.events.map((event, index) => {
            const when = eventWhen(event);
            const status = event.status?.toUpperCase();
            return (
              <li key={index} className="calendar-event">
                <div className="calendar-when">
                  <span>{when.date}</span>
                  <span className="muted tabular">{when.time}</span>
                </div>
                <div className="calendar-what">
                  <strong className={status === 'CANCELLED' ? 'is-cancelled' : ''}>
                    {event.summary || 'Untitled event'}
                  </strong>
                  <dl className="card-fields">
                    {event.location && <Field label="Location">{event.location}</Field>}
                    {event.organizer && <Field label="Organizer">{event.organizer}</Field>}
                    {event.repeats && <Field label="Repeats">From this date</Field>}
                    {status && status !== 'CONFIRMED' && (
                      <Field label="Status">{titleCase(status)}</Field>
                    )}
                  </dl>
                  {event.description && <p className="calendar-description">{event.description}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      {calendar.todos.length > 0 && (
        <section aria-label="Tasks">
          <h3 className="cards-heading">Tasks</h3>
          <ul className="calendar-tasks">
            {calendar.todos.map((todo, index) => (
              <li key={index}>
                <span className="muted">{todo.completed ? 'Done' : 'Open'}</span>
                <span className={todo.completed ? 'is-done' : ''}>
                  {todo.summary || 'Untitled task'}
                </span>
                {todo.due && (
                  <span className="muted tabular">
                    Due {dateFormat.format(localDate(todo.due))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function birthday(date: ContactDate): string {
  if ('text' in date) return date.text;
  // a leap year, so a birthday on 29 February without its year still formats
  const day = Date.UTC(date.year ?? 2000, date.month - 1, date.day);
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: date.year === undefined ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(day);
}

function ContactValues({ label, values }: { label: string; values: ContactValue[] }) {
  return values.map((item, index) => {
    const kind = item.label ?? item.types.join(', ');
    return (
      <Field key={`${label}-${index}`} label={label}>
        <span className="card-value">{item.value}</span>
        {kind && <span className="muted"> · {kind}</span>}
      </Field>
    );
  });
}

function ContactCard({ contact }: { contact: Contact }) {
  const name =
    contact.name ?? contact.organization ?? contact.emails[0]?.value ?? 'Unnamed contact';
  const role = [contact.title, contact.name ? contact.organization : undefined]
    .filter(Boolean)
    .join(', ');
  return (
    <article className="contact" aria-label={name}>
      {contact.photo && <img className="contact-photo" src={contact.photo} alt="" />}
      <div className="contact-body">
        <h3 className="contact-name">{name}</h3>
        {role && <p className="muted">{role}</p>}
        <dl className="card-fields">
          <ContactValues label="Email" values={contact.emails} />
          <ContactValues label="Phone" values={contact.phones} />
          <ContactValues label="Address" values={contact.addresses} />
          {contact.birthday && <Field label="Birthday">{birthday(contact.birthday)}</Field>}
          {contact.note && <Field label="Note">{contact.note}</Field>}
        </dl>
      </div>
    </article>
  );
}

function CardsView({ context, cards }: { context: PreviewContext; cards: Cards }) {
  const scroll = useRef<HTMLDivElement>(null);
  usePreviewScroll(context.state, scroll, 'cards', { restore: !context.evidence });
  return (
    <div
      className="cards-scroll"
      ref={scroll}
      tabIndex={0}
      aria-label={cards.kind === 'calendar' ? 'Calendar entries' : 'Contacts'}
    >
      <div className="cards">
        {cards.kind === 'calendar' ? (
          <CalendarView calendar={cards} />
        ) : cards.contacts.length ? (
          cards.contacts.map((contact, index) => <ContactCard key={index} contact={contact} />)
        ) : (
          <p className="muted">This file has no complete contacts.</p>
        )}
      </div>
    </div>
  );
}

/** iCalendar events and tasks, or vCard contacts. A genomic VCF file is shown as text. */
export default function CardsPreview(context: PreviewContext) {
  return (
    <ParsedDocument
      context={context}
      label={cardsLabel}
      parse={readCardDocument}
      read={readCardText}
      summary={cardsSummary}
    >
      {(cards) => <CardsView context={context} cards={cards} />}
    </ParsedDocument>
  );
}
