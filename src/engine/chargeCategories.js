/**
 * Charge Category Registry — single source of truth for all NNN and other
 * charge types. Used by the calculator, export, and UI to dynamically
 * build columns, assumption rows, and formulas.
 *
 * Adding a new category (e.g., adminExpense) means adding one entry here.
 */

export const CHARGE_CATEGORIES = [
  {
    key:              'cams',
    displayLabel:     'CAMS',
    group:            'nnn',              // included in Total NNN sum
    amountField:      'camsAmount',       // field name on calculator output rows
    escYearsField:    'camsEscYears',
    activeField:      'camsActive',
    paramKey:         'cams',             // key in params object
    assumptionLabels: {
      year1:   'CAMS Year 1 Monthly Amount',
      escRate: 'CAMS Annual Escalation Rate (%)',
    },
    colWidth:         12,
  },
  {
    key:              'insurance',
    displayLabel:     'Insurance',
    group:            'nnn',
    amountField:      'insuranceAmount',
    escYearsField:    'insuranceEscYears',
    activeField:      'insuranceActive',
    paramKey:         'insurance',
    assumptionLabels: {
      year1:   'Insurance Year 1 Monthly Amount',
      escRate: 'Insurance Annual Escalation Rate (%)',
    },
    colWidth:         12,
  },
  {
    key:              'taxes',
    displayLabel:     'Taxes',
    group:            'nnn',
    amountField:      'taxesAmount',
    escYearsField:    'taxesEscYears',
    activeField:      'taxesActive',
    paramKey:         'taxes',
    assumptionLabels: {
      year1:   'Taxes Year 1 Monthly Amount',
      escRate: 'Taxes Annual Escalation Rate (%)',
    },
    colWidth:         12,
  },
  {
    key:              'security',
    displayLabel:     'Security',
    group:            'otherCharge',      // NOT included in Total NNN
    amountField:      'securityAmount',
    escYearsField:    'securityEscYears',
    activeField:      'securityActive',
    paramKey:         'security',
    assumptionLabels: {
      year1:   'Security Year 1 Monthly Amount',
      escRate: 'Security Annual Escalation Rate (%)',
    },
    colWidth:         12,
  },
  {
    key:              'otherItems',
    displayLabel:     'Other Items',
    group:            'otherCharge',
    amountField:      'otherItemsAmount',
    escYearsField:    'otherItemsEscYears',
    activeField:      'otherItemsActive',
    paramKey:         'otherItems',
    assumptionLabels: {
      year1:   'Other Items Year 1 Monthly Amount',
      escRate: 'Other Items Annual Escalation Rate (%)',
    },
    colWidth:         12,
  },
];

/**
 * Determine which charge categories are active for a given lease.
 * A category is active if any processed row has a non-zero amount
 * or if the user provided a non-zero year1 value in params.
 *
 * In aggregate NNN mode, individual NNN categories (cams, insurance, taxes)
 * are excluded — replaced by a single aggregate NNN column.
 */
export function getActiveCategories(rows, params, nnnMode) {
  return CHARGE_CATEGORIES.filter((cat) => {
    // In aggregate mode, individual NNN buckets are replaced by aggregate column
    if (nnnMode === 'aggregate' && cat.group === 'nnn') return false;

    const hasData  = rows.some((r) => (r[cat.amountField] ?? 0) !== 0);
    const hasParam = Number(params[cat.paramKey]?.year1) > 0;
    return hasData || hasParam;
  });
}

/**
 * All bucket keys in registry order — drop-in replacement for NNN_BUCKET_KEYS.
 */
export const ALL_BUCKET_KEYS = CHARGE_CATEGORIES.map((c) => c.key);

/**
 * Build the dynamic column layout for the ledger export.
 *
 * Returns an array of column descriptors, each with:
 *   { key, header, width, group, index, letter, catDef? }
 *
 * Groups: 'fixed' | 'nnn' | 'otherCharge' | 'totalNNN' | 'oneTime' | 'tail'
 */
export function buildColumnLayout(activeCategories, otLabels, nnnMode) {
  const columns = [];

  // --- Fixed prefix (always present) ---
  columns.push(
    { key: 'periodStart',      header: 'Period\nStart',           width: 13, group: 'fixed' },
    { key: 'periodEnd',        header: 'Period\nEnd',             width: 35, group: 'fixed' },
    { key: 'monthNum',         header: 'Month\n#',                width: 9,  group: 'fixed' },
    { key: 'yearNum',          header: 'Year\n#',                 width: 9,  group: 'fixed' },
    { key: 'scheduledBaseRent',header: 'Scheduled\nBase Rent',    width: 20, group: 'fixed' },
    { key: 'baseRentApplied',  header: 'Base Rent\nApplied',      width: 20, group: 'fixed' },
  );

  // --- NNN charge columns (conditional) ---
  if (nnnMode === 'aggregate') {
    columns.push({
      key: 'nnnAggregate',
      header: 'NNN\n(Combined)',
      width: 14,
      group: 'nnn',
    });
  } else {
    for (const cat of activeCategories.filter((c) => c.group === 'nnn')) {
      columns.push({
        key:     cat.key,
        header:  cat.displayLabel,
        width:   cat.colWidth,
        group:   'nnn',
        catDef:  cat,
      });
    }
  }

  // --- Other charge columns (conditional) ---
  for (const cat of activeCategories.filter((c) => c.group === 'otherCharge')) {
    columns.push({
      key:     cat.key,
      header:  cat.displayLabel,
      width:   cat.colWidth,
      group:   'otherCharge',
      catDef:  cat,
    });
  }

  // --- Total NNN (always present) ---
  columns.push({
    key: 'totalNNN',
    header: 'Total NNN \u2460',
    width: 14,
    group: 'totalNNN',
  });

  // --- One-time item columns (dynamic) ---
  for (const lbl of otLabels) {
    columns.push({
      key:     `ot_${lbl}`,
      header:  lbl,
      width:   22,
      group:   'oneTime',
      otLabel: lbl,
    });
  }

  // --- Tail columns (always present) ---
  columns.push(
    { key: 'totalMonthly', header: 'Total Monthly\nObligation \u2461', width: 22, group: 'tail' },
    { key: 'effSF',        header: 'Effective\n$/SF',                   width: 14, group: 'tail' },
    { key: 'obligRem',     header: 'Obligation\nRemaining',             width: 22, group: 'tail' },
    { key: 'baseRem',      header: 'Base Rent\nRemaining',              width: 20, group: 'tail' },
    { key: 'nnnRem',       header: 'NNN\nRemaining',                    width: 16, group: 'tail' },
    { key: 'otherRem',     header: 'Other Charges\nRemaining',          width: 22, group: 'tail' },
  );

  // --- Assign indices and Excel column letters ---
  return columns.map((col, idx) => ({
    ...col,
    index:  idx,
    letter: colIndexToLetter(idx),
  }));
}

/**
 * Convert 0-based column index to Excel column letter(s).
 * 0 → 'A', 25 → 'Z', 26 → 'AA', etc.
 */
export function colIndexToLetter(idx) {
  let s = '';
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}
