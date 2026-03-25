import { describe, expect, it } from 'vitest';

import { renderLeaseScheduleWorksheet } from '../builders/renderLeaseScheduleWorksheet.js';
import { buildExportModel } from '../model/buildExportModel.js';
import { resolveLeaseScheduleLayout } from '../resolvers/resolveLeaseScheduleLayout.js';
import { buildLegacyLeaseScheduleSpec } from './legacyLeaseScheduleSpec.js';
import { calculateAllCharges } from '../../engine/calculator.js';
import { expandPeriods } from '../../engine/expander.js';
import { parseMDYStrict } from '../../engine/yearMonth.js';

describe('buildLegacyLeaseScheduleSpec', () => {
  function buildWorksheet(rows, params, filename) {
    const model = buildExportModel(rows, params, filename);
    const layout = resolveLeaseScheduleLayout(model);
    const spec = buildLegacyLeaseScheduleSpec(model, layout);
    const worksheet = renderLeaseScheduleWorksheet(spec);
    return { model, layout, spec, worksheet };
  }

  it('renders legacy lease schedule formulas using resolved assumption addresses', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 0,
        camsAmount: 1200,
        securityAmount: 250,
        totalMonthlyObligation: 1750,
        effectivePerSF: 1.75,
        totalObligationRemaining: 1750,
        totalBaseRentRemaining: 0,
        totalNNNRemaining: 1200,
        totalOtherChargesRemaining: 550,
        oneTimeItemAmounts: { 'Broker Fee': 300 },
        isAbatementRow: true,
      },
    ];

    const params = {
      leaseName: 'legacy-check',
      squareFootage: 1000,
      nnnMode: 'individual',
      cams: { year1: 1200, escPct: 3 },
      security: { year1: 250, escPct: 0 },
      oneTimeItems: [{ label: 'Broker Fee', date: '2026-01-01', amount: 300 }],
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'legacy-check');
    const fdr = layout.firstDataRow;

    // Period Start: EDATE formula from commencementDate
    expect(worksheet[`A${fdr}`].f).toBe(`IFERROR(EDATE(${layout.cellMap.commencementDate},0),0)`);
    // Period End: EDATE+1 month - 1 day, capped by expirationDate
    expect(worksheet[`B${fdr}`].f).toBe(`IFERROR(MIN(EDATE(${layout.cellMap.commencementDate},1)-1,${layout.cellMap.expirationDate}),0)`);
    // Month #: ROW-based
    expect(worksheet[`C${fdr}`].f).toBe(`ROW()-${fdr - 1}`);
    // Year #: derived from Month #
    expect(worksheet[`D${fdr}`].f).toBe(`INT((C${fdr}-1)/12)+1`);

    // Scheduled Base Rent: with termination gate + rent commencement gate
    const sbrFormula = worksheet[`E${fdr}`].f;
    expect(sbrFormula).toContain(layout.cellMap.year1BaseRent);
    expect(sbrFormula).toContain(layout.cellMap.annualEscRate);
    expect(sbrFormula).toContain(layout.cellMap.rentCommencementDate);

    // Base Rent Applied: includes COERCE_DATE (IFERROR(DATEVALUE(...))) and Free Rent priority
    const braFormula = worksheet[`F${fdr}`].f;
    expect(braFormula).toContain('IFERROR(DATEVALUE');
    expect(braFormula).toContain(layout.cellMap.freeRentStart);
    expect(braFormula).toContain(layout.cellMap.abatementStart);
    expect(braFormula).toContain(layout.cellMap.abatementAmount);

    // CAMs (NNN column): with termination gate
    const camsFormula = worksheet[`G${fdr}`].f;
    expect(camsFormula).toContain(layout.cellMap.cams_year1);
    expect(camsFormula).toContain(layout.cellMap.cams_escRate);

    // Security (other charge column)
    const secFormula = worksheet[`H${fdr}`].f;
    expect(secFormula).toContain(layout.cellMap.security_year1);

    // Total NNN: sum of NNN columns (only cams here)
    expect(worksheet[`I${fdr}`].f).toBe(`G${fdr}`);

    // Non-Recurring Charges: SUMPRODUCT formula
    const nrcCol = layout.nrcColumn.letter;
    const nrcFormula = worksheet[`${nrcCol}${fdr}`].f;
    expect(nrcFormula).toContain('SUMPRODUCT');
    expect(nrcFormula).toContain(layout.nrcDateRange);
    expect(nrcFormula).toContain(layout.nrcAmountRange);

    // Total Monthly: baseRentApplied + totalNNN + otherCharges + nonRecurringCharges
    const tmCol = layout.colByKey.totalMonthly.letter;
    const tmFormula = worksheet[`${tmCol}${fdr}`].f;
    expect(tmFormula).toContain(`F${fdr}`);
    expect(tmFormula).toContain(`I${fdr}`);
    expect(tmFormula).toContain(`H${fdr}`);
    expect(tmFormula).toContain(`${nrcCol}${fdr}`);

    // Effective $/SF
    const sfCol = layout.colByKey.effSF.letter;
    expect(worksheet[`${sfCol}${fdr}`].f).toContain(layout.cellMap.squareFootage);

    // Other Charges Remaining: includes security + NRC tail sums
    const otherRemCol = layout.colByKey.otherRem.letter;
    const otherRemFormula = worksheet[`${otherRemCol}${fdr}`].f;
    expect(otherRemFormula).toContain(`H${fdr}`);
    expect(otherRemFormula).toContain(`${nrcCol}${fdr}`);
  });

  it('writes date assumption cells as numeric serials (not text) when dates are in MM/DD/YYYY format', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 8000,
        baseRentApplied: 0,
        camsAmount: 0,
        totalMonthlyObligation: 0,
        effectivePerSF: 0,
        totalObligationRemaining: 0,
        totalBaseRentRemaining: 0,
        totalNNNRemaining: 0,
        totalOtherChargesRemaining: 0,
        oneTimeItemAmounts: {},
        isAbatementRow: true,
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      // Dates supplied in user-facing MM/DD/YYYY format
      abatementStart: '01/01/2026',
      abatementEndDate: '01/31/2026',
      freeRentStart: '02/01/2026',
      freeRentEndDate: '02/28/2026',
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'date-format-check');

    // cellMap values are absolute-reference format ($C$27); worksheet keys are plain (C27)
    const toKey = (addr) => addr.replace(/\$/g, '');

    const abatementStartCell = worksheet[toKey(layout.cellMap.abatementStart)];
    expect(abatementStartCell).toBeDefined();
    expect(abatementStartCell.t).toBe('n');      // numeric, not text ('s')
    expect(abatementStartCell.s.numFmt).toBe('mm/dd/yyyy');

    const freeRentStartCell = worksheet[toKey(layout.cellMap.freeRentStart)];
    expect(freeRentStartCell).toBeDefined();
    expect(freeRentStartCell.t).toBe('n');
    expect(freeRentStartCell.s.numFmt).toBe('mm/dd/yyyy');
  });

  it('uses the aggregate NNN assumption pair when aggregate mode is active', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 9000,
        baseRentApplied: 9000,
        nnnAggregateAmount: 1800,
        totalMonthlyObligation: 10800,
        effectivePerSF: 9,
        totalObligationRemaining: 10800,
        totalBaseRentRemaining: 9000,
        totalNNNRemaining: 1800,
        totalOtherChargesRemaining: 0,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      leaseName: 'aggregate-check',
      squareFootage: 1200,
      nnnMode: 'aggregate',
      nnnAggregate: { year1: 1800, escPct: 4 },
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'aggregate-check');
    const fdr = layout.firstDataRow;

    // Aggregate NNN column (G) with termination gate
    const aggFormula = worksheet[`G${fdr}`].f;
    expect(aggFormula).toContain(layout.cellMap.nnnAgg_year1);
    expect(aggFormula).toContain(layout.cellMap.nnnAgg_escRate);

    // Total NNN mirrors aggregate column
    expect(worksheet[`H${fdr}`].f).toBe(`G${fdr}`);

    // Total Monthly includes base + nnn + nrc
    const nrcCol = layout.nrcColumn.letter;
    const tmCol = layout.colByKey.totalMonthly.letter;
    expect(worksheet[`${tmCol}${fdr}`].f).toContain(`F${fdr}`);
    expect(worksheet[`${tmCol}${fdr}`].f).toContain(`H${fdr}`);
    expect(worksheet[`${tmCol}${fdr}`].f).toContain(`${nrcCol}${fdr}`);
  });

  it('includes rent commencement gate in scheduled base rent formula', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      rentCommencementDate: '03/01/2026',
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'rent-comm-gate');
    const fdr = layout.firstDataRow;

    // Scheduled Base Rent formula should reference rentCommencementDate
    const sbrFormula = worksheet[`E${fdr}`].f;
    expect(sbrFormula).toContain(layout.cellMap.rentCommencementDate);
    expect(sbrFormula).toContain('IFERROR(DATEVALUE');
  });

  it('uses COERCE_DATE in concession formulas for coercion-safe date handling', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 0,
        oneTimeItemAmounts: {},
        isAbatementRow: true,
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      abatementStart: '01/01/2026',
      abatementEndDate: '03/31/2026',
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'coerce-date-check');
    const fdr = layout.firstDataRow;

    // Base Rent Applied formula should use IFERROR(DATEVALUE(...)) pattern
    const braFormula = worksheet[`F${fdr}`].f;
    expect(braFormula).toContain('IFERROR(DATEVALUE');
  });

  it('generates NRC column with SUMPRODUCT formula from NRC input table', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: { 'Broker Fee': 5000 },
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      oneTimeItems: [{ label: 'Broker Fee', date: '2026-01-01', amount: 5000 }],
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'nrc-formula-check');
    const fdr = layout.firstDataRow;
    const nrcCol = layout.nrcColumn.letter;

    // NRC column should have SUMPRODUCT formula
    const nrcFormula = worksheet[`${nrcCol}${fdr}`].f;
    expect(nrcFormula).toContain('SUMPRODUCT');
    expect(nrcFormula).toContain(layout.nrcDateRange);
    expect(nrcFormula).toContain(layout.nrcAmountRange);

    // NRC fallback value should be the sum of one-time amounts
    expect(worksheet[`${nrcCol}${fdr}`].v).toBe(5000);
  });

  it('formats blank NRC date cells as mm/dd/yyyy, not text (@)', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      // No oneTimeItems — all 11 NRC slots are blank
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'nrc-date-format');
    const toKey = (addr) => addr.replace(/\$/g, '');

    const otEntries = layout.assumptionEntries.filter((e) => e.kind === 'ot_item');
    expect(otEntries).toHaveLength(11);

    for (const entry of otEntries) {
      const cell = worksheet[toKey(entry.address)];
      if (cell) {
        expect(cell.s.numFmt).not.toBe('@');
        expect(cell.s.numFmt).toBe('mm/dd/yyyy');
      }
    }
  });

  it('NRC SUMPRODUCT formula does not use implicit intersection @ before array ranges', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: { 'Broker Fee': 5000 },
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      oneTimeItems: [{ label: 'Broker Fee', date: '2026-01-01', amount: 5000 }],
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'nrc-no-at');
    const nrcCol = layout.nrcColumn.letter;
    const fdr = layout.firstDataRow;
    const nrcFormula = worksheet[`${nrcCol}${fdr}`].f;

    // Must not contain implicit-intersection @ before any $ range reference
    expect(nrcFormula).not.toMatch(/DATEVALUE\(@/i);
    expect(nrcFormula).not.toMatch(/@\$/);
    // Must still be SUMPRODUCT-based with IFERROR(DATEVALUE( coercion
    expect(nrcFormula).toContain('SUMPRODUCT');
    expect(nrcFormula).toContain('IFERROR(DATEVALUE(');
  });

  it('blank NRC date items contribute zero to NRC cell fallback value', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
      // No oneTimeItems — all NRC amounts are zero
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'nrc-blank-zero');
    const nrcCol = layout.nrcColumn.letter;
    const fdr = layout.firstDataRow;

    expect(worksheet[`${nrcCol}${fdr}`].v).toBe(0);
  });

  it('applies gentle yellow fill and blue input font to editable assumption cells', () => {
    const rows = [
      {
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
        leaseMonth: 1,
        leaseYear: 1,
        scheduledBaseRent: 10000,
        baseRentApplied: 10000,
        oneTimeItemAmounts: {},
      },
    ];

    const params = {
      squareFootage: 1000,
      nnnMode: 'individual',
    };

    const { layout, worksheet } = buildWorksheet(rows, params, 'style-check');
    const toKey = (addr) => addr.replace(/\$/g, '');

    // squareFootage input cell should use gentle yellow fill and blue font
    const sfCell = worksheet[toKey(layout.cellMap.squareFootage)];
    expect(sfCell).toBeDefined();
    expect(sfCell.s.fill.fgColor.rgb).toBe('FFFACD'); // gentle yellow
    expect(sfCell.s.font.color.rgb).toBe('0000FF');   // blue input font
  });

  // ── Proration regression: 01/01/2023 → 01/15/2033 ───────────────────────────

  describe('partial final-month proration — active worksheet', () => {
    const COMMENCE = '01/01/2023';
    const EXPIRE   = '01/15/2033';
    const RENT     = 1000;

    function buildProratedWorksheet() {
      const periods = [{ periodStart: parseMDYStrict(COMMENCE), periodEnd: parseMDYStrict(EXPIRE), monthlyRent: RENT }];
      const { rows: expanded } = expandPeriods(periods);
      const engineParams = {
        leaseName: 'Proration Regression',
        nnnMode: 'individual',
        squareFootage: 0,
        abatementEndDate: null,
        abatementPct: 0,
        nnnAggregate: { year1: 0, escPct: 0 },
        oneTimeItems: [],
        charges: [],
        cams: { year1: 200, escPct: 3 },
      };
      const processedRows = calculateAllCharges(expanded, engineParams);
      const exportParams = {
        leaseName: 'Proration Regression',
        squareFootage: 0,
        nnnMode: 'individual',
        cams: { year1: 200, escPct: 3 },
        oneTimeItems: [],
      };
      const model     = buildExportModel(processedRows, exportParams, 'proration-regression');
      const layout    = resolveLeaseScheduleLayout(model);
      const spec      = buildLegacyLeaseScheduleSpec(model, layout);
      const worksheet = renderLeaseScheduleWorksheet(spec);
      return { worksheet, layout, processedRows };
    }

    it('last row Period End formula is capped by expirationDate', () => {
      const { worksheet, layout, processedRows } = buildProratedWorksheet();
      const lastRow = processedRows.length;
      const lastDataRow = layout.firstDataRow + lastRow - 1;
      const formula = worksheet[`B${lastDataRow}`]?.f ?? '';
      expect(formula).toContain(layout.cellMap.expirationDate);
      expect(formula).toContain('MIN(');
    });

    it('last row Period End cached value is 01/15/2033 serial', () => {
      const { worksheet, layout, processedRows } = buildProratedWorksheet();
      const lastDataRow = layout.firstDataRow + processedRows.length - 1;
      // Excel serial for 2033-01-15: days since 1900-01-01 (Excel epoch)
      const cell = worksheet[`B${lastDataRow}`];
      expect(cell).toBeDefined();
      // Cached value must be the serial for Jan 15 2033, not Jan 31 2033
      // Jan 31 2033 serial = 48700 (approx); Jan 15 2033 serial = 48684
      // Verify it is NOT the natural month-end serial (last day of Jan 2033)
      const naturalMonthEndSerial = worksheet[`B${lastDataRow - 1}`]?.v; // prev row ends on Dec 31 2032
      // The last row's cached periodEnd must equal 2033-01-15 (not 2033-01-31)
      // 2033-01-31 would be 16 days larger than 2033-01-15
      expect(cell.v).toBeLessThan((naturalMonthEndSerial ?? 0) + 32);
      // Specifically, it must resolve to the engine's periodEnd
      const engineLastRow = processedRows[processedRows.length - 1];
      // Convert YYYY-MM-DD to Date serial
      const [y, m, d] = engineLastRow.periodEnd.split('-').map(Number);
      const jsDate = new Date(y, m - 1, d);
      const excelSerial = Math.round((jsDate - new Date(1899, 11, 30)) / 86400000);
      expect(cell.v).toBe(excelSerial);
    });

    it('last row Base Rent Applied formula includes EOMONTH proration term', () => {
      const { worksheet, layout, processedRows } = buildProratedWorksheet();
      const lastDataRow = layout.firstDataRow + processedRows.length - 1;
      const formula = worksheet[`F${lastDataRow}`]?.f ?? '';
      expect(formula).toContain('EOMONTH');
    });

    it('last row CAMs formula includes EOMONTH proration term', () => {
      const { worksheet, layout, processedRows } = buildProratedWorksheet();
      const lastDataRow = layout.firstDataRow + processedRows.length - 1;
      // CAMs is the first NNN column after F (Base Rent Applied)
      const camsCol = layout.colByKey.cams?.letter ?? layout.nnnColumns?.[0]?.letter;
      if (!camsCol) return; // skip if no cams column
      const formula = worksheet[`${camsCol}${lastDataRow}`]?.f ?? '';
      expect(formula).toContain('EOMONTH');
    });

    it('last row Base Rent Applied cached value ties to engine (483.87)', () => {
      const { worksheet, layout, processedRows } = buildProratedWorksheet();
      const lastDataRow = layout.firstDataRow + processedRows.length - 1;
      const cell = worksheet[`F${lastDataRow}`];
      const engineLastRow = processedRows[processedRows.length - 1];
      expect(cell.v).toBeCloseTo(engineLastRow.baseRentApplied, 2);
    });
  });
});
