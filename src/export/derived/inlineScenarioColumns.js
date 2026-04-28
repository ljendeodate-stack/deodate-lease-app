import { C } from '../specs/styleTokens.js';

const RENEGO_LABEL_PREFIX = 'Renego: (base rent only)';
const EXIT_LABEL_PREFIX = 'Exit: (base rent, nets, and other obligations)';

export const INLINE_SCENARIO_GROUP_TITLE = 'Renegotiation and Exit';
export const INLINE_SCENARIO_RENEGO_GROUP_TITLE = 'Renegotiation';
export const INLINE_SCENARIO_EXIT_GROUP_TITLE = 'Exit';
export const INLINE_SCENARIO_ORANGE = C.tableHeader;
export const INLINE_SCENARIO_PREVIEW_ORANGE = '#C55A11';
export const INLINE_SCENARIO_RENEGO_GROUP_FILL = C.tableHeader;
export const INLINE_SCENARIO_EXIT_GROUP_FILL = C.sectionBar;
export const INLINE_SCENARIO_RENEGO_GROUP_PREVIEW = '#A95513';
export const INLINE_SCENARIO_EXIT_GROUP_PREVIEW = '#D07A2A';

export const INLINE_SCENARIO_COLUMNS = [
  {
    key: 'renegoBaseOnly10',
    group: 'scenario',
    scenarioGroup: 'renego',
    basis: 'baseRem',
    discountPct: 0.1,
    tierLabel: 'Modest (10%)',
    header: `${RENEGO_LABEL_PREFIX}\nModest (10%)`,
    previewHeader: `${RENEGO_LABEL_PREFIX} Modest (10%)`,
    width: 24,
    headerFill: C.tableHeader,
    bodyFill: C.labelFill,
    previewHeaderFill: '#B66318',
    previewBodyFill: '#FBE2D5',
  },
  {
    key: 'renegoBaseOnly20',
    group: 'scenario',
    scenarioGroup: 'renego',
    basis: 'baseRem',
    discountPct: 0.2,
    tierLabel: 'Material (20%)',
    header: `${RENEGO_LABEL_PREFIX}\nMaterial (20%)`,
    previewHeader: `${RENEGO_LABEL_PREFIX} Material (20%)`,
    width: 24,
    headerFill: C.tableHeader,
    bodyFill: C.altRow,
    previewHeaderFill: '#985114',
    previewBodyFill: '#F7CFB7',
  },
  {
    key: 'renegoBaseOnly30',
    group: 'scenario',
    scenarioGroup: 'renego',
    basis: 'baseRem',
    discountPct: 0.3,
    tierLabel: 'Significant (30%)',
    header: `${RENEGO_LABEL_PREFIX}\nSignificant (30%)`,
    previewHeader: `${RENEGO_LABEL_PREFIX} Significant (30%)`,
    width: 25,
    headerFill: C.tableHeader,
    bodyFill: C.white,
    previewHeaderFill: '#7E410F',
    previewBodyFill: '#F2BA98',
  },
  {
    key: 'exitBaseNetsOther0',
    group: 'scenario',
    scenarioGroup: 'exit',
    basis: 'obligRem',
    discountPct: 0,
    tierLabel: 'Full Obligation (0%)',
    header: `${EXIT_LABEL_PREFIX}\nFull Obligation (0%)`,
    previewHeader: `${EXIT_LABEL_PREFIX} Full Obligation (0%)`,
    width: 28,
    headerFill: C.sectionBar,
    bodyFill: C.labelFill,
    previewHeaderFill: '#DA9B5A',
    previewBodyFill: '#FCE7D8',
  },
  {
    key: 'exitBaseNetsOther20',
    group: 'scenario',
    scenarioGroup: 'exit',
    basis: 'obligRem',
    discountPct: 0.2,
    tierLabel: 'Mild Discount (20%)',
    header: `${EXIT_LABEL_PREFIX}\nMild Discount (20%)`,
    previewHeader: `${EXIT_LABEL_PREFIX} Mild Discount (20%)`,
    width: 28,
    headerFill: C.sectionBar,
    bodyFill: C.altRow,
    previewHeaderFill: '#D18E49',
    previewBodyFill: '#F9DCC8',
  },
  {
    key: 'exitBaseNetsOther30',
    group: 'scenario',
    scenarioGroup: 'exit',
    basis: 'obligRem',
    discountPct: 0.3,
    tierLabel: 'Moderate Discount (30%)',
    header: `${EXIT_LABEL_PREFIX}\nModerate Discount (30%)`,
    previewHeader: `${EXIT_LABEL_PREFIX} Moderate Discount (30%)`,
    width: 30,
    headerFill: C.sectionBar,
    bodyFill: C.white,
    previewHeaderFill: '#C78036',
    previewBodyFill: '#F5D0B8',
  },
  {
    key: 'exitBaseNetsOther40',
    group: 'scenario',
    scenarioGroup: 'exit',
    basis: 'obligRem',
    discountPct: 0.4,
    tierLabel: 'Material Discount (40%)',
    header: `${EXIT_LABEL_PREFIX}\nMaterial Discount (40%)`,
    previewHeader: `${EXIT_LABEL_PREFIX} Material Discount (40%)`,
    width: 29,
    headerFill: C.sectionBar,
    bodyFill: C.labelFill,
    previewHeaderFill: '#BB7024',
    previewBodyFill: '#F0C09F',
  },
  {
    key: 'exitBaseNetsOther50',
    group: 'scenario',
    scenarioGroup: 'exit',
    basis: 'obligRem',
    discountPct: 0.5,
    tierLabel: 'Significant Discount (50%)',
    header: `${EXIT_LABEL_PREFIX}\nSignificant Discount (50%)`,
    previewHeader: `${EXIT_LABEL_PREFIX} Significant Discount (50%)`,
    width: 31,
    headerFill: C.sectionBar,
    bodyFill: C.altRow,
    previewHeaderFill: '#A85C1A',
    previewBodyFill: '#E8AB7C',
  },
];

function roundCurrency(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function coerceCurrency(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function getInlineScenarioBasisValue(row = {}, column) {
  if (!column) return 0;
  if (column.basis === 'baseRem') return coerceCurrency(row.totalBaseRentRemaining);
  return coerceCurrency(row.totalObligationRemaining);
}

export function deriveInlineScenarioValues(row = {}) {
  return Object.fromEntries(
    INLINE_SCENARIO_COLUMNS.map((column) => {
      const basisValue = getInlineScenarioBasisValue(row, column);
      return [column.key, roundCurrency(basisValue * (1 - column.discountPct))];
    }),
  );
}

export function getInlineScenarioValue(row = {}, columnKey) {
  const column = INLINE_SCENARIO_COLUMNS.find((candidate) => candidate.key === columnKey);
  return deriveInlineScenarioValues(row)[column?.key] ?? 0;
}
