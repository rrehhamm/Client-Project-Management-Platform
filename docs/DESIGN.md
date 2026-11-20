# Design system

Decision **D-45** in [DECISIONS.md](DECISIONS.md). Direction: **Clean Professional SaaS** with a calm palette chosen by the Product Owner: Dusk Blue `#3E5BA3`, Deep Space Blue `#0C2D45`, Moss Green `#84D175`, Frosted Mint `#E6FBDA`, Lemon Chiffon `#FFF8D2`. No loud, saturated colours. The look is quiet and neutral, one accent colour from the company's brand, dense where people work, generous where they read.

## Where things live

| What                                               | File                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| All tokens: colours, radius, shadows, font, motion | `client/src/styles/tokens.css`                                                                                                    |
| Brand colour contrast protection                   | `client/src/lib/brand.js`                                                                                                         |
| Appearance setting (System / Light / Dark)         | `client/src/lib/appearance.js`                                                                                                    |
| Live preview of everything below                   | `client/design-preview.html`. Run `npm run dev -w client`, then open http://localhost:5173/design-preview.html. Development only. |
| Contrast tests                                     | `client/src/styles/tokens.test.js`, `client/src/lib/brand.test.js`                                                                |

## Rules for components

- **Use token names, never raw colours.** For example `bg-card`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-brand-text`, `bg-success-soft text-success`. A hex value or a Tailwind palette colour (`text-amber-700`) in a component is a bug.
- **Use logical properties, never left or right.** That means `ps-` / `pe-` / `ms-` / `me-` / `start-` / `end-` / `border-s` / `border-e` / `text-start`. They let the layout mirror when Arabic (RTL) is added. Icons that point a direction (chevrons, the collapse icon) get `rtl:-scale-x-100`.
- **Never use colour alone.** Status always has text, and an icon where it helps (for example "Overdue" plus a clock icon).
- **Keep focus visible.** Interactive elements use `focus-visible:ring-2 ring-ring ring-offset-2`. Never remove focus without a replacement.

## Colour

Light and dark are classes on `<html>` (`light` / `dark`), set from the user's appearance setting. Tailwind's `dark:` variant follows the class.

| Group          | Tokens                                                                                                        | Notes                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Surfaces       | `background`, `card`, `sidebar`, `muted`, `secondary`, `accent` (hover surface), `border`, `input`, `overlay` | Calm green-grey neutrals; text in Deep Space Blue `#0C2D45`. Input borders are at least 3:1 against page and card (WCAG 1.4.11).                                                          |
| Text           | `foreground`, `muted-foreground`                                                                              | Both are at least 4.5:1 on every surface.                                                                                                    |
| Brand          | `primary`, `primary-foreground`, `brand-text`, `brand-soft`, `ring`                                           | Derived from the workspace colour (below). Default: Dusk Blue `#3E5BA3`.                                                                       |
| Status (fixed) | `success`, `warning`, `destructive`, `info`, each with `*-soft`; `destructive-foreground`                     | They never follow the brand colour. Light-mode soft backgrounds are Frosted Mint `#E6FBDA` (success) and Lemon Chiffon `#FFF8D2` (warning); dark mode uses Moss Green `#84D175` on Deep Space Blue. Text on them stays at 4.5:1 or more. |

### Brand colour and contrast protection

Each company sets its colour in Workspace settings. `brand.js` turns it into the brand tokens for both modes:

- **`brand-text` and `ring`:** links, the active navigation item and focus rings. Each is at least 4.5:1 on the page, on cards and on `brand-soft`.
- **`primary` with `primary-foreground`:** buttons. The label is at least 4.5:1 on the button, and the button is at least 3:1 against the page.
- **When a colour fails these checks:** it is darkened (light mode) or lightened (dark mode) in 2% steps, keeping its hue, until it passes. A bright yellow, for example, becomes a mustard in light mode and stays yellow with a dark label in dark mode.

`tokens.test.js` checks every pair in both modes. `brand.test.js` checks ten sample brand colours, black and white included.

## Typography

**Plus Jakarta Sans** (variable, weights 400–700), self-hosted through `@fontsource-variable/plus-jakarta-sans`. There are no font requests to Google, so it works under the production CSP and offline.

| Role                                       | Size / line height · weight    | Class                                                                       |
| ------------------------------------------ | ------------------------------ | --------------------------------------------------------------------------- |
| Page title                                 | 24 / 32 · 600                  | `text-2xl font-semibold tracking-tight`                                     |
| Section title                              | 18 / 28 · 600                  | `text-lg font-semibold tracking-tight`                                      |
| Card title                                 | 14 / 20 · 600                  | `text-sm font-semibold`                                                     |
| Body, forms and reading                    | 16 / 24                        | `text-base` (inputs are `text-base md:text-sm`, which stops iOS zooming in) |
| Body, dense screens (lists, board, tables) | 14 / 20                        | `text-sm`                                                                   |
| Caption                                    | 12 / 16                        | `text-xs text-muted-foreground`                                             |
| Metric                                     | 30 / 36 · 600, tabular figures | `text-3xl font-semibold tabular-nums`                                       |

**Arabic:** when RTL is added, pair it with an Arabic companion font (for example **IBM Plex Sans Arabic**) through `--font-sans`, and set `lang` / `dir` on `<html>`.

## Spacing, radius, elevation, motion

- **Spacing:** 4 / 8 px grid (Tailwind steps 1, 2, 3, 4, 6, 8, 12).
- **Radius:**
  - `rounded-sm`: 4 px, for small marks;
  - `rounded-md`: 8 px, for controls;
  - `rounded-lg`: 8 px, for cards;
  - `rounded-xl`: 12 px, for dialogs.
- **Elevation, two levels only:**
  - `shadow-card` for cards and controls;
  - `shadow-overlay` for dialogs, menus and lifted cards.
- **Motion:**
  - 150 ms by default and 300 ms at most, with ease-out;
  - everything turns off when the OS asks for reduced motion;
  - GSAP is for purposeful micro-interactions only;
  - nothing animates what @dnd-kit controls.

## Layout

- **Internal app:**
  - a sidebar with icon and label for each section; it can be collapsed and becomes a drawer below 768 px;
  - a slim top bar for search (Ctrl K), notifications and account;
  - lists and forms keep a readable width, while the board and calendar use the full width.
- **Portal:** a top bar with the company's logo and colour, and a welcome header on the home page.
