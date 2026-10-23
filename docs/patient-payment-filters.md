# Patient payment filters

`GET /api/patients` now includes `pendingAmount` on each patient. It is a decimal
amount; clients should accept either a JSON number or numeric string.

Optional query parameters (combine with existing search and demographic filters):

- `minPending=0`: only patients with a positive pending balance.
- `minPending=5000.00`: pending amount strictly greater than ₹5,000.
- `sortBy=pending_desc`: highest pending first. Ties use creation date, then ID.
- Omit these parameters to keep all patients in the existing order.

Thresholds must be non-negative decimal strings, with up to 12 integer digits
and 2 decimal places. Invalid thresholds or sort values return HTTP 400.
Filtering, sorting and the matching total count run in the database before
pagination.

Pending amount is the sum of positive balances on non-deleted treatments in the
patient's clinic. Each treatment's balance uses its final fee after discounts,
less non-deleted payments and credit adjustments, plus refunds. Treatment status
does not write off its balance. Overpayment on one treatment does not cancel
another treatment's pending balance. Patients without treatments have zero due.

Deploy the backend along with the updated Flutter app; no database migration is
required. Run `npm test` for isolated PostgreSQL tests and `npm run build` for the
TypeScript check. Tests use only an in-memory PGlite database.
