import {
  type AriaAttributes,
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";
import styles from "./Field.module.css";

interface FieldCtx {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldCtx | null>(null);

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Right side of the label row, e.g. "Max" button or character count. */
  aside?: ReactNode;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}

/** Wires label, hint and error to the Input, Select or Textarea inside it. */
export function Field({ label, hint, error, aside, optional, children, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cx(styles.field, className)}>
        <div className={styles.labelRow}>
          <label htmlFor={id} className={styles.label}>
            {label}
            {optional && <span className={styles.optional}>Optional</span>}
          </label>
          {aside}
        </div>
        {children}
        {error ? (
          <p id={errorId} className={styles.error} role="alert">
            {error}
          </p>
        ) : (
          hint && (
            <p id={hintId} className={styles.hint}>
              {hint}
            </p>
          )
        )}
      </div>
    </FieldContext.Provider>
  );
}

function useFieldProps(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: AriaAttributes["aria-invalid"] }) {
  const ctx = useContext(FieldContext);
  return {
    id: props.id ?? ctx?.id,
    "aria-describedby": props["aria-describedby"] ?? ctx?.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (ctx?.invalid || undefined),
  };
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  /** Text or icon inside the left edge. */
  prefix?: ReactNode;
  /** Text inside the right edge, e.g. "ATC". */
  suffix?: ReactNode;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { prefix, suffix, mono, className, ...rest },
  ref,
) {
  const fieldProps = useFieldProps(rest);
  return (
    <div className={cx(styles.control, className)}>
      {prefix && <span className={styles.prefix}>{prefix}</span>}
      <input
        ref={ref}
        className={cx(styles.input, mono && styles.mono, Boolean(prefix) && styles.hasPrefix, Boolean(suffix) && styles.hasSuffix)}
        {...rest}
        {...fieldProps}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(
  function Textarea({ className, mono, ...rest }, ref) {
    const fieldProps = useFieldProps(rest);
    return (
      <textarea
        ref={ref}
        className={cx(styles.input, styles.textarea, mono && styles.mono, className)}
        {...rest}
        {...fieldProps}
      />
    );
  },
);

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  options: SelectOption[];
  placeholder?: string;
}

/** Native select for reliable keyboard, screen reader and mobile picker behaviour. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, className, ...rest },
  ref,
) {
  const fieldProps = useFieldProps(rest);
  return (
    <div className={cx(styles.control, className)}>
      <select ref={ref} className={cx(styles.input, styles.select)} {...rest} {...fieldProps}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
    </div>
  );
});
