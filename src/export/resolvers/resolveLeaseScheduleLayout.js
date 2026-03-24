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

  const assumptionEntries = exportModel.assumptionEntries.map((entry, index) => {
    const row = assumptionStartRow + index;
    return {
      ...entry,
      row,
      address: `$C$${row}`,
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

  return {
    assumptionStartRow,
    assumptionLabelCol,
    assumptionValueCol,
    assumptionEntries,
    cellMap,
    colByKey,
    nnnColumns: exportModel.columns.filter((column) => column.group === 'nnn'),
    otherChargeColumns: exportModel.columns.filter((column) => column.group === 'otherCharge'),
    otColumns: exportModel.columns.filter((column) => column.group === 'oneTime'),
    assumptionLastRow,
    headerRow,
    firstDataRow,
    lastDataRow,
    totalsRow,
    noteRow,
    lastCol,
  };
}
