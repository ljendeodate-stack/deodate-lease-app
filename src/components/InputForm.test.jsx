import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import InputForm from './InputForm.jsx';
import { parseMDYStrict } from '../engine/yearMonth.js';

const noop = vi.fn();

function buildSemanticSchedule() {
  return {
    preferredCandidateId: 'relative_month_ranges_1',
    materializationStatus: 'needs_anchor',
    candidates: [
      {
        id: 'relative_month_ranges_1',
        representationType: 'relative_month_ranges',
        terms: [
          { startMonth: 1, endMonth: 6, monthlyRent: 0 },
          { startMonth: 7, endMonth: 60, monthlyRent: 23149.25 },
        ],
      },
    ],
  };
}

describe('InputForm semantic schedule preview', () => {
  it('shows the date-mapping preview while a semantic schedule still needs an anchor', () => {
    const html = renderToStaticMarkup(
      <InputForm
        initialValues={{ rentCommencementDate: '06/26/2024' }}
        confidenceFlags={[]}
        notices={[]}
        validationErrors={[]}
        sfRequired={false}
        leaseStartDate={null}
        leaseEndDate={null}
        resolvedRows={[]}
        schedulePeriodRows={[]}
        scheduledBaseRent={null}
        expandedRowCount={0}
        semanticSchedule={buildSemanticSchedule()}
        scheduleMaterializationMode="semantic"
        onSubmit={noop}
        onBack={noop}
        onBackToSchedule={noop}
        onDraftChange={noop}
        isProcessing={false}
      />,
    );

    expect(html).toContain('Schedule Date Mapping');
    expect(html).toContain('Months 1-6');
    expect(html).toContain('06/26/2024 - 12/25/2024');
  });

  it('hides the date-mapping preview once a dated schedule has already been loaded', () => {
    const html = renderToStaticMarkup(
      <InputForm
        initialValues={{ rentCommencementDate: '06/26/2024' }}
        confidenceFlags={[]}
        notices={[]}
        validationErrors={[]}
        sfRequired={false}
        leaseStartDate={parseMDYStrict('06/26/2024')}
        leaseEndDate={parseMDYStrict('06/25/2029')}
        resolvedRows={[]}
        schedulePeriodRows={[
          {
            periodStart: parseMDYStrict('06/26/2024'),
            periodEnd: parseMDYStrict('12/25/2024'),
            monthlyRent: 0,
          },
          {
            periodStart: parseMDYStrict('12/26/2024'),
            periodEnd: parseMDYStrict('06/25/2029'),
            monthlyRent: 23149.25,
          },
        ]}
        scheduledBaseRent={0}
        expandedRowCount={60}
        semanticSchedule={buildSemanticSchedule()}
        scheduleMaterializationMode="explicit"
        onSubmit={noop}
        onBack={noop}
        onBackToSchedule={noop}
        onDraftChange={noop}
        isProcessing={false}
      />,
    );

    expect(html).not.toContain('Schedule Date Mapping');
    expect(html).toContain('Base Rent Schedule');
    expect(html).toContain('06/26/2024');
    expect(html).toContain('12/25/2024');
  });

  it('hides Escalation Start while keeping Billing Start visible in the assumptions UI', () => {
    const html = renderToStaticMarkup(
      <InputForm
        initialValues={{}}
        confidenceFlags={[]}
        notices={[]}
        validationErrors={[]}
        sfRequired={false}
        leaseStartDate={parseMDYStrict('06/26/2024')}
        leaseEndDate={parseMDYStrict('06/25/2029')}
        resolvedRows={[]}
        schedulePeriodRows={[]}
        scheduledBaseRent={null}
        expandedRowCount={0}
        semanticSchedule={null}
        scheduleMaterializationMode={null}
        onSubmit={noop}
        onBack={noop}
        onBackToSchedule={noop}
        onDraftChange={noop}
        isProcessing={false}
      />,
    );

    expect(html).toContain('Billing Start');
    expect(html).not.toContain('Escalation Start');
  });

  it('shows the recurring-charge precaution copy in individual mode', () => {
    const html = renderToStaticMarkup(
      <InputForm
        initialValues={{}}
        confidenceFlags={[]}
        notices={[]}
        validationErrors={[]}
        sfRequired={false}
        leaseStartDate={parseMDYStrict('06/26/2024')}
        leaseEndDate={parseMDYStrict('06/25/2029')}
        resolvedRows={[]}
        schedulePeriodRows={[]}
        scheduledBaseRent={null}
        expandedRowCount={0}
        semanticSchedule={null}
        scheduleMaterializationMode={null}
        onSubmit={noop}
        onBack={noop}
        onBackToSchedule={noop}
        onDraftChange={noop}
        isProcessing={false}
      />,
    );

    expect(html).toContain('>Precaution<');
    expect(html).toContain('Enter a small non-zero placeholder amount now if you may need this NNN or recurring charge later.');
    expect(html).toContain('Blank or $0 rows are intentionally omitted from preview/export.');
  });

  it('shows the recurring-charge precaution copy in aggregate mode', () => {
    const html = renderToStaticMarkup(
      <InputForm
        initialValues={{ nnnMode: 'aggregate' }}
        confidenceFlags={[]}
        notices={[]}
        validationErrors={[]}
        sfRequired={false}
        leaseStartDate={parseMDYStrict('06/26/2024')}
        leaseEndDate={parseMDYStrict('06/25/2029')}
        resolvedRows={[]}
        schedulePeriodRows={[]}
        scheduledBaseRent={null}
        expandedRowCount={0}
        semanticSchedule={null}
        scheduleMaterializationMode={null}
        onSubmit={noop}
        onBack={noop}
        onBackToSchedule={noop}
        onDraftChange={noop}
        isProcessing={false}
      />,
    );

    expect(html).toContain('>Precaution<');
    expect(html).toContain('Enter a small non-zero placeholder amount now if you may need this NNN or recurring charge later.');
    expect(html).toContain('Blank or $0 rows are intentionally omitted from preview/export.');
    expect(html).toContain('Aggregate NNN mode: a single combined NNN estimate replaces individual CAMS, Insurance, and Taxes line items.');
  });
});
