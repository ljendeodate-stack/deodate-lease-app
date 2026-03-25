/**
 * Resolve row offsets and symbolic addresses for the legacy Lease Schedule tab.
 *
 * @param {import('../types.js').ExportModel} exportModel
 * @returns {import('../types.js').LeaseScheduleLayout}
 */
export function resolveLeaseScheduleLayout(exportModel) {
  const assumptionStartRow = 5;
  const assumptionLabelCol = 1;
  const assumptionValueCol = 2;
  const assumptionAmountCol = 3; // col D for NRC amounts

  const assumptionEntries = exportModel.assumptionEntries.map((entry, index) => {
    const row = assumptionStartRow + index;
    return {
      ...entry,
      row,
      address: `$C$${row}`,
      amountAddress: `$D$${row}`, // NRC amount column
    };
  });

  const cellMap = Object.fromEntries(
    assumptionEntries.map((entry) => [entry.id, entry.address]),
  );

  const colByKey = Object.fromEntries(
    exportModel.columns.map((column) => [column.key, column]),
  );

  const assumptionLastRow = assumptionEntries[assumptionEntries.length - 1]?.row ?? assumptionStartRow - 1;
  const headerRow = assumptionLastRow + 2;
  const firstDataRow = headerRow + 1;
  const lastDataRow = firstDataRow + exportModel.rows.length - 1;
  const totalsRow = lastDataRow + 1;
  const noteRow = totalsRow + 2;
  const lastCol = exportModel.columns[exportModel.columns.length - 1]?.index ?? 0;

  // NRC input table ranges — OT entries have kind === 'ot_item'
  const otEntries = assumptionEntries.filter((e) => e.kind === 'ot_item');
  const nrcDateRange = otEntries.length > 0
    ? `$C$${otEntries[0].row}:$C$${otEntries[otEntries.length - 1].row}`
    : null;
  const nrcAmountRange = otEntries.length > 0
    ? `$D$${otEntries[0].row}:$D$${otEntries[otEntries.length - 1].row}`
    : null;

  return {
    assumptionStartRow,
    assumptionLabelCol,
    assumptionValueCol,
    assumptionAmountCol,
    assumptionEntries,
    cellMap,
    colByKey,
    nnnColumns: exportModel.columns.filter((column) => column.group === 'nnn'),
    otherChargeColumns: exportModel.columns.filter((column) => column.group === 'otherCharge'),
    nrcColumn: exportModel.columns.find((column) => column.group === 'nrc') ?? null,
    nrcDateRange,
    nrcAmountRange,
    assumptionLastRow,
    headerRow,
    firstDataRow,
    lastDataRow,
    totalsRow,
    noteRow,
    lastCol,
  };
}
