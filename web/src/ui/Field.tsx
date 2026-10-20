import type { ReactNode } from 'react'

export interface FieldProps {
  /** Visible label above the control. */
  label?: ReactNode
  /** Id of the control the label points at. */
  htmlFor?: string
  /** Validation message; replaces the hint and paints the control's border. */
  error?: ReactNode
  /** Helper text shown when there is no error. */
  hint?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
}

// Field replaces Carbon's `labelText` / `invalid` / `invalidText` props, which
// Ant Design inputs do not have. Every migrated form uses this wrapper instead
// of Ant Design's Form so the existing pages keep their plain useState
// validation model (no form library, no controlled/uncontrolled surprises).
export default function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: FieldProps) {
  const classes = ['ds-field']
  if (error) classes.push('ds-field--invalid')
  if (className) classes.push(className)
  return (
    <div className={classes.join(' ')}>
      {label && (
        <label className="ds-field__label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ds-field__required" aria-hidden="true">*</span>}
        </label>
      )}
      <div className="ds-field__control">{children}</div>
      {error ? (
        <div className="ds-field__error" role="alert">{error}</div>
      ) : hint ? (
        <div className="ds-field__hint">{hint}</div>
      ) : null}
    </div>
  )
}
