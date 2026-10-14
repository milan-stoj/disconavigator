import { useId, type ReactNode } from 'react';
import {
  Controller,
  type Control,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type UseFormSetError,
} from 'react-hook-form';
import { toast } from 'sonner';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { ApiError, errorMessage } from '@/lib/api';

export interface FormFieldRenderProps<T extends FieldValues, N extends FieldPath<T>> {
  field: ControllerRenderProps<T, N> & {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby'?: string;
  };
  fieldState: ControllerFieldState;
}

export interface FormFieldProps<T extends FieldValues, N extends FieldPath<T>> {
  control: Control<T>;
  name: N;
  label: ReactNode;
  description?: ReactNode;
  /** Horizontal places the control beside the label (switches, checkboxes). */
  orientation?: 'vertical' | 'horizontal';
  render: (props: FormFieldRenderProps<T, N>) => ReactNode;
}

/**
 * The standard form field: shadcn Field + label + description + error message, bound to
 * React Hook Form through a Controller so it works for inputs, selects, switches and pickers.
 */
export function FormField<T extends FieldValues, N extends FieldPath<T>>({
  control,
  name,
  label,
  description,
  orientation = 'vertical',
  render,
}: FormFieldProps<T, N>) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const control = render({
          field: {
            ...field,
            id,
            'aria-invalid': fieldState.invalid,
            'aria-describedby': descriptionId,
          },
          fieldState,
        });
        const help = description ? (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        ) : null;
        const error = <FieldError errors={[fieldState.error]} />;
        return orientation === 'horizontal' ? (
          <Field orientation="horizontal" data-invalid={fieldState.invalid}>
            {control}
            <FieldContent>
              <FieldLabel htmlFor={id}>{label}</FieldLabel>
              {help}
              {error}
            </FieldContent>
          </Field>
        ) : (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {control}
            {help}
            {error}
          </Field>
        );
      }}
    />
  );
}

/**
 * Maps server-side field errors (from a 400/409 response) onto the form. Anything that is not a
 * field error is shown as a toast. Optional `fieldMap` renames server fields to form fields.
 */
export function applyServerErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  err: unknown,
  fieldMap: Record<string, FieldPath<T>> = {},
): void {
  if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0) {
    let first = true;
    for (const [path, message] of Object.entries(err.fieldErrors)) {
      setError(
        (fieldMap[path] ?? path) as FieldPath<T>,
        { type: 'server', message },
        { shouldFocus: first },
      );
      first = false;
    }
    return;
  }
  toast.error(errorMessage(err));
}
