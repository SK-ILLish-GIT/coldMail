import { useRef, useState } from 'react';
import Papa from 'papaparse';
import toast from 'react-hot-toast';

const REQUIRED_COLUMN = 'email';

export default function CsvUploader({ recipients, onChange }) {
  const inputRef = useRef(null);
  const [filename, setFilename] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const parse = (file) => {
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (results) => {
        const headers = results.meta.fields || [];
        if (!headers.includes(REQUIRED_COLUMN)) {
          toast.error(`CSV must include an "${REQUIRED_COLUMN}" column.`);
          return;
        }
        const rows = (results.data || [])
          .map((r) => {
            const out = {};
            for (const k of Object.keys(r)) {
              out[k] = typeof r[k] === 'string' ? r[k].trim() : r[k];
            }
            return out;
          })
          .filter((r) => r.email);

        if (!rows.length) {
          toast.error('No rows with an email address were found.');
          return;
        }
        setFilename(file.name);
        onChange(rows);
        toast.success(`Loaded ${rows.length} recipient${rows.length === 1 ? '' : 's'}.`);
      },
      error: (err) => toast.error(`CSV parse error: ${err.message}`),
    });
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) parse(file);
  };

  const clear = () => {
    setFilename('');
    onChange([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <fieldset className="space-y-4">
      <legend className="label !mb-2">Bulk recipients</legend>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={[
          'rounded-xl border-2 border-dashed bg-ink-50/40 px-5 py-6 transition',
          dragOver ? 'border-brand-400 bg-brand-50/50' : 'border-ink-200',
        ].join(' ')}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-800">
              {recipients.length
                ? `${recipients.length} recipient${recipients.length === 1 ? '' : 's'} loaded`
                : 'Drop a CSV file here'}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              Required column: <code className="rounded bg-ink-200/70 px-1 font-mono">email</code>.
              Optional: <code className="rounded bg-ink-200/70 px-1 font-mono">name</code>,{' '}
              <code className="rounded bg-ink-200/70 px-1 font-mono">company</code>, plus any custom
              <code className="ml-1 rounded bg-ink-200/70 px-1 font-mono">{`{{column}}`}</code> tokens.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => parse(e.target.files?.[0])}
            />
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => inputRef.current?.click()}
            >
              {recipients.length ? 'Replace CSV' : 'Browse files'}
            </button>
            {recipients.length > 0 && (
              <button type="button" className="btn-ghost btn-xs" onClick={clear}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {recipients.length > 0 && (
        <div className="anim-in">
          <p className="mb-2 text-2xs uppercase tracking-wider text-ink-500">
            <span className="font-mono text-ink-700">{filename || 'recipients.csv'}</span> · {recipients.length} row
            {recipients.length === 1 ? '' : 's'}
          </p>
          <div className="max-h-44 overflow-auto rounded-lg border border-ink-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-ink-50 text-ink-500">
                <tr>
                  {Object.keys(recipients[0]).map((k) => (
                    <th key={k} className="px-3 py-2 font-semibold uppercase tracking-wider text-2xs">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recipients.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-ink-100">
                    {Object.keys(recipients[0]).map((k) => (
                      <td key={k} className="px-3 py-1.5 text-ink-700">
                        {r[k] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {recipients.length > 50 && (
              <p className="border-t border-ink-100 px-3 py-2 text-center text-2xs text-ink-400">
                Showing first 50 of {recipients.length} rows
              </p>
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}
