import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { InputGroupInput } from '@/components/ui/input-group';

type NumberInputProps = Omit<ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  /** Render as an InputGroupInput (inside an InputGroup with addons). */
  grouped?: boolean;
};

/**
 * A numeric input for React Hook Form: emits numbers, or null when empty (undefined would make RHF
 * fall back to the default value), never strings.
 */
export function NumberInput({
  value,
  onChange,
  inputMode = 'decimal',
  grouped,
  ...props
}: NumberInputProps) {
  const Comp = grouped ? InputGroupInput : Input;
  return (
    <Comp
      {...props}
      type="number"
      inputMode={inputMode}
      value={value === undefined || value === null || Number.isNaN(value) ? '' : value}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.valueAsNumber)}
    />
  );
}
