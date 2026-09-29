import { useCallback, useMemo, useState, type FormEvent } from "react";
import { useForm as useTanstackForm, useStore, type DeepKeys, type DeepValue } from "@tanstack/react-form";
import { isApiError } from "./api-error.js";
import type { BodyValidator, FieldErrors } from "./body-validator.js";

export interface UseFormOptions<T extends Record<string, unknown>> {
  defaultValues: T;
  /** Called only with values the validator accepts. Throw an `ApiError` (e.g. from `mutateAsync`) to surface server field errors. */
  onSubmit: (values: T) => unknown;
}

export interface FieldBinding<V = unknown> {
  name: string;
  value: V;
  onChange: (value: V) => void;
  onBlur: () => void;
  /** Message for this field, shown once it has been touched, a submit was attempted, or the server rejected it. */
  error: string | undefined;
}

export interface UseFormResult<T extends Record<string, unknown>> {
  values: T;
  /** All current problems keyed like `ApiError.fieldErrors` (`body.title`): client validation plus the last server response. */
  errors: FieldErrors;
  isValid: boolean;
  isSubmitting: boolean;
  /** Bind to a control: `const f = form.field("title")`. Names are body paths: `title`, `address.city`, `tags[0]`. */
  field: <V = unknown>(name: string) => FieldBinding<V>;
  /** The visible error for a field name (same rule as `field(name).error`). */
  fieldError: (name: string) => string | undefined;
  setValue: (name: string, value: unknown) => void;
  handleSubmit: (e?: FormEvent) => Promise<void>;
  reset: () => void;
  /** Merge server-side field errors (normally automatic when `onSubmit` throws an ApiError). */
  setServerErrors: (errors: FieldErrors) => void;
  /** Escape hatch: the underlying TanStack Form instance. */
  form: TanstackForm<T>;
}

function useTanstackFormFor<T extends Record<string, unknown>>(
  defaultValues: T,
  invalid: (value: T) => boolean,
  onSubmit: (value: T) => Promise<void>,
) {
  return useTanstackForm({
    defaultValues,
    validators: { onSubmit: ({ value }) => (invalid(value) ? "invalid" : undefined) },
    onSubmit: ({ value }) => onSubmit(value),
  });
}

type TanstackForm<T extends Record<string, unknown>> = ReturnType<typeof useTanstackFormFor<T>>;

const locationOf = (name: string) => `body.${name}`;

/**
 * Form state (TanStack Form) validated by a schema-derived validator (`createBodyValidator`), so the form
 * cannot submit what the API would reject. Field errors use the same keys as `ApiError.fieldErrors`.
 */
export function useForm<T extends Record<string, unknown>>(validator: BodyValidator<T>, options: UseFormOptions<T>): UseFormResult<T> {
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});

  const form = useTanstackFormFor(
    options.defaultValues,
    (value) => Object.keys(validator.validate(value)).length > 0,
    async (value) => {
      try {
        await options.onSubmit(value);
      } catch (e) {
        if (isApiError(e)) setServerErrors(e.fieldErrors);
        else throw e;
      }
    },
  );

  const values = useStore(form.store, (s) => s.values);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  const attempts = useStore(form.store, (s) => s.submissionAttempts);
  const fieldMeta = useStore(form.store, (s) => s.fieldMeta) as Record<string, { isTouched?: boolean } | undefined>;

  const clientErrors = useMemo(() => validator.validate(values), [validator, values]);
  const errors = useMemo(() => ({ ...clientErrors, ...serverErrors }), [clientErrors, serverErrors]);

  const fieldError = useCallback(
    (name: string): string | undefined => {
      const key = locationOf(name);
      const server = serverErrors[key];
      if (server !== undefined) return server;
      const shown = attempts > 0 || fieldMeta[name]?.isTouched === true;
      return shown ? clientErrors[key] : undefined;
    },
    [serverErrors, clientErrors, attempts, fieldMeta],
  );

  const setValue = useCallback(
    (name: string, value: unknown) => {
      setServerErrors((prev) => {
        const key = locationOf(name);
        if (!(key in prev)) return prev;
        const { [key]: _dropped, ...rest } = prev;
        return rest;
      });
      form.setFieldValue(name as DeepKeys<T>, value as DeepValue<T, DeepKeys<T>> as never);
    },
    [form],
  );

  const field = useCallback(
    <V,>(name: string): FieldBinding<V> => ({
      name,
      value: form.getFieldValue(name as DeepKeys<T>) as V,
      onChange: (v) => setValue(name, v),
      onBlur: () => form.setFieldMeta(name as DeepKeys<T>, (m) => ({ ...m, isTouched: true })),
      error: fieldError(name),
    }),
    // values in deps so bindings refresh when any value changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, setValue, fieldError, values],
  );

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      setServerErrors({});
      await form.handleSubmit();
    },
    [form],
  );

  const reset = useCallback(() => {
    setServerErrors({});
    form.reset();
  }, [form]);

  return {
    values,
    errors,
    isValid: Object.keys(clientErrors).length === 0,
    isSubmitting,
    field,
    fieldError,
    setValue,
    handleSubmit,
    reset,
    setServerErrors,
    form,
  };
}
