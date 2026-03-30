function excelColLetter(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

export function resolveLeaseScheduleLayout(exportModel) {
  const assumptionStartRow = 5;
  const assumptionLabelCol = 1;
  const assumptionValueCol = 2;
  const assumptionAmountCol = 3;
  const concessionStartCol = 5;

  const assumptionEntries = exportModel.assumptionEntries.map((entry, index) => {
    const row = assumptionStartRow + index;
    return {
      ...entry,
      row,
      address: `$C$${row}`,
      amountAddress: `$D$${row}`,
    };
  });

  const cellMap = Object.fromEntries(
    assumptionEntries.map((entry) => [entry.id, entry.address]),
  );

  const colByKey = Object.fromEntries(
    exportModel.columns.map((column) => [column.key, column]),
  );

  const leftAssumptionLastRow = assumptionEntries[assumptionEntries.length - 1]?.row ?? assumptionStartRow - 1;
  const abatementTable = {
    headerRow: assumptionStartRow,
    dataStartRow: assumptionStartRow + 1,
    dataEndRow: assumptionStartRow + 10,
    totalRow: assumptionStartRow + 11,
    labelCol: concessionStartCol,
    dateCol: concessionStartCol + 1,
    monthCol: concessionStartCol + 2,
    amountCol: concessionStartCol + 3,
    pctCol: concessionStartCol + 4,
  };
  const freeRentTable = {
    headerRow: abatementTable.totalRow + 3,
    dataStartRow: abatementTable.totalRow + 4,
    dataEndRow: abatementTable.totalRow + 13,
    totalRow: abatementTable.totalRow + 14,
    labelCol: concessionStartCol,
    dateCol: concessionStartCol + 1,
    monthCol: concessionStartCol + 2,
    amountCol: concessionStartCol + 3,
  };

  abatementTable.monthRange = `$${excelColLetter(abatementTable.monthCol)}$${abatementTable.dataStartRow}:$${excelColLetter(abatementTable.monthCol)}$${abatementTable.dataEndRow}`;
  abatementTable.dateRange = `$${excelColLetter(abatementTable.dateCol)}$${abatementTable.dataStartRow}:$${excelColLetter(abatementTable.dateCol)}$${abatementTable.dataEndRow}`;
  abatementTable.amountRange = `$${excelColLetter(abatementTable.amountCol)}$${abatementTable.dataStartRow}:$${excelColLetter(abatementTable.amountCol)}$${abatementTable.dataEndRow}`;
  abatementTable.pctRange = `$${excelColLetter(abatementTable.pctCol)}$${abatementTable.dataStartRow}:$${excelColLetter(abatementTable.pctCol)}$${abatementTable.dataEndRow}`;
  abatementTable.totalAmountAddress = `$${excelColLetter(abatementTable.amountCol)}$${abatementTable.totalRow}`;

  freeRentTable.monthRange = `$${excelColLetter(freeRentTable.monthCol)}$${freeRentTable.dataStartRow}:$${excelColLetter(freeRentTable.monthCol)}$${freeRentTable.dataEndRow}`;
  freeRentTable.dateRange = `$${excelColLetter(freeRentTable.dateCol)}$${freeRentTable.dataStartRow}:$${excelColLetter(freeRentTable.dateCol)}$${freeRentTable.dataEndRow}`;
  freeRentTable.amountRange = `$${excelColLetter(freeRentTable.amountCol)}$${freeRentTable.dataStartRow}:$${excelColLetter(freeRentTable.amountCol)}$${freeRentTable.dataEndRow}`;
  freeRentTable.totalAmountAddress = `$${excelColLetter(freeRentTable.amountCol)}$${freeRentTable.totalRow}`;

  const assumptionLastRow = Math.max(leftAssumptionLastRow, freeRentTable.totalRow);
  const scenarioGroupRow = assumptionLastRow + 2;
  const headerRow = scenarioGroupRow + 1;
  const firstDataRow = headerRow + 1;
  const lastDataRow = firstDataRow + exportModel.rows.length - 1;
  const totalsRow = lastDataRow + 1;
  const noteRow = totalsRow + 2;
  const lastCol = exportModel.columns[exportModel.columns.length - 1]?.index ?? 0;

  const otEntries = assumptionEntries.filter((entry) => entry.kind === 'ot_item');
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
    scenarioColumns: exportModel.columns.filter((column) => column.group === 'scenario'),
    nrcColumn: exportModel.columns.find((column) => column.group === 'nrc') ?? null,
    nrcDateRange,
    nrcAmountRange,
    concessionStartCol,
    abatementTable,
    freeRentTable,
    leftAssumptionLastRow,
    assumptionLastRow,
    scenarioGroupRow,
    headerRow,
    firstDataRow,
    lastDataRow,
    totalsRow,
    noteRow,
    lastCol,
  };
}
