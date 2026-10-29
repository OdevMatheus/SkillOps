# ADR-0003: Top-Tier Portfolio Frontend Stack (Next.js Static Export + React 19 + Tailwind CSS + ShadCN UI + Motion)

## Status
Proposed (2026-10-29)

## Context
**FolioOps** needs a frontend technology stack for the generated portfolio (`site/`) and its underlying blueprint library (`templates/`) that satisfies five demands simultaneously:
1. **Award-Level Visual Expressiveness:** Must support rich typography, editorial layouts, asymmetric bento grids, smooth micro-interactions, and accessible interactive primitives (modals, tabs, accordions, filterable galleries) for any profession.
2. **Highest AI Code Generation Accuracy:** AI models (Claude, Gemini, GPT) write their highest-quality, lowest-bug UI code when working with the most widely represented modern component ecosystem.
3. **Zero-Cost Static Hosting Anywhere:** The generated portfolio must compile to a pure static bundle (`HTML/CSS/JS/WebP`) that can be hosted for free on GitHub Pages, Vercel, Cloudflare Pages, or Netlify without requiring a paid Node.js server or database runtime.
4. **Top Core Web Vitals & SEO Out of the Box:** Must support build-time metadata generation (Open Graph, Twitter Cards, `sitemap.xml`, `robots.txt`, JSON-LD `Person` / `ProfessionalService` structured data) and sub-second First Contentful Paint.
5. **Unified Runtime with Engine Scripts:** Must run on Node.js so the user environment requires only a single runtime.

## Decision
We will standardize the **FolioOps** portfolio engine (`templates/` and `site/`) on:

- **Framework:** **Next.js (App Router)** configured with `output: 'export'` (Static Site Generation / Static Export).
- **UI Library:** **React 19** with **TypeScript** (strict mode validated automatically by the AI via `scripts/verify-build.mjs`).
- **Styling System:** **Tailwind CSS** coupled with CSS custom property design tokens (`--bg`, `--surface`, `--text`, `--accent`, `--font-display`, `--font-sans`, `--font-mono`) driven by `profile/_design.md`.
- **Accessible Component Primitives:** **ShadCN UI (Radix UI primitives)** for accessible dialogs, sheets, tabs, tooltips, and navigation menus with full keyboard navigation and ARIA compliance built in.
- **Animation & Micro-Interactions:** **Motion (Framer Motion)** + hardware-accelerated CSS transitions (`transform`, `opacity`) with mandatory `prefers-reduced-motion` support.
- **Typography:** `next/font/google` (or local self-hosted variable fonts) with `display: 'swap'` for zero layout shift and automatic font optimization.

## Consequences

### Positive
- **Unmatched Ecosystem & Component Library:** Pairing Tailwind CSS + ShadCN UI + Motion gives the AI access to the richest, most customizable component ecosystem on the web while keeping full ownership of component source code inside `site/`.
- **Built-In Accessibility Foundation:** Radix UI primitives underneath ShadCN UI handle complex WAI-ARIA focus traps, `aria-expanded` states, and keyboard navigation (`Tab`, `Escape`, Arrow keys), giving Block E (`modes/audit.md`) a rock-solid accessibility baseline.
- **Native Metadata & SEO API:** Next.js App Router provides first-class typed APIs for `Metadata`, `sitemap.ts`, `robots.ts`, and JSON-LD script injection at build time.
- **100% Free Static Deployment:** Because `output: 'export'` produces a self-contained static `out/` directory, `modes/deploy.md` can publish the portfolio to GitHub Pages, Vercel, or Cloudflare Pages with zero recurring hosting cost.

### Negative
- **`next/image` Static Export Constraint:** Next.js's default runtime image optimization server is disabled when `output: 'export'` is enabled (`images: { unoptimized: true }` in `next.config.mjs`).
  - *Mitigation:* Our intake pipeline (`scripts/intake.mjs`, see [ADR-0002](./0002-two-stage-user-data-layer-inbox-and-profile.md)) pre-optimizes, resizes, and converts all user images into lightweight `.webp` assets in `profile/assets/` before Next.js builds the site, eliminating the need for a runtime image server.
- **Node_modules Disk Footprint:** A Next.js + Playwright workspace requires local disk space for `node_modules`, though the deployed static output (`site/out/`) is tiny.

### Neutral
- All TypeScript compilation and Next.js build checks are executed and fixed autonomously by the AI Agent during Block C (`modes/build.md`), keeping the framework invisible to non-technical users.

## Alternatives Considered

### Alternative 1: Vanilla HTML/CSS/JS Templates
- **Why not chosen:** While lightweight, vanilla HTML lacks reusable accessible interactive primitives (like Radix/ShadCN dialogs, command palettes, or filterable case-study drawers) and forces the AI to write brittle imperative DOM manipulation code.

### Alternative 2: Astro
- **Why not chosen:** Astro is an excellent static framework, but when building highly interactive portfolio views (smooth layout transitions, interactive case-study viewers, filterable galleries) and leveraging ShadCN UI + Motion, a unified Next.js + React 19 architecture avoids multi-framework island hydration quirks and aligns with the largest body of AI training data.
