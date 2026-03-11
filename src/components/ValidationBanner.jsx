/**
 * ValidationBanner
 * Renders a list of structured validation errors at the top of the form.
 * Flaw 2 fix: errors are surfaced explicitly, not silenced.
 */

export default function ValidationBanner({ errors = [] }) {
  if (!errors.length) return null;

  return (
    <div className="rounded-md bg-red-50 border border-red-300 p-4 mb-4">
      <div className="flex items-start gap-2">
        <span className="text-red-600 text-lg leading-none">&#9888;</span>
        <div>
          <h3 className="text-sm font-semibold text-red-800 mb-1">
            {errors.length === 1 ? '1 validation error' : `${errors.length} validation errors`} — fix before processing
          </h3>
          <ul className="list-disc list-inside space-y-1">
            {errors.map((err, i) => (
              <li key={i} className="text-sm text-red-700">
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
