import { NumberInput } from '@/components/number-input';
import { InputGroup, InputGroupAddon, InputGroupText } from '@/components/ui/input-group';

/** A dollar amount input; the value is dollars (convert with dollarsToCents). */
export function MoneyInput(props: Parameters<typeof NumberInput>[0]) {
  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>$</InputGroupText>
      </InputGroupAddon>
      <NumberInput {...props} min={0} step={0.01} grouped />
    </InputGroup>
  );
}
