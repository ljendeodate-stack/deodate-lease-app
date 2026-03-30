/**
 * ValidationBanner
 * Renders a list of structured validation errors at the top of the form.
 */

export default function ValidationBanner({ errors = [] }) {
  if (!errors.length) return null;

  return (
    <div className="rounded-[1.25rem] border border-status-err-border bg-status-err-bg/92 p-5 shadow-panel">
      <div className="flex items-start gap-4">
        <span className="status-chip border-status-err-border bg-status-err-bg text-status-err-title">
          Validation
        </span>
        <div className="space-y-2">
          <h3 className="font-display text-sm font-semibold tracking-[0.02em] text-status-err-title">
            {errors.length === 1 ? '1 validation error' : `${errors.length} validation errors`} require review before processing.
          </h3>
          <ol className="list-decimal space-y-1 pl-5">
            {errors.map((err, i) => (
              <li key={i} className="text-sm leading-6 text-status-err-text">
                {err.message}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
