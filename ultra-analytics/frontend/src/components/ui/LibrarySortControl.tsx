/** Compact Sort by control for the Ride Library. */

import {
  LIBRARY_SORT_OPTIONS,
  type LibrarySortId,
} from "../../library/sort";

interface Props {
  value: LibrarySortId;
  onChange: (id: LibrarySortId) => void;
  className?: string;
}

export default function LibrarySortControl({ value, onChange, className = "" }: Props) {
  return (
    <label className={`library-sort ${className}`.trim()}>
      <span className="library-sort__label">Sort by</span>
      <select
        className="library-sort__select"
        value={value}
        onChange={(e) => onChange(e.target.value as LibrarySortId)}
        aria-label="Sort Library rides"
      >
        {LIBRARY_SORT_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
