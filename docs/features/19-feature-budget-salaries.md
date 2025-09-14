# Feature: Budget — Salaries (Payroll)

Related docs:

- [Context](./00-context.md)
- [Roadmap](./01-roadmap.md)
- [Technical notes](./02-tech-notes.md)
- [Feature: Budget Management](./15-feature-budget.md)

## Overview

Add lightweight salary management to People and Budget to track monthly employer cost, forecast year totals, and visualize payroll alongside other spend. Keep it simple, local-only, and privacy-aware in MVP.

## MVP Scope

- People: add a Remuneration section per person (current base, FTE, currency, dates).
- Salary history via SalaryEvents: effective date + new base (and optional variable).
- Preferences: a single global employer charges rate (e.g., 42%) and default benefits.
- Budget: a new Payroll view/tab that aggregates monthly employer cost per person and totals.
- Calculations: prorate by FTE, active days in month, apply charges, optionally spread variable.
- Privacy: local-only storage; optional UI masking toggle for sensitive values.

Non-goals (MVP):

- Complex country-specific tax rules and payroll-grade accuracy.
- Multi-currency conversions and historical FX.
- Roles/permissions beyond current local app model.

## Data Model

Enhance or introduce the following structures (minor units = cents for amounts):

- Person (existing: `imports/api/people/collections.js`)
  - `comp.currency: 'EUR' | 'USD' | string` — default `EUR`.
  - `comp.fte: number` — 1.0 for full-time; 0.5 etc.
  - `comp.hireDate?: string` — ISO `YYYY-MM-DD` (inclusive).
  - `comp.exitDate?: string` — ISO `YYYY-MM-DD` (exclusive if set mid-year).
  - `comp.currentBaseAnnualCents?: number` — convenience mirror of latest event.

- SalaryEvent (new collection)
  - `_id: string`
  - `personId: string`
  - `effectiveFrom: string` — ISO date `YYYY-MM-DD`.
  - `baseAnnualCents: number` — annual base at this date.
  - `variableAnnualCents?: number` — optional target bonus/variable.
  - `notes?: string`
  - `createdAt: Date`, `updatedAt: Date`

- AppPreferences (existing)
  - `payroll.employerChargesRate: number` — e.g., 0.42.
  - `payroll.defaultBenefitsMonthlyCents?: number` — optional benefits estimate.

Notes:

- Keep money as integers (cents) to avoid float issues.
- `currentBaseAnnualCents` is denormalized for quick reads; source of truth is events.

## Calculations

- Effective annual base for a date is the latest `SalaryEvent` with `effectiveFrom ≤ date`.
- Monthly base before charges: `monthlyBase = baseAnnualCents / 12 * fte * prorataActiveDays`.
- Employer charges: `charges = monthlyBase * employerChargesRate` (from Preferences).
- Benefits: `benefitsMonthlyCents` (from Preferences, optional; add as-is).
- Variable pay:
  - MVP: either spread evenly: `variableMonthly = (variableAnnualCents || 0) / 12`, or zero if unset.
  - Later: support one-off payouts.
- Total employer cost per month per person:
  - `totalMonthly = round(monthlyBase + charges + benefitsMonthlyCents + variableMonthly)`
- Proration by active days in month:
  - If a person joins or exits mid-month, prorate by active calendar days relative to total days in that month.

Assumptions:

- Currency: compute in the person’s currency; MVP shows EUR-only or a badge for others.
- Rounding: round at the last step to integer cents.

## Views

- People → Remuneration section
  - Fields: Current base (annual), Currency, FTE, Hire/Exit dates.
  - Table: Salary history (effectiveFrom, baseAnnual, variableAnnual, notes).

- Budget → Payroll tab
  - Table by month × person: columns Month, Person, Base, Charges, Variable, Benefits, Total.
  - Summary: totals per month, YTD, trailing 3-month average.
  - Filters: Team, Date range (This month, Last month, Custom), Person.
  - Copy/export: tab-separated with thousands separators (same style as Budget docs).

## Interactions and Editing

- Add/edit/remove salary events from the person page.
- Editing events auto-updates the computed current base.
- Inline edit FTE, currency, hire/exit dates.
- Budget Payroll is read-only; values derive from events + preferences.

## Methods (Meteor)

- `salaryEvents.insert({ personId, effectiveFrom, baseAnnualCents, variableAnnualCents?, notes? })`
- `salaryEvents.update(eventId, modifier)`
- `salaryEvents.remove(eventId)`
- `people.updateComp(personId, { currency?, fte?, hireDate?, exitDate? })`
- `budget.payroll.monthly({ start, end, team?, personId? })`
  - Returns per-person, per-month rows with breakdown fields.

Publications (MVP, local-only app):

- `salaryEvents.byPerson(personId)` and `salaryEvents.all()` if needed for admin.

## Routing

- People page: extend existing person details to include a Remuneration card.
- Budget: add `#/budget/payroll` route and navigation entry.

## Error Handling and Privacy

- Local-only processing
- Respect the rule: avoid try/catch unless necessary
- never silently catch
- surface clear messages
- Optional UI masking: toggle to hide amounts unless revealed.

## Future Enhancements

- Allocations by project: split a person’s monthly cost across projects by percentages.
- Scenario planning: future-dated hires/raises and forecast comparison.
- Multi-currency normalization with FX rates by month.
- Role-based access (HR/Admin) and audit log of changes.
- One-off variable payouts and retroactive adjustments.
- CSV/Excel export of payroll table.

## Tech Notes

- Store amounts in cents; format with locale (e.g., `fr-FR`) in UI and clipboard.
- Date helpers: implement `getActiveDaysInMonth(person, month)` to compute proration cleanly.
- Aggregation: compute on demand in method; cache last result in memory if needed.
- Testing: add unit tests for proration, event selection, and totals.
