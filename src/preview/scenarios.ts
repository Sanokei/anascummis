import type { SurfaceWindow } from '@shared/types';

/**
 * Window scenarios for the design preview.
 *
 * These are not fixtures and they are not test data — they exist so a person can
 * watch the restraint ladder work. The product's rule is that the number of
 * things worth showing is never negotiated down: up to twelve surfaces may be
 * open, and as the count climbs the *manner* gets more conservative — lower
 * emphasis, no veil, no focus stealing, no arrival motion — while every distinct
 * thing still gets shown. A preview that only ever opened one window would never
 * demonstrate that, which is the whole reason these go up to twelve.
 */

const MAP =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">
<rect width="320" height="200" fill="#ffffff"/>
<g stroke="#eef2f8" stroke-width="1">
<line x1="0" y1="40" x2="320" y2="40"/><line x1="0" y1="80" x2="320" y2="80"/>
<line x1="0" y1="120" x2="320" y2="120"/><line x1="0" y1="160" x2="320" y2="160"/>
<line x1="80" y1="0" x2="80" y2="200"/><line x1="160" y1="0" x2="160" y2="200"/>
<line x1="240" y1="0" x2="240" y2="200"/></g>
<path d="M56 168 L56 120 L120 120 L120 72 L196 72 L196 96 L264 96" fill="none" stroke="#0b7fa8" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
<circle cx="56" cy="168" r="7" fill="#ffffff" stroke="#0b7fa8" stroke-width="3"/>
<circle cx="264" cy="96" r="7" fill="#0b7fa8"/>
<rect x="196" y="52" width="76" height="30" rx="4" fill="#ffffff" stroke="#d9e1ec"/>
<text x="234" y="71" font-family="monospace" font-size="11" fill="#4a5872" text-anchor="middle">0.9 mi</text>
<text x="56" y="188" font-family="monospace" font-size="11" fill="#63728a" text-anchor="middle">Piccadilly</text>
<text x="264" y="118" font-family="monospace" font-size="11" fill="#63728a" text-anchor="middle">Office</text>
</svg>`.replace(/\n/g, ''),
  );

const CHART =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 140" width="320" height="140">
<rect width="320" height="140" fill="#ffffff"/>
<g stroke="#eef2f8" stroke-width="1">
<line x1="0" y1="35" x2="320" y2="35"/><line x1="0" y1="70" x2="320" y2="70"/>
<line x1="0" y1="105" x2="320" y2="105"/></g>
<path d="M20 112 L68 96 L116 104 L164 62 L212 70 L260 34 L300 40 L300 130 L20 130 Z" fill="#2bc4ef" opacity="0.16"/>
<path d="M20 112 L68 96 L116 104 L164 62 L212 70 L260 34 L300 40" fill="none" stroke="#0b7fa8" stroke-width="2.5" stroke-linejoin="round"/>
<g fill="#0e7fb4">
<circle cx="20" cy="112" r="3.5"/><circle cx="68" cy="96" r="3.5"/><circle cx="116" cy="104" r="3.5"/>
<circle cx="164" cy="62" r="3.5"/><circle cx="212" cy="70" r="3.5"/><circle cx="260" cy="34" r="5"/>
<circle cx="300" cy="40" r="3.5"/></g>
<text x="260" y="24" font-family="monospace" font-size="11" fill="#4a5872" text-anchor="middle">£38</text>
</svg>`.replace(/\n/g, ''),
  );

function block(id: string, kind: SurfaceWindow['tabs'][number]['blocks'][number]['kind'], extra: object) {
  return { id, kind, ...extra } as SurfaceWindow['tabs'][number]['blocks'][number];
}

const windows: SurfaceWindow[] = [
  {
    id: 'w-departures',
    size: { width: 440, height: 380 },
    title: 'Friday departures',
    subtitle: 'Euston → Manchester',
    emphasis: 'attention',
    raisedBy: 'looked up the timetable',
    createdAt: '2026-09-10T09:00:00.000Z',
    updatedAt: '2026-09-10T09:00:00.000Z',
    tabs: [
      {
        id: 't-dep',
        title: 'Trains',
        badge: '5',
        blocks: [
          block('b-1', 'list', {
            items: [
              '15:40 · arrives 18:07 · £64',
              '16:03 · arrives 18:40 · £41',
              '16:40 · arrives 19:12 · £88',
              '17:03 · arrives 19:35 · £41',
              '17:40 · arrives 20:15 · £96',
            ],
          }),
          block('b-1b', 'text', {
            text: 'Singles, standard class, booked today. The 16:03 and the 17:03 are the same price on a different train — the 16:03 is quieter.',
          }),
        ],
      },
      {
        id: 't-fare',
        title: 'Fares',
        blocks: [
          block('b-2', 'fields', {
            fields: [
              { label: 'Cheapest', value: '£41' },
              { label: 'Booked ahead', value: '18 days' },
              { label: 'Refundable', value: 'Yes, to 16:03' },
            ],
          }),
          block('b-3', 'image', {
            url: CHART,
            alt: 'Fare against departure time, lowest at 16:03 and again at 17:03',
            caption: 'Fare by departure, today',
          }),
        ],
      },
    ],
  },
  {
    id: 'w-route',
    size: { width: 430, height: 310 },
    title: 'The drive',
    subtitle: 'M6, Friday afternoon',
    emphasis: 'normal',
    createdAt: '2026-09-10T09:00:01.000Z',
    updatedAt: '2026-09-10T09:00:01.000Z',
    tabs: [
      {
        id: 't-route',
        title: 'Route',
        blocks: [
          block('b-4', 'text', {
            text: 'Four hours and ten minutes without traffic, and Friday afternoon is not without traffic. The roadworks at junction 19 add twenty minutes and have done every weekday this month.\n\nLeaving at four puts you in around half past eight.',
          }),
          block('b-5', 'links', {
            links: [
              { label: 'National Highways — current delays', href: 'https://nationalhighways.co.uk/traffic' },
              { label: 'Junction 19 roadworks', href: 'https://nationalhighways.co.uk/j19' },
            ],
          }),
        ],
      },
    ],
  },
  {
    id: 'w-cost',
    size: { width: 430, height: 300 },
    title: 'Cost, both ways',
    emphasis: 'normal',
    createdAt: '2026-09-10T09:00:02.000Z',
    updatedAt: '2026-09-10T09:00:02.000Z',
    tabs: [
      {
        id: 't-cost',
        title: 'Compared',
        blocks: [
          block('b-6', 'fields', {
            fields: [
              { label: 'Train, return', value: '£82' },
              { label: 'Fuel, return', value: '£71' },
              { label: 'Parking, two days', value: '£24' },
            ],
          }),
          block('b-7', 'code', {
            language: 'text',
            text: 'train  82.00\ncar    95.00  (71 fuel + 24 parking)\n\ncar wins on luggage, loses on the walk from the station.',
          }),
        ],
      },
    ],
  },
  {
    id: 'w-weather',
    size: { width: 360, height: 190 },
    title: 'Saturday and Sunday',
    emphasis: 'normal',
    createdAt: '2026-09-10T09:00:03.000Z',
    updatedAt: '2026-09-10T09:00:03.000Z',
    tabs: [
      {
        id: 't-wx',
        title: 'Forecast',
        blocks: [
          block('b-8', 'text', {
            text: 'Saturday is cold and clear. Sunday turns wet from about two in the afternoon.',
          }),
        ],
      },
    ],
  },
  {
    id: 'w-notes',
    size: { width: 360, height: 200 },
    title: 'What you said last time',
    emphasis: 'normal',
    raisedBy: 'from a note you kept',
    createdAt: '2026-09-10T09:00:04.000Z',
    updatedAt: '2026-09-10T09:00:04.000Z',
    tabs: [
      {
        id: 't-notes',
        title: 'Notes',
        blocks: [
          block('b-9', 'text', {
            text: 'In August you said you would rather arrive late than leave before six in the morning. Every option above is after lunch.',
          }),
        ],
      },
    ],
  },
  {
    id: 'w-sources',
    size: { width: 360, height: 195 },
    title: 'Where this came from',
    emphasis: 'normal',
    createdAt: '2026-09-10T09:00:05.000Z',
    updatedAt: '2026-09-10T09:00:05.000Z',
    tabs: [
      {
        id: 't-src',
        title: 'Sources',
        blocks: [
          block('b-10', 'links', {
            links: [
              { label: 'Avanti West Coast — timetables', href: 'https://avantiwestcoast.co.uk/timetables' },
              { label: 'Met Office — weekend outlook', href: 'https://metoffice.gov.uk/weather' },
            ],
          }),
        ],
      },
    ],
  },
  {
    id: 'w-return',
    size: { width: 400, height: 260 },
    title: 'Coming back',
    subtitle: 'Sunday',
    emphasis: 'normal',
    createdAt: '2026-09-10T09:00:06.000Z',
    updatedAt: '2026-09-10T09:00:06.000Z',
    tabs: [
      {
        id: 't-ret',
        title: 'Sunday',
        blocks: [
          block('b-11', 'list', {
            items: ['13:03 · £41', '14:03 · £41', '15:40 · £27', '17:03 · £58'],
          }),
        ],
      },
    ],
  },
  {
    id: 'w-seat',
    size: { width: 360, height: 210 },
    title: 'Seat, as you like it',
    emphasis: 'normal',
    raisedBy: 'from your last four bookings',
    createdAt: '2026-09-10T09:00:07.000Z',
    updatedAt: '2026-09-10T09:00:07.000Z',
    tabs: [
      {
        id: 't-seat',
        title: 'Preference',
        blocks: [
          block('b-12', 'fields', {
            fields: [
              { label: 'Position', value: 'Aisle' },
              { label: 'Coach', value: 'Quiet' },
              { label: 'Facing', value: 'Direction of travel' },
            ],
          }),
        ],
      },
    ],
  },
  {
    id: 'w-split',
    size: { width: 420, height: 290 },
    title: 'Splitting the ticket',
    emphasis: 'normal',
    raisedBy: 'it found a cheaper fare',
    createdAt: '2026-09-10T09:00:08.000Z',
    updatedAt: '2026-09-10T09:00:08.000Z',
    tabs: [
      {
        id: 't-split',
        title: 'Two tickets',
        blocks: [
          block('b-13', 'code', {
            language: 'text',
            text: 'Euston → Crewe    16:03   £19\nCrewe → Manchester 17:12   £14\n                  same train   £33\n\n              direct   £41\n              save     £8',
          }),
        ],
      },
    ],
  },
  {
    id: 'w-map',
    size: { width: 400, height: 330 },
    title: 'End to end',
    emphasis: 'normal',
    createdAt: '2026-09-10T09:00:09.000Z',
    updatedAt: '2026-09-10T09:00:09.000Z',
    tabs: [
      {
        id: 't-map',
        title: 'The walk',
        blocks: [
          block('b-14', 'image', {
            url: MAP,
            alt: 'Manchester Piccadilly to the office, 0.9 miles, mostly flat',
            caption: 'Twelve minutes on foot',
          }),
        ],
      },
    ],
  },
  {
    id: 'w-cover',
    size: { width: 400, height: 250 },
    title: 'What the ticket covers',
    emphasis: 'normal',
    createdAt: '2026-09-10T09:00:10.000Z',
    updatedAt: '2026-09-10T09:00:10.000Z',
    tabs: [
      {
        id: 't-cover',
        title: 'Terms',
        blocks: [
          block('b-15', 'text', {
            text: 'Advance single, so that train only. Changing to an earlier one at the station costs the difference, and there is usually a difference.',
          }),
        ],
      },
    ],
  },
  {
    id: 'w-refund',
    size: { width: 400, height: 230 },
    title: 'If it changes',
    emphasis: 'normal',
    createdAt: '2026-09-10T09:00:11.000Z',
    updatedAt: '2026-09-10T09:00:11.000Z',
    tabs: [
      {
        id: 't-ref',
        title: 'Refunds',
        blocks: [
          block('b-16', 'links', {
            links: [
              { label: 'Change your booking', href: 'https://avantiwestcoast.co.uk/manage' },
              { label: 'Delay compensation', href: 'https://avantiwestcoast.co.uk/delay-repay' },
            ],
          }),
        ],
      },
    ],
  },
];

export interface Scenario {
  id: string;
  /** What the button says. */
  label: string;
  /** One line under the buttons saying what this scenario is demonstrating. */
  note: string;
  windows: SurfaceWindow[];
}

/**
 * Twelve windows, twelve different things.
 *
 * This list used to reach twelve by repeating six of them with "(2)" appended,
 * which made the ceiling look like what it is on most products: padding. The
 * whole point of the rule is that twelve is twelve *reasons*, so the scenario is
 * only worth demonstrating if every window in it is answering a different
 * question.
 */
const CEILING = windows.length;

function first(count: number, emphasis: SurfaceWindow['emphasis']): SurfaceWindow[] {
  return windows.slice(0, count).map((window, index) => ({
    ...window,
    emphasis,
    createdAt: new Date(Date.parse('2026-09-10T09:00:00.000Z') + index * 1000).toISOString(),
    updatedAt: new Date(Date.parse('2026-09-10T09:00:00.000Z') + index * 1000).toISOString(),
  }));
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'one',
    label: 'One thing',
    note: 'One window, so it takes attention: a veil, an arrival, no competition.',
    windows: first(1, 'attention'),
  },
  {
    id: 'three',
    label: 'Three things',
    note: 'Still few enough to animate in — but none of them steals focus.',
    windows: first(3, 'normal'),
  },
  {
    id: 'six',
    label: 'Six things',
    note: 'Six different things is six windows. The count is not the thing being rationed.',
    windows: first(6, 'normal'),
  },
  {
    id: 'twelve',
    label: 'A dozen',
    note: `All ${CEILING} at the ceiling. The manner drops to quiet instead: no veil, no arrival motion, nothing raised above the rest.`,
    windows: first(CEILING, 'quiet'),
  },
  {
    id: 'none',
    label: 'Close them',
    note: 'Dismissing a surface never dismisses what was said — it stays in the conversation.',
    windows: [],
  },
];
