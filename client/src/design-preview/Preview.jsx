// D-45 design preview: tokens, type, every ui/ component and its states, and four sample
// layouts (sidebar shell, dashboard cards, task board column, portal header), in light and
// dark mode, with a brand-colour picker to show contrast protection. The class recipes in
// R below are what step 1 moves into src/components/ui/.
import {
  BadgeCheck,
  Bell,
  Building2,
  Calendar,
  CircleAlert,
  CircleCheck,
  Clock,
  FolderKanban,
  Inbox,
  Info,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeftClose,
  Paperclip,
  Plus,
  Search,
  Settings,
  Sun,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyAppearance } from '@/lib/appearance';
import { applyBrand, contrast, DEFAULT_BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';

// Proposed component recipes (Tailwind classes on the D-45 tokens).
const focus = 'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const R = {
  button: cn(
    'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors',
    'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    focus,
  ),
  buttonVariant: {
    default: 'bg-primary text-primary-foreground shadow-card hover:bg-primary/90',
    destructive: 'bg-destructive text-destructive-foreground shadow-card hover:bg-destructive/90',
    outline: 'border bg-card text-foreground shadow-card hover:bg-accent',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
    ghost: 'text-foreground hover:bg-accent',
    link: 'text-brand-text underline-offset-4 hover:underline',
  },
  buttonSize: {
    sm: 'h-8 px-3',
    default: 'h-9 px-4',
    lg: 'h-10 px-5',
    icon: 'size-9',
  },
  badge: 'inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
  badgeVariant: {
    default: 'bg-brand-soft text-brand-text ring-brand-text/20',
    secondary: 'bg-muted text-muted-foreground ring-border',
    outline: 'bg-transparent text-foreground ring-border',
    success: 'bg-success-soft text-success ring-success/25',
    warning: 'bg-warning-soft text-warning ring-warning/25',
    destructive: 'bg-destructive-soft text-destructive ring-destructive/25',
    info: 'bg-info-soft text-info ring-info/25',
  },
  alert: 'flex gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  alertVariant: {
    default: 'bg-card text-foreground',
    info: 'border-info/30 bg-info-soft text-info',
    success: 'border-success/30 bg-success-soft text-success',
    warning: 'border-warning/30 bg-warning-soft text-warning',
    destructive: 'border-destructive/30 bg-destructive-soft text-destructive',
  },
  field: cn(
    'w-full min-w-0 rounded-md border border-input bg-card px-3 text-base text-foreground shadow-card transition-[border-color,box-shadow] md:text-sm',
    'placeholder:text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25',
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
  ),
  card: 'rounded-lg border bg-card text-card-foreground shadow-card',
  label: 'text-sm font-medium text-foreground',
  navItem: cn(
    'relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4',
    focus,
  ),
  navActive:
    'bg-brand-soft font-semibold text-brand-text hover:bg-brand-soft hover:text-brand-text before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-brand-text',
};

const Button = ({ variant = 'default', size = 'default', className, ...p }) => (
  <button type="button" className={cn(R.button, R.buttonVariant[variant], R.buttonSize[size], className)} {...p} />
);
const Badge = ({ variant = 'default', className, ...p }) => <span className={cn(R.badge, R.badgeVariant[variant], className)} {...p} />;
const Alert = ({ variant = 'default', icon: Icon, title, children }) => (
  <div role={variant === 'destructive' ? 'alert' : 'status'} className={cn(R.alert, R.alertVariant[variant])}>
    {Icon ? <Icon aria-hidden="true" /> : null}
    <div>
      {title ? <p className="font-semibold">{title}</p> : null}
      <p className={title ? 'mt-0.5 opacity-90' : ''}>{children}</p>
    </div>
  </div>
);
const Field = ({ label, error, hint, children, id }) => (
  <div className="grid gap-1.5">
    <label htmlFor={id} className={R.label}>
      {label}
    </label>
    {children}
    {error ? (
      <p className="flex items-center gap-1 text-xs font-medium text-destructive">
        <CircleAlert aria-hidden="true" className="size-3.5" />
        {error}
      </p>
    ) : hint ? (
      <p className="text-xs text-muted-foreground">{hint}</p>
    ) : null}
  </div>
);
const Avatar = ({ initials, className }) => (
  <span
    aria-hidden="true"
    className={cn(
      'inline-flex size-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-card',
      className,
    )}
  >
    {initials}
  </span>
);

function Section({ id, title, description, children }) {
  return (
    <section aria-labelledby={id} className="space-y-4 scroll-mt-24">
      <div>
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

const Sub = ({ children }) => <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>;

// ---------------------------------------------------------------- controls

const PRESETS = [
  ['Default blue', DEFAULT_BRAND],
  ['Violet', '#7C3AED'],
  ['Rose', '#E11D48'],
  ['Teal', '#0D9488'],
  ['Bright yellow', '#FACC15'],
  ['Black', '#000000'],
];

function Controls({ appearance, setAppearance, brand, setBrand }) {
  const opts = [
    ['system', 'System', Monitor],
    ['light', 'Light', Sun],
    ['dark', 'Dark', Moon],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div role="radiogroup" aria-label="Appearance" className="inline-flex rounded-md border bg-card p-0.5 shadow-card">
        {opts.map(([v, label, Icon]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={appearance === v}
            onClick={() => setAppearance(v)}
            className={cn(
              'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] px-3 text-sm font-medium transition-colors [&_svg]:size-4',
              focus,
              appearance === v ? 'bg-brand-soft text-brand-text' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="brand" className="text-sm font-medium">
          Brand colour
        </label>
        <input
          id="brand"
          type="color"
          value={brand}
          onChange={(e) => setBrand(e.target.value.toUpperCase())}
          className="size-9 cursor-pointer rounded-md border bg-card p-1"
        />
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{brand}</code>
        {PRESETS.map(([name, hex]) => (
          <button
            key={hex}
            type="button"
            title={name}
            aria-label={`Use ${name} (${hex})`}
            onClick={() => setBrand(hex)}
            className={cn('size-6 cursor-pointer rounded-full border ring-offset-2 ring-offset-background', focus, brand === hex && 'ring-2 ring-foreground')}
            style={{ background: hex }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tokens

const SWATCHES = [
  ['Surfaces', ['background', 'card', 'sidebar', 'muted', 'border', 'input']],
  ['Text', ['foreground', 'muted-foreground']],
  ['Brand (from the workspace colour)', ['primary', 'primary-foreground', 'brand-text', 'brand-soft', 'ring']],
  ['Status (fixed)', ['success', 'warning', 'destructive', 'info']],
];

const PAIRS = [
  ['foreground', 'background', 4.5],
  ['foreground', 'card', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['brand-text', 'card', 4.5],
  ['brand-text', 'brand-soft', 4.5],
  ['primary', 'background', 3],
  ['input', 'card', 3],
  ['destructive-foreground', 'destructive', 4.5],
  ['success', 'card', 4.5],
  ['warning', 'card', 4.5],
  ['destructive', 'card', 4.5],
  ['info', 'card', 4.5],
];

// Reads the resolved tokens during render. Appearance and brand are applied in the event
// handlers (before the re-render), so the values are always current.
function readTokenValues() {
  const cs = getComputedStyle(document.documentElement);
  const names = new Set([...SWATCHES.flatMap(([, n]) => n), ...PAIRS.flatMap(([a, b]) => [a, b])]);
  return Object.fromEntries([...names].map((n) => [n, cs.getPropertyValue(`--${n}`).trim().toUpperCase()]));
}

function Tokens({ vals }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        {SWATCHES.map(([group, names]) => (
          <div key={group} className="space-y-2">
            <Sub>{group}</Sub>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {names.map((n) => (
                <li key={n} className={cn(R.card, 'overflow-hidden')}>
                  <div className="h-12 border-b" style={{ background: `var(--${n})` }} />
                  <div className="px-2.5 py-2">
                    <p className="truncate text-xs font-semibold">{n}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{vals[n]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className={cn(R.card, 'self-start')}>
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold">Contrast check (live)</p>
          <p className="text-xs text-muted-foreground">Text 4.5:1, borders and buttons 3:1 (WCAG AA)</p>
        </div>
        <table className="w-full text-xs">
          <caption className="sr-only">Contrast ratios for the current mode and brand colour</caption>
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="px-4 py-2 text-start font-medium">
                Pair
              </th>
              <th scope="col" className="px-2 py-2 text-end font-medium">
                Ratio
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                AA
              </th>
            </tr>
          </thead>
          <tbody>
            {PAIRS.map(([a, b, min]) => {
              const ok = vals[a]?.startsWith('#') && vals[b]?.startsWith('#');
              const ratio = ok ? contrast(vals[a], vals[b]) : null;
              const pass = ratio !== null && ratio >= min;
              return (
                <tr key={`${a}-${b}`} className="border-b last:border-0">
                  <td className="px-4 py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="inline-flex size-5 items-center justify-center rounded text-[10px] font-bold ring-1 ring-border"
                        style={{
                          background: `var(--${b})`,
                          color: `var(--${a})`,
                        }}
                      >
                        Aa
                      </span>
                      {a} / {b}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-end font-mono tabular-nums">{ratio ? ratio.toFixed(2) : '–'}</td>
                  <td className="px-4 py-1.5 text-end">
                    <Badge variant={pass ? 'success' : 'destructive'}>{pass ? 'Pass' : 'Fail'}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Typography() {
  const rows = [
    ['Page title', 'text-2xl font-semibold tracking-tight', '24 / 32 · 600', 'Website redesign'],
    ['Section title', 'text-lg font-semibold tracking-tight', '18 / 28 · 600', 'Milestones'],
    ['Card title', 'text-sm font-semibold', '14 / 20 · 600', 'Overdue tasks'],
    ['Body (forms, reading)', 'text-base', '16 / 24 · 400', 'The client approved the second version of the homepage.'],
    ['Body (dense screens)', 'text-sm', '14 / 20 · 400', 'Design homepage hero · Due 24 Nov · Sara Haddad'],
    ['Caption', 'text-xs text-muted-foreground', '12 / 16 · 400', 'Updated 5 minutes ago'],
    ['Metric', 'text-3xl font-semibold tracking-tight tabular-nums', '30 / 36 · 600, tabular', '1,284'],
  ];
  return (
    <div className={cn(R.card, 'divide-y')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-4">
        <p className="text-4xl font-semibold tracking-tight">Plus Jakarta Sans</p>
        <p className="text-sm text-muted-foreground">Self-hosted (@fontsource), weights 400–700. Arabic companion font to be added with RTL.</p>
      </div>
      {rows.map(([name, cls, spec, sample]) => (
        <div key={name} className="grid gap-1 px-5 py-3 sm:grid-cols-[12rem_10rem_1fr] sm:items-baseline sm:gap-4">
          <span className="text-xs font-semibold text-muted-foreground">{name}</span>
          <span className="font-mono text-xs text-muted-foreground">{spec}</span>
          <span className={cls}>{sample}</span>
        </div>
      ))}
    </div>
  );
}

function Foundations() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className={cn(R.card, 'space-y-3 p-5')}>
        <Sub>Spacing (4 / 8 px grid)</Sub>
        {[1, 2, 3, 4, 6, 8, 12].map((n) => (
          <div key={n} className="flex items-center gap-3 text-xs">
            <span className="w-14 font-mono text-muted-foreground">{n * 4}px</span>
            <span className="h-2.5 rounded-sm bg-brand-text/70" style={{ width: n * 4 }} />
          </div>
        ))}
      </div>
      <div className={cn(R.card, 'space-y-3 p-5')}>
        <Sub>Radius</Sub>
        <div className="flex flex-wrap gap-4">
          {[
            ['sm 4px', 'rounded-sm', 'badges'],
            ['md 8px', 'rounded-md', 'controls'],
            ['lg 8px', 'rounded-lg', 'cards'],
            ['xl 12px', 'rounded-xl', 'dialogs'],
          ].map(([n, c, use]) => (
            <div key={n} className="text-center text-xs">
              <div className={cn('mb-1.5 size-14 border-2 border-brand-text/60 bg-brand-soft', c)} />
              <p className="font-semibold">{n}</p>
              <p className="text-muted-foreground">{use}</p>
            </div>
          ))}
        </div>
      </div>
      <div className={cn(R.card, 'space-y-3 p-5')}>
        <Sub>Elevation (two levels)</Sub>
        <div className="flex gap-4 bg-background p-3">
          <div className="flex h-16 flex-1 items-center justify-center rounded-lg border bg-card text-xs shadow-card">shadow-card</div>
          <div className="flex h-16 flex-1 items-center justify-center rounded-xl border bg-card text-xs shadow-overlay">shadow-overlay</div>
        </div>
        <p className="text-xs text-muted-foreground">Motion: 150 ms default, 300 ms max, ease-out. Off when the OS asks for reduced motion.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- components

function Components() {
  const [tab, setTab] = useState('overview');
  const tabs = [
    ['overview', 'Overview'],
    ['tasks', 'Tasks'],
    ['files', 'Files'],
    ['activity', 'Activity'],
  ];
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Sub>Buttons: variants</Sub>
        <div className="flex flex-wrap items-center gap-2">
          <Button>
            <Plus aria-hidden="true" />
            New project
          </Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Delete</Button>
        </div>
        <Sub>Buttons: states and sizes</Sub>
        <div className="flex flex-wrap items-center gap-2">
          <Button className="bg-primary/90">Hover</Button>
          <Button className="ring-2 ring-ring ring-offset-2 ring-offset-background">Keyboard focus</Button>
          <Button disabled>Disabled</Button>
          <Button disabled>
            <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Saving…
          </Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="outline" aria-label="Notifications">
            <Bell aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Sub>Badges and status badges</Sub>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Not started</Badge>
          <Badge>In progress</Badge>
          <Badge variant="warning">On hold</Badge>
          <Badge variant="success">Completed</Badge>
          <Badge variant="outline">Cancelled</Badge>
          <Badge variant="destructive">
            <Clock aria-hidden="true" className="size-3" />
            Overdue
          </Badge>
          <Badge variant="info">Awaiting approval</Badge>
          <Badge variant="warning">Lead</Badge>
          <Badge variant="success">Active</Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Alert icon={Info}>Default message: the invitation was sent to the client contact.</Alert>
        <Alert variant="info" icon={Info} title="Read only">
          This project is archived, so its tasks cannot be edited.
        </Alert>
        <Alert variant="success" icon={CircleCheck}>
          Saved. The client can now see this file in the portal.
        </Alert>
        <Alert variant="warning" icon={TriangleAlert}>
          Someone else changed this task. Reload to see their changes.
        </Alert>
        <Alert variant="destructive" icon={CircleAlert} title="Could not save">
          The due date must be after the start date.
        </Alert>
      </div>

      <div className="space-y-3">
        <Sub>Form fields</Sub>
        <div className={cn(R.card, 'grid gap-5 p-5 md:grid-cols-2')}>
          <Field id="f1" label="Project name" hint="Visible to the client in the portal.">
            <input id="f1" className={cn(R.field, 'h-9')} defaultValue="Website redesign" />
          </Field>
          <Field id="f2" label="Search placeholder">
            <input id="f2" className={cn(R.field, 'h-9')} placeholder="Search projects…" />
          </Field>
          <Field id="f3" label="Focused">
            <input id="f3" className={cn(R.field, 'h-9 border-ring ring-3 ring-ring/25')} defaultValue="Keyboard focus" />
          </Field>
          <Field id="f4" label="Budget" error="Enter an amount of 0 or more">
            <input id="f4" className={cn(R.field, 'h-9')} aria-invalid="true" defaultValue="-50" />
          </Field>
          <Field id="f5" label="Status">
            <select id="f5" className={cn(R.field, 'h-9')} defaultValue="InProgress">
              <option value="NotStarted">Not started</option>
              <option value="InProgress">In progress</option>
              <option value="OnHold">On hold</option>
            </select>
          </Field>
          <Field id="f6" label="Disabled">
            <input id="f6" className={cn(R.field, 'h-9')} disabled defaultValue="Workspace currency: JOD" />
          </Field>
          <Field id="f7" label="Description">
            <textarea id="f7" rows={3} className={cn(R.field, 'py-2')} defaultValue="Refresh the homepage and the product pages." />
          </Field>
          <div className="grid content-start gap-3 pt-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" defaultChecked className="size-4 accent-primary" />
              Primary contact
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" />
              Can approve commercial documents
            </label>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Sub>Tabs</Sub>
        <div role="tablist" aria-label="Project sections" className="flex gap-1 overflow-x-auto border-b">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px cursor-pointer whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                focus,
                tab === id ? 'border-brand-text text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className={cn(R.card, 'space-y-3 p-5')}>
          <Sub>Loading</Sub>
          {[100, 80, 90].map((w) => (
            <div key={w} className="flex items-center gap-3">
              <div className="size-8 animate-pulse rounded-full bg-muted" />
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
        <div className={cn(R.card, 'flex flex-col items-center justify-center gap-2 p-6 text-center')}>
          <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Inbox aria-hidden="true" className="size-5" />
          </span>
          <p className="text-sm font-semibold">No tasks yet</p>
          <p className="text-xs text-muted-foreground">Add the first task to start planning.</p>
          <Button size="sm" className="mt-1">
            <Plus aria-hidden="true" />
            Add task
          </Button>
        </div>
        <div className={cn(R.card, 'flex flex-col items-center justify-center gap-2 p-6 text-center')}>
          <span className="flex size-10 items-center justify-center rounded-full bg-destructive-soft text-destructive">
            <CircleAlert aria-hidden="true" className="size-5" />
          </span>
          <p className="text-sm font-semibold">Could not load tasks</p>
          <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
          <Button size="sm" variant="outline" className="mt-1">
            Try again
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Sub>Dialog</Sub>
        <div className="relative flex min-h-72 items-center justify-center overflow-hidden rounded-lg border bg-overlay p-6">
          <div role="dialog" aria-modal="false" aria-labelledby="dlg-title" className="relative w-full max-w-md rounded-xl border bg-card p-6 shadow-overlay">
            <button
              type="button"
              aria-label="Close"
              className={cn('absolute end-4 top-4 cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground', focus)}
            >
              <X aria-hidden="true" className="size-4" />
            </button>
            <h4 id="dlg-title" className="text-lg font-semibold tracking-tight">
              Delete “Homepage v2.pdf”?
            </h4>
            <p className="mt-2 text-sm text-muted-foreground">The file and its 3 versions move to the bin. You can restore it for 30 days.</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline">Cancel</Button>
              <Button variant="destructive">Delete file</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sample layouts

const NAV = [
  ['Dashboard', LayoutDashboard, true],
  ['My tasks', ListChecks],
  ['Projects', FolderKanban],
  ['Clients', Building2],
  ['Approvals', BadgeCheck, false, 3],
];

function KpiCards() {
  const cards = [
    ['Active projects', '12', FolderKanban, 'brand', '2 due this month'],
    ['Overdue tasks', '3', Clock, 'destructive', 'Across 2 projects'],
    ['Awaiting approval', '5', BadgeCheck, 'warning', 'Oldest: 4 days'],
    ['Completed this week', '28', CircleCheck, 'success', '+6 on last week'],
  ];
  const tone = {
    brand: 'bg-brand-soft text-brand-text',
    destructive: 'bg-destructive-soft text-destructive',
    warning: 'bg-warning-soft text-warning',
    success: 'bg-success-soft text-success',
  };
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value, Icon, t, note]) => (
        <li key={label} className={cn(R.card, 'p-5 transition-shadow hover:shadow-overlay')}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <span className={cn('flex size-9 items-center justify-center rounded-md', tone[t])}>
              <Icon aria-hidden="true" className="size-[18px]" />
            </span>
          </div>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        </li>
      ))}
    </ul>
  );
}

function AppShell() {
  return (
    <div className="overflow-hidden rounded-xl border shadow-card">
      <div className="flex min-h-[30rem] bg-background">
        <aside aria-label="Sample sidebar" className="hidden w-60 shrink-0 flex-col border-e bg-sidebar md:flex">
          <div className="flex h-14 items-center gap-2 border-b px-4">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">N</span>
            <span className="truncate text-sm font-semibold">Nexa Studio</span>
            <button
              type="button"
              aria-label="Collapse sidebar"
              className={cn('ms-auto cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground', focus)}
            >
              <PanelLeftClose aria-hidden="true" className="size-4 rtl:-scale-x-100" />
            </button>
          </div>
          <nav aria-label="Main" className="flex-1 space-y-0.5 p-3">
            {NAV.map(([label, Icon, active, count]) => (
              <a
                key={label}
                href="#shell"
                aria-current={active ? 'page' : undefined}
                className={cn(R.navItem, active && R.navActive)}
                onClick={(e) => e.preventDefault()}
              >
                <Icon aria-hidden="true" />
                {label}
                {count ? <span className="ms-auto rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{count}</span> : null}
              </a>
            ))}
            <p className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Workspace</p>
            <a href="#shell" className={R.navItem} onClick={(e) => e.preventDefault()}>
              <Settings aria-hidden="true" />
              Settings
            </a>
          </nav>
          <div className="flex items-center gap-2 border-t p-3">
            <Avatar initials="SH" className="size-8" />
            <div className="min-w-0 text-xs">
              <p className="truncate font-semibold">Sara Haddad</p>
              <p className="truncate text-muted-foreground">Project manager</p>
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b bg-card px-4">
            <div className="relative max-w-sm flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input aria-label="Search" placeholder="Search projects, tasks, files…" className={cn(R.field, 'h-9 ps-9 pe-14 shadow-none')} />
              <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-sans text-[11px] text-muted-foreground">
                Ctrl K
              </kbd>
            </div>
            <Button size="icon" variant="ghost" aria-label="Notifications, 2 unread" className="relative ms-auto">
              <Bell aria-hidden="true" />
              <span aria-hidden="true" className="absolute end-2 top-2 size-2 rounded-full bg-destructive ring-2 ring-card" />
            </Button>
          </header>
          <main className="space-y-6 p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight">Good morning, Sara</h3>
                <p className="mt-1 text-sm text-muted-foreground">Thursday 20 November · 4 tasks due today</p>
              </div>
              <Button>
                <Plus aria-hidden="true" />
                New project
              </Button>
            </div>
            <KpiCards />
          </main>
        </div>
      </div>
    </div>
  );
}

function BoardColumn() {
  const tasks = [
    {
      title: 'Design homepage hero',
      project: 'Website redesign',
      priority: ['High', 'warning'],
      due: '24 Nov',
      who: 'SH',
      subtasks: '2/5',
      comments: 4,
    },
    {
      title: 'Write product copy for pricing page',
      project: 'Website redesign',
      priority: ['Urgent', 'destructive'],
      due: '18 Nov',
      overdue: true,
      who: 'LK',
      files: 2,
    },
    {
      title: 'Prepare client review deck',
      project: 'Brand refresh',
      priority: ['Normal', 'secondary'],
      due: '28 Nov',
      who: 'OM',
      approval: true,
    },
  ];
  return (
    <div className="flex flex-wrap items-start gap-4">
      <section aria-label="In progress column" className="w-80 shrink-0 rounded-lg bg-muted/70 p-2">
        <header className="flex items-center gap-2 px-2 pb-2 pt-1">
          <span aria-hidden="true" className="size-2 rounded-full bg-brand-text" />
          <h3 className="text-sm font-semibold">In progress</h3>
          <span className="rounded-full bg-card px-1.5 text-xs font-semibold tabular-nums text-muted-foreground ring-1 ring-border">3</span>
          <button
            type="button"
            aria-label="Add task to In progress"
            className={cn('ms-auto cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground', focus)}
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </header>
        <ul className="space-y-2">
          {tasks.map((tk, i) => (
            <li key={tk.title}>
              <article
                className={cn(R.card, 'cursor-grab space-y-2.5 p-3 transition-shadow hover:shadow-overlay', i === 0 && 'shadow-overlay ring-2 ring-ring')}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium leading-snug">{tk.title}</h4>
                  <Badge variant={tk.priority[1]}>{tk.priority[0]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{tk.project}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {tk.overdue ? (
                    <span className="inline-flex items-center gap-1 font-medium text-destructive">
                      <Calendar aria-hidden="true" className="size-3.5" />
                      {tk.due} · Overdue
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Calendar aria-hidden="true" className="size-3.5" />
                      {tk.due}
                    </span>
                  )}
                  {tk.subtasks ? (
                    <span className="inline-flex items-center gap-1">
                      <ListChecks aria-hidden="true" className="size-3.5" />
                      {tk.subtasks}
                    </span>
                  ) : null}
                  {tk.comments ? (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare aria-hidden="true" className="size-3.5" />
                      {tk.comments}
                    </span>
                  ) : null}
                  {tk.files ? (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip aria-hidden="true" className="size-3.5" />
                      {tk.files}
                    </span>
                  ) : null}
                  {tk.approval ? <Badge variant="info">Approval</Badge> : null}
                  <Avatar initials={tk.who} className="ms-auto" />
                </div>
              </article>
            </li>
          ))}
        </ul>
      </section>
      <p className="max-w-xs text-sm text-muted-foreground">
        The first card shows the keyboard-selected state (also used while dragging). Overdue shows text and an icon, not colour alone. @dnd-kit keeps its own
        drag motion; GSAP will not touch the board.
      </p>
    </div>
  );
}

function PortalHeader() {
  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-card">
      <div className="h-1 bg-primary" />
      <header className="border-b bg-card">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">N</span>
            <span className="text-sm font-semibold">Nexa Studio</span>
            <span className="text-sm text-muted-foreground">· Client portal</span>
          </span>
          <nav aria-label="Portal" className="flex flex-1 gap-1">
            {['Home', 'Projects', 'Approvals'].map((n, i) => (
              <a
                key={n}
                href="#portal"
                aria-current={i === 0 ? 'page' : undefined}
                onClick={(e) => e.preventDefault()}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  focus,
                  i === 0 ? 'bg-brand-soft text-brand-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {n}
              </a>
            ))}
          </nav>
          <Button size="icon" variant="ghost" aria-label="Notifications">
            <Bell aria-hidden="true" />
          </Button>
          <Avatar initials="RA" className="size-8" />
        </div>
      </header>
      <div className="bg-gradient-to-b from-brand-soft to-background px-6 pb-8 pt-8">
        <p className="text-sm font-medium text-brand-text">Welcome back</p>
        <h3 className="mt-1 text-2xl font-semibold tracking-tight">Rania, 2 items need your approval</h3>
        <p className="mt-1 text-sm text-muted-foreground">Website redesign · Brand refresh</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button>
            <BadgeCheck aria-hidden="true" />
            Review approvals
          </Button>
          <Button variant="outline">View projects</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- page

const TOC = [
  ['tokens', 'Colour tokens'],
  ['type', 'Typography'],
  ['foundations', 'Spacing, radius, elevation'],
  ['components', 'Components'],
  ['shell', 'App shell with sidebar'],
  ['board', 'Task board column'],
  ['portal', 'Portal header'],
];

export function Preview() {
  const [appearance, setAppearanceState] = useState('light');
  const [brand, setBrandState] = useState(DEFAULT_BRAND);
  const setAppearance = (v) => setAppearanceState(applyAppearance(v));
  const setBrand = (v) => {
    applyBrand(v);
    setBrandState(v);
  };
  // Re-read the tokens when the OS theme changes while "System" is selected.
  const [, setTick] = useState(0);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTick((n) => n + 1);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const vals = readTokenValues();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Design preview · D-45</h1>
            <p className="text-xs text-muted-foreground">Clean Professional SaaS. Proposed styles, not yet applied to the app.</p>
          </div>
          <Controls appearance={appearance} setAppearance={setAppearance} brand={brand} setBrand={setBrand} />
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-14 px-4 py-8 sm:px-6">
        <nav aria-label="Sections" className="flex flex-wrap gap-2">
          {TOC.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className={cn('rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground', focus)}
            >
              {label}
            </a>
          ))}
        </nav>
        <Section
          id="tokens"
          title="Colour tokens"
          description="Neutral slate surfaces, one brand accent taken from the workspace colour, and four fixed status colours. Pick another brand colour above to see contrast protection adjust it."
        >
          <Tokens vals={vals} />
        </Section>
        <Section id="type" title="Typography">
          <Typography />
        </Section>
        <Section id="foundations" title="Spacing, radius, elevation">
          <Foundations />
        </Section>
        <Section
          id="components"
          title="Components"
          description="Every component in src/components/ui with its states. Focus rings use the brand colour at 3:1 or more."
        >
          <Components />
        </Section>
        <Section
          id="shell"
          title="App shell with sidebar"
          description="Internal app. Logical CSS (start/end) throughout so it mirrors for Arabic. Collapses to a drawer below 768 px. Includes the dashboard card row."
        >
          <AppShell />
        </Section>
        <Section id="board" title="Task board column">
          <BoardColumn />
        </Section>
        <Section id="portal" title="Portal header" description="Clients see the agency's logo and colour. The portal keeps a top bar.">
          <PortalHeader />
        </Section>
      </div>
    </div>
  );
}
