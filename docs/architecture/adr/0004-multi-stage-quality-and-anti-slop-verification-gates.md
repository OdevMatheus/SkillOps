# ADR-0004: Multi-Stage Quality Gates (Visual Anti-Slop Polish via Playwright + Automated SEO, WCAG 2.2 & Core Web Vitals Audits)

## Status
Proposed (2026-10-29)

## Context
Even with a structured profile (`profile/_profile.md`), a selected visual direction (`profile/_design.md`), and a top-tier frontend stack (`site/`), a single-pass AI code generation (Block C: `build`) is **never guaranteed** to produce an award-level website on the first try.

Without mandatory post-generation inspection in a real browser, AI-generated portfolios consistently exhibit two categories of defects:
1. **Visual & Aesthetic Defects ("AI Slop"):**
   - Generic AI layout clichés (e.g., 3 identical glassmorphic cards with glowing borders, overused purple/indigo gradients, uninspired `Inter` font defaults, repetitive hero badges).
   - Broken visual hierarchy revealed only when rendered (text overflowing containers on mobile `390x844`, jarring spacing rhythms, low contrast text over images, or broken dark/light surface transitions).
2. **Technical & Compliance Defects:**
   - Missing or invalid `Schema.org` JSON-LD (`Person` / `ProfessionalService`), broken Open Graph preview tags, or missing canonical URLs.
   - WCAG 2.2 Level AA accessibility violations (missing `alt` attributes, icon buttons without `aria-label`, broken heading hierarchy `h1 -> h3`, insufficient color contrast `< 4.5:1`).
   - Core Web Vitals regressions (Cumulative Layout Shift `CLS > 0.1` from unsized media, slow Largest Contentful Paint `LCP > 2.5s`, or heavy blocking scripts).

Relying on the user to install external skills or manually critique these issues defeats the purpose of an autonomous portfolio engine.

## Decision
We will enforce a **Mandatory Two-Gate Post-Generation Verification & Fix Loop** (`Block D: polish` and `Block E: audit`) inside `modes/auto-pipeline.md`, backed by compiled rulebooks in `rules/` and automated Playwright/Node.js inspection scripts in `scripts/`:

### Gate 1 — Block D: Visual Polish & Anti-Slop Loop (`modes/polish.md`)
1. **Compiled Rulebooks:**
   - `rules/anti-slop-design.md`: Distills the core art-direction rules and banned AI clichés from `design-taste-frontend` (domain-appropriate editorial layouts, strict 4-token color discipline, deliberate display/serif/sans typography pairings, ban on generic SaaS tropes for non-tech portfolios).
   - `rules/impeccable-ui.md`: Distills the UI craftsmanship rules from `impeccable` (spatial rhythm, typographic scale, empty/loading states, tactile micro-interactions, responsive balance).
2. **Real-Browser Verification Script (`scripts/inspect-visual.mjs`):**
   - Renders the live local portfolio in headless **Playwright** across both **Desktop (`1440x900`)** and **Mobile (`390x844`)** viewports.
   - Captures full-page and section screenshots into `reports/screenshots/`.
   - Runs programmatic DOM & computed-style checks (detecting horizontal overflow, text clipping, banned font families, excessive color count, and crowded padding).
3. **Self-Healing Fix Loop:**
   - A dedicated subagent (or the main agent in sequential mode) inspects the screenshots and the `inspect-visual.mjs` JSON/Markdown output against `rules/anti-slop-design.md` and `rules/impeccable-ui.md`, refactors `site/` components, and re-runs the inspector until zero visual/anti-slop violations remain (up to a bounded maximum of 3 iterations).

### Gate 2 — Block E: Technical Quality Audit Loop (`modes/audit.md`)
1. **Compiled Rulebooks:**
   - `rules/seo-schema.md`: Enforces title/meta length, Open Graph tags, `sitemap.xml`, `robots.txt`, and valid `Schema.org` JSON-LD (`Person`, `ProfilePage`).
   - `rules/wcag-accessibility.md`: Enforces WCAG 2.2 AA compliance (semantic landmarks, heading hierarchy, keyboard focus visibility, contrast ratios, `prefers-reduced-motion`).
   - `rules/core-web-vitals.md`: Enforces performance budgets (`LCP < 2.5s`, `CLS < 0.1`, `INP < 200ms`, zero render-blocking resources).
2. **Automated Quality Gate Script (`scripts/audit-quality.mjs`):**
   - Uses Playwright + `@axe-core/playwright` to run a full WCAG 2.2 AA accessibility scan on the rendered DOM.
   - Extracts and validates all `<head>` SEO metadata and JSON-LD structured data blocks.
   - Measures layout shift (`CLS`), LCP element timing, and asset payload weights, writing a structured report to `reports/quality-audit.md`.
3. **Self-Healing Fix Loop:**
   - If `scripts/audit-quality.mjs` reports any critical/serious `axe-core` violation, missing SEO schema, or CWV threshold breach, the AI must fix the code in `site/` and re-run `scripts/audit-quality.mjs` before transitioning to Block F (`delivery/deploy`).

## Consequences

### Positive
- **Eliminates "AI-Made" Aesthetics Automatically:** By inspecting real screenshots and computed styles in Playwright against `rules/anti-slop-design.md` and `rules/impeccable-ui.md`, visual defects are caught and fixed before the user ever sees the first preview.
- **Guaranteed Production Readiness:** Every portfolio produced by FolioOps meets WCAG 2.2 AA accessibility, structured SEO (`JSON-LD`), and Core Web Vitals budgets by contract, not by chance.
- **Evidence-Led Reports (`reports/`):** Users and developers can inspect `reports/quality-audit.md` and `reports/screenshots/` to see objective proof of the portfolio's visual and technical quality.

### Negative
- **Playwright Browser Binary Download:** Running `scripts/inspect-visual.mjs` and `scripts/audit-quality.mjs` requires Chromium via Playwright (`npx playwright install chromium`), which adds a one-time setup download checked by `scripts/doctor.mjs`.
- **Longer Initial Generation Time:** Executing Block D (`polish`) and Block E (`audit`) adds 1–3 minutes to the end-to-end `auto-pipeline` run compared to a raw unverified build, which is a deliberate trade-off in favor of quality.

### Neutral
- Bounded retry loops (max 3 iterations per gate) prevent infinite self-correction loops; if an edge-case issue persists after 3 attempts, it is logged clearly in `reports/quality-audit.md`.

## Alternatives Considered

### Alternative 1: Static Code Linting Only (`eslint-plugin-jsx-a11y` without Playwright)
- **Why not chosen:** Static AST linters cannot detect real visual overlap, mobile horizontal scrollbars, computed color contrast over backgrounds, Cumulative Layout Shift (`CLS`), or generic visual composition. Real-browser rendering via Playwright is essential.

### Alternative 2: Relying on the User to Manually Run Lighthouse and Ask the AI to Fix Issues
- **Why not chosen:** Places the QA burden on the human user, violating the autonomous `career-ops` pipeline philosophy.
