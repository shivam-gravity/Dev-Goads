import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "./icons.js";

export interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
  /** One-line copy shown under the label in the closed control and each menu row — used by the richer selects (Business Type/Goal/Promotion Type) that need more than a bare label. */
  description?: string;
}

export function DropdownField({
  label,
  icon,
  options,
  selected,
  onChange,
  multi = false,
  placeholder = "Select...",
}: {
  label: string;
  icon?: React.ReactNode;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  function pick(value: string) {
    if (multi) {
      onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
    } else {
      onChange([value]);
      setOpen(false);
    }
  }

  const selectedOption = options.find((o) => o.value === selected[0]);
  const selectedLabels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
  const displayIcon = selectedOption?.icon ?? icon;

  return (
    <div className="gen-field" ref={ref}>
      <span className="gen-field-label">{label}</span>
      <button type="button" className={`gen-field-control ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)}>
        {displayIcon && <span className="gen-field-icon">{displayIcon}</span>}
        <span className="gen-field-control-text">
          <span className={`gen-field-value ${selectedLabels.length === 0 ? "placeholder" : ""}`}>
            {selectedLabels.length > 0 ? selectedLabels.join(", ") : placeholder}
          </span>
          {!multi && selectedOption?.description && <span className="gen-field-description">{selectedOption.description}</span>}
        </span>
        <ChevronDownIcon className="gen-field-chevron" />
      </button>
      {open && (
        <div className="gen-field-menu">
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`gen-field-option ${selected.includes(opt.value) ? "selected" : ""}`}
              onClick={() => pick(opt.value)}
            >
              {multi && (
                <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => {}} />
              )}
              {opt.icon && <span className="gen-field-option-icon">{opt.icon}</span>}
              <span className="gen-field-option-text">
                <span>{opt.label}</span>
                {opt.description && <span className="gen-field-option-description">{opt.description}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
