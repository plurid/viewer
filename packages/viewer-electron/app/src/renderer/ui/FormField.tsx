import { useId } from 'react';
import type { ReactNode } from 'react';
import './form-fields.css';

/** A label around its one control, or a labelled group for a field made of several. */
type FormFieldElement = 'label' | 'div';

/**
 * A FORM FIELD (DESIGN.md, the Output Form Rule): its label above it, the field filling the row.
 * As a label it names its one control; as a group (`div`) it names a field of several controls,
 * whose label points at the control given by `htmlFor`.
 */
export function FormField({
  label,
  htmlFor,
  children,
  className = '',
  as: Element = 'label',
}: {
  label: ReactNode;
  htmlFor?: string;
  /** Optional in the type, so `createElement(FormField, props, control)` checks. */
  children?: ReactNode;
  className?: string;
  as?: FormFieldElement;
}) {
  const labelID = useId();
  if (Element === 'label')
    return (
      <label className={`dialog-field ${className}`}>
        <span className="dialog-field-label">{label}</span>
        {children}
      </label>
    );
  return (
    <div className={`dialog-field ${className}`} role="group" aria-labelledby={labelID}>
      {htmlFor ? (
        <label className="dialog-field-label" id={labelID} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="dialog-field-label" id={labelID}>
          {label}
        </span>
      )}
      {children}
    </div>
  );
}
