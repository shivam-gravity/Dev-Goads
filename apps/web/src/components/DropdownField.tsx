import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "./icons.js";

export interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
  /** One-line copy shown under the label in the closed control and each menu row — used by the richer selects (Business Type/Goal/Promotion Type) that need more than a bare label. */
  description?: string;
  /** Not-yet-available option: rendered greyed with a "Coming soon" badge and NOT selectable.
   * Used to keep TikTok/other networks visible in the picker while only Meta + Google actually work. */
  disabled?: boolean;
}

export function DropdownField({
  label,
  icon,
  options,
  selected,
  onChange,
  multi = false,
  placeholder = "Select...",
  testId,
  recommendedValue,
  emptyHint,
}: {
  label: string;
  icon?: React.ReactNode;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  multi?: boolean;
  placeholder?: string;
  /** Optional data-testid on the control button + a `<testId>-option-<value>` on each menu row,
   * so E2E tests can open the dropdown and pick an option without relying on brittle text/CSS. */
  testId?: string;
  /** When set, the option with this value shows a "Recommended" badge (closed control + menu row),
   * matching the AdsGo reference form's suggested defaults (e.g. Sales goal, Meta platform). */
  recommendedValue?: string;
  /** One-line copy shown under "Nothing to select yet" when options is empty. Defaults to the
   * Meta-connect hint; pass a per-field message (e.g. Google) so the prompt matches the platform. */
  emptyHint?: string;
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
    // Coming-soon options are non-functional — ignore clicks so they can never be selected.
    if (options.find((o) => o.value === value)?.disabled) return;
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
      <button type="button" className={`gen-field-control ${open ? "open" : ""}`} onClick={() => setOpen((v) => !v)} data-testid={testId}>
        {displayIcon && <span className="gen-field-icon">{displayIcon}</span>}
        <span className="gen-field-control-text">
          <span className={`gen-field-value ${selectedLabels.length === 0 ? "placeholder" : ""}`}>
            {selectedLabels.length > 0 ? selectedLabels.join(", ") : placeholder}
          </span>
          {!multi && selectedOption?.description && <span className="gen-field-description">{selectedOption.description}</span>}
        </span>
        {recommendedValue && selected.includes(recommendedValue) && (
          <span className="gen-field-recommended">🌟 Recommended</span>
        )}
        <ChevronDownIcon className="gen-field-chevron" />
      </button>
      {open && (
        <div className="gen-field-menu">
          {options.length === 0 && (
            // Without this, an empty options list renders a blank menu — the control appears to
            // "do nothing" on click (the Pixel/Ad Account selects when no Meta account is connected).
            // Give explicit feedback instead of silent emptiness.
            <div className="gen-field-option gen-field-option-empty">
              <span className="gen-field-option-text">
                <span>Nothing to select yet</span>
                <span className="gen-field-option-description">{emptyHint ?? "Connect a Meta account in Settings to load options."}</span>
              </span>
            </div>
          )}
          {options.map((opt) => (
            <div
              key={opt.value}
              className={`gen-field-option ${selected.includes(opt.value) ? "selected" : ""} ${opt.disabled ? "disabled" : ""}`}
              onClick={() => pick(opt.value)}
              aria-disabled={opt.disabled || undefined}
              style={opt.disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
              data-testid={testId ? `${testId}-option-${opt.value}` : undefined}
            >
              {multi && (
                <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => {}} disabled={opt.disabled} />
              )}
              {opt.icon && <span className="gen-field-option-icon">{opt.icon}</span>}
              <span className="gen-field-option-text">
                <span>
                  {opt.label}{opt.disabled ? " — Coming soon" : ""}
                  {recommendedValue === opt.value && <span className="gen-field-option-recommended">🌟 Recommended</span>}
                </span>
                {opt.description && <span className="gen-field-option-description">{opt.description}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
