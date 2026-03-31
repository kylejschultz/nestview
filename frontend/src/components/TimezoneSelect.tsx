import { useState, useRef, useEffect } from "react";

const TIMEZONES = [
  // Americas
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Anchorage", "America/Adak", "America/Phoenix", "America/Indiana/Indianapolis",
  "America/Detroit", "America/Toronto", "America/Vancouver", "America/Halifax",
  "America/St_Johns", "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "America/Santiago", "America/Bogota", "America/Lima", "America/Mexico_City",
  "America/Caracas", "America/La_Paz",
  // Europe
  "UTC", "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris",
  "Europe/Berlin", "Europe/Rome", "Europe/Madrid", "Europe/Amsterdam",
  "Europe/Brussels", "Europe/Vienna", "Europe/Zurich", "Europe/Stockholm",
  "Europe/Oslo", "Europe/Copenhagen", "Europe/Helsinki", "Europe/Warsaw",
  "Europe/Prague", "Europe/Budapest", "Europe/Bucharest", "Europe/Athens",
  "Europe/Istanbul", "Europe/Moscow", "Europe/Kyiv",
  // Asia / Pacific
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok",
  "Asia/Jakarta", "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Manila",
  "Asia/Shanghai", "Asia/Hong_Kong", "Asia/Taipei", "Asia/Tokyo", "Asia/Seoul",
  "Asia/Riyadh", "Asia/Tehran", "Asia/Tashkent", "Asia/Yekaterinburg",
  // Australia / Pacific
  "Australia/Perth", "Australia/Darwin", "Australia/Adelaide", "Australia/Brisbane",
  "Australia/Sydney", "Australia/Melbourne", "Australia/Hobart",
  "Pacific/Auckland", "Pacific/Fiji", "Pacific/Honolulu", "Pacific/Guam",
];

interface Props {
  value: string;
  onChange: (tz: string) => void;
  disabled?: boolean;
}

export default function TimezoneSelect({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep query in sync when value changes externally (e.g. on load)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = query
    ? TIMEZONES.filter((tz) => tz.toLowerCase().includes(query.toLowerCase()))
    : TIMEZONES;

  function select(tz: string) {
    onChange(tz);
    setQuery(tz);
    setOpen(false);
  }

  function handleBlur(e: React.FocusEvent) {
    // Close only when focus leaves the entire container
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
      setQuery(value); // revert typed-but-unselected text
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery(value);
      inputRef.current?.blur();
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative w-64"
      onBlur={handleBlur}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        disabled={disabled}
        placeholder="Search timezones…"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full bg-surface-3 border border-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-accent disabled:opacity-40 disabled:cursor-not-allowed"
      />

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">No results</p>
          ) : (
            filtered.map((tz) => (
              <button
                key={tz}
                type="button"
                onMouseDown={(e) => {
                  // Prevent input blur before click registers
                  e.preventDefault();
                  select(tz);
                }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  tz === value
                    ? "bg-accent text-white"
                    : "text-slate-300 hover:bg-surface-3"
                }`}
              >
                {tz}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
