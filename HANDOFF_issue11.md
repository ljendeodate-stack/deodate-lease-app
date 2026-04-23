# Codex Handoff — Issue #11: Ledger columns from all rows

## Task
Fix `LedgerTable.jsx` so that one-time item charges each appear as their own column in the preview ledger, mirroring the XLSX export behavior. Currently a single aggregated "One-Time" column hides individual labels; charges firing after row 0 are invisible in the preview table.

## File to modify
`src/components/LedgerTable.jsx`

## Reference implementation (do not change)
`src/export/model/buildExportModel.js` — `deriveOneTimeLabels(rows)` (lines 206–219) already does the correct all-rows scan for the XLSX export. Mirror this logic.

---

## Changes required

### 1. Add `otLabels` memo (alongside existing `chargeColumns` memo)

```js
const otLabels = useMemo(() => {
  const seen = new Set();
  const labels = [];
  for (const row of rows) {
    for (const [label, amount] of Object.entries(row.oneTimeItemAmounts ?? {})) {
      if (amount > 0 && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }
    }
  }
  return labels;
}, [rows]);
```

### 2. Fix `totalColSpan`

The current value includes a `+7` that accounts for the single One-Time slot. Change it to `+6 + otLabels.length`.

### 3. Replace the static `<Th>One-Time</Th>` header

```jsx
{otLabels.map((label) => (
  <Th key={label}>{label}</Th>
))}
```

### 4. Replace the static One-Time `<Td>` cell

Remove the existing block that renders `row.oneTimeChargesAmount` with a tooltip. Replace with:

```jsx
{otLabels.map((label) => {
  const amount = row.oneTimeItemAmounts?.[label] ?? 0;
  return (
    <Td key={label}>
      {amount !== 0 ? (
        <span className={amount < 0 ? 'text-status-ok-text' : ''}>
          {formatDollar(amount)}
        </span>
      ) : (
        <span className="text-txt-faint">-</span>
      )}
    </Td>
  );
})}
```

---

## Verification
1. `npm run dev`
2. Upload a lease with ≥1 one-time item that fires mid-lease (not month 1).
3. Each distinct label must appear as its own column header in the preview ledger.
4. Rows without that charge must show `-`.
5. Leases with zero one-time items must render no extra column (no regression).
6. XLSX export is unchanged — no edits needed there.
