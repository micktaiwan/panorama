# Feature: Budget Management (Pennylane Imports)

Related docs:

- [Context](./00-context.md)
- [Technical notes](./02-tech-notes.md)

## Overview

Introduce lightweight budget tracking for the Tech organization by importing Pennylane Excel (.xlsx) exports. The goal is to see spend over time, by category and by project, without complex setup.

## MVP Scope

- Manual import of Pennylane exports (XLSX) from the UI.
- Parsing and normalization of columns: date, vendor, category/account, amount, currency (optional), VAT (optional), reference (optional).
- Basic categorization using editable mappings (for example, vendor -> category).
- Optional link of expense lines to a project (manual assignment or simple rules).
- Read-only views: totals per period, by category, and by project.
- Local storage only (Meteor Mongo). No external sync in MVP.

## Pennylane export structure (inputs)

The Pennylane export `PENNYLANE_LEMPIRE_invoices.xlsx` contains three sheets:

- invoices — invoice headers (one row per invoice)
  - Identifiers: Invoice ID (unique), Invoice number
  - Dates: Date (issue), Due date, Payment date, Validated at
  - Third party: Thirdparty, Thirdparty identifier, Thirdparty reference
  - Totals: Total incl. VAT, Total VAT, Total before tax, Paid amount (tax incl.), Remaining amount (tax incl.)
  - Other: Document title, Free text, Special mentions, Comments, Validators

- invoice lines — invoice line items (one row per line)
  - Links: Invoice ID, Invoice number
  - Product: Label, Product code, Product label
  - Amounts: Amount incl. VAT, Amount before tax, VAT, VAT rate, Currency
  - Meta: File (document), Import date, Date of modification

- Analytics — accounting/analytic breakdown (one row per analytic entry)
  - Links: Invoice ID, Invoice number
  - Supplier: Supplier, Supplier identifier
  - Accounting: Journal code, Plan item number, Plan item label
  - Amounts: Debit, Credit, Balance
  - Analytics: Analytical axis, Category, Weight (Category) (+ .1 variants)
  - Other: Entry piece, Total weight

Join key across sheets: Invoice ID (stable), optionally Invoice number as secondary.

## MVP extraction strategy

- Primary grain: invoice line (from sheet "invoice lines").
- Enrich with header data from "invoices" (date fields, third party).
- Enrich with category from "Analytics" when available (prefer the most weighted Category).
- If Analytics is missing/ambiguous, fall back to vendor/category mappings managed in-app.

Rationale: line-level granularity provides better categorization and future per-project allocation.

## Field mapping (first pass)

Map source columns to `BudgetLine` fields as follows:

- date → `invoices.Date` (issue date) or `Payment date` if present/preferred for cash view
- vendor → `invoices.Thirdparty` (fallback: `Analytics.Supplier`)
- category → `Analytics.Category` (highest weight) or mapping by vendor/keywords
- amountCents → `invoice lines.Amount incl. VAT` × 100 (round to integer)
- vatCents → `invoice lines.VAT` × 100 (optional)
- currency → `invoice lines.Currency` (default to EUR when absent)
- sourceRef → `${Invoice number}` (optionally include file/document link)

Notes:

- Use amounts including VAT for spend tracking in MVP (cash perspective).
- If multiple analytics rows exist per invoice/line, pick the highest `Weight` or aggregate by `Category` based on weights; MVP can pick the dominant one.

## Data Model (MVP)

- BudgetImport
  - _id, filename, periodStart, periodEnd, importedAt, rowCount, status (pending|ok|failed), notes
- BudgetLine
  - _id, importId, date, vendor, category, amountCents, currency, vatCents (optional), projectId (optional), sourceRef (optional), createdAt
- VendorCategoryMapping (optional, can live in a small settings collection)
  - _id, vendorPattern, category, defaultProjectId (optional), createdAt, updatedAt

Notes:

- Store money in minor units (cents) to avoid float issues.
- Keep raw text fields to allow later reprocessing.

## Import Workflow

1. User downloads the export from Pennylane (Excel or CSV).
2. User goes to Budget > Imports and uploads the file.
3. The app parses headers, shows a preview of the first rows, and requests confirmation.
4. Normalization:
   - Convert dates to ISO (YYYY-MM-DD).
   - Parse amounts to integer cents, keep currency.
   - Apply vendor/category mappings when present.
   - Optionally assign projectId based on mapping rules.
5. On confirmation, create one BudgetImport and many BudgetLine documents.
6. Deduplicate within recent imports using a simple key (date, amountCents, vendor).

## Views

- Budget Dashboard
  - Summary: current month spend, last month, trailing 3-month average.
  - Charts: spend over time, spend by category.
  - Top vendors and largest recent expenses.
- Imports
  - List of imports with status, row count, period, and actions (view, delete).
  - Import flow: upload -> preview -> confirm.
- Vendor totals (new)
  - All‑time totals grouped by vendor (no monthly breakdown) with a date range filter.
  - Filters/search:
    - Department: All / Tech / Parked / To review (unset or not in {tech|parked})
    - Team: All teams / LEMAPP / SRE / DATA / PONY / CTO / To review (unset or not in allowed teams)
    - Date range: All / This month / Last month / Last 7 days / Last 30 days
    - Search: case‑insensitive on vendor
  - Sorting: Name (A–Z), Amount (high → low), Amount (low → high)
  - Quick actions per vendor:
    - Park / Tech (bulk apply to similar lines: same vendor)
    - Assign team: LEMAPP / SRE / DATA / PONY / CTO (also marks department=tech)
  - Copy button (header): copies the current table with header and current filters/sort; lines are grouped by team in the order LEMAPP, SRE, DATA, PONY, CTO, then unassigned.
- Monthly by vendor
  - Table grouped by month (YYYY‑MM) and vendor. Do not consolidate lines when `department` or `team` differ. The number in parentheses is the count of lines in that homogeneous group.
  - Extra columns: Dept, Team.
  - A bar chart at the top reflects the current filters.
- Check (duplicates helper)
  - Lists raw lines potentially duplicated using the key `(date, vendor, amount)`.
  - No consolidation: each matching line is shown (Date, Vendor, Amount incl. VAT, Currency).
  - Actions: Delete line; Copy (TSV) of the current selection.
- Project Details (Budget section)
  - Table of linked expenses and totals for the project.

## Interactions and Editing

- Inline edit of category and projectId on a BudgetLine.
- Bulk edit by vendor or selection.
- Recompute aggregates on edit.

### Department classification (Tech vs Parked)

- Goal: quickly focus on Tech spend and defer the rest.
- Field: `department` with values: `tech`, `parked`, or unset.
- Import default: no department is set on new lines (unset by default).
- Filters available on all tabs:
  - All: show everything
  - Tech: `department: 'tech'`
  - Parked: `department: 'parked'`
  - To review: lines without a department (or any value not in `tech|parked`)
- Quick actions (bulk by similarity):
  - Park: sets `department = 'parked'` for the clicked line and all similar lines (same vendor), excluding those already parked.
  - Tech: sets `department = 'tech'` with the same similarity rule.
- Places where actions are available:
  - Recent lines: per‑line Park/Unpark
  - Monthly by vendor: Park/Tech per (month, vendor) group
  - Vendor totals: Park/Tech per vendor (all‑time over the filtered set)

### Team classification (Tech sub‑teams)

- Teams: `lemapp`, `sre`, `data`, `pony`, `cto`.
- Field: `team` on `BudgetLine` (lowercase key stored; UI shows uppercase label).
- Import default: no `team` is set on new lines.
- Bulk assign via actions (same similarity rule as department):
  - Assigning a team also sets `department = 'tech'` for those lines (unless parked).
- Filters:
  - Team filter on Vendor totals: All teams / each team / To review (unset/unknown).
  - Team column in Vendor totals shows the dominant team per vendor for the filtered set.

## Aggregations (MVP)

- Totals by month and quarter.
- Totals by category (global and per project).
- Per-project totals and top vendors.

### Routing (Budget tabs)

- Hash‑based routes:
  - `#/budget/report` — Report monthly total
  - `#/budget/vendors` — Monthly by vendor
  - `#/budget/vendors-total` — Vendor totals (all‑time per vendor)
  - `#/budget/recent` — Recent lines
  - `#/budget/import` — Import
  - `#/budget/check` — Check potential duplicates

### Import management

- Preview parses `.xlsx` client‑side (SheetJS), shows normalized rows and totals.
- Confirmation calls a server method that normalizes, deduplicates and inserts.
- Reset: a destructive action “Reset all” is available in Import, wrapped in a modal confirmation; it deletes all budget lines for local resets.

### Copy/export formatting

- All Copy buttons produce tab‑separated text suitable for pasting in spreadsheets.
- Amount formatting in clipboard:
  - No cents; thousands separators (locale `fr-FR`), e.g. `114 843`.
  - Monthly totals: `YYYY-MM<TAB>Total`
  - Monthly by vendor: `YYYY-MM<TAB>Vendor (n)<TAB>Total`
  - Vendor totals: header row `Vendor<TAB>Total incl. VAT<TAB>Count<TAB>Team`, then rows grouped by team (LEMAPP, SRE, DATA, PONY, CTO, unassigned)
  - Recent lines: `date<TAB>vendor<TAB>department<TAB>amount<TAB>currency`

## Error Handling and Edge Cases

- Header mismatch: provide a small column-mapping step when needed.
- Mixed currencies: show a warning; MVP can filter to EUR-only if simpler.
- Negative amounts (refunds): include correctly in totals.
- Duplicates: skip or flag in the import summary.
- Large files: prefer streaming parsers or set a safe size limit for MVP.

## Privacy and Security

- Local-only processing and storage.
- Process files in memory; optionally store a sanitized copy if useful.

## Future Enhancements (Non-MVP)

- Pennylane API integration for automated synchronization.
- Rules engine for project assignment (by vendor keywords).
- Budget planning vs actuals, alerts on threshold breaches.
- Multi-currency normalization and FX conversions.
- Attach and preview receipts/documents.

## Tech Notes

- Stack: Meteor + React (same as Panorama).
- Parsing: use a robust Excel/CSV parser with good date/locale handling.
- Follow the error policy: do not silently catch errors; surface clear messages.
- Provide sample fixtures for parsing tests.
