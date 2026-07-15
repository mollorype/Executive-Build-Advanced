---
name: STM Daily dark UI tokens
description: Complete dark UI overhaul of STM Daily — token set, layout decisions, all screens.
---

## Dark token set
- Page bg: `bg-[#0f111a]`
- Card bg: `bg-[#161b22]`
- Sub-header / highlight row bg: `bg-[#1c2433]`
- Borders: `border-[#30363d]`, `divide-[#30363d]`
- Input bg: `bg-[#0d1117]`; focus: `border-blue-500 ring-blue-500/20`
- Primary text: `text-white`; muted: `text-gray-400/500/600`

## Fuel accent colors
- 92: `text-blue-400` / `border-l-blue-500`
- 95: `text-emerald-400` / `border-l-emerald-500`
- PD: `text-purple-400` / `border-l-purple-500`
- Diesel: `text-orange-400` / `border-l-orange-500`
- Jelly can: `text-teal-400`

## Key decisions
- ProductCard: removed `color` prop, replaced with `accentText` + `accentBorder`
- Fuel rows: full-width vertical stack (not 3-col grid), `border-l-4` accent
- Badge chips on dark cards: `bg-white/5` (5% opacity) — intentional, not a mistake
- Pipa "Add" button: `text-amber-400` accent on dark border — intentional brand accent
- Confirm button: `bg-blue-600` (not amber gradient)
- Success icon: blue ring + blue check, no amber
- Difference row highlight: `bg-emerald-500/10` (positive) / `bg-red-500/10` (negative) / `bg-[#1c2433]` (zero)

**Why:** CEO/professional dark aesthetic; no colored card backgrounds — only colored text/borders.
