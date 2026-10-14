import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useContacts, useOrganizations } from '@/lib/crm';
import { cn } from '@/lib/utils';

interface PickerProps {
  id?: string;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  invalid?: boolean;
  placeholder?: string;
}

/** A searchable combobox over records. `value` is a record id or null. */
export function RecordPicker({
  id,
  value,
  onChange,
  invalid,
  placeholder = 'None',
  searchPlaceholder,
  emptyMessage,
  records,
}: PickerProps & {
  searchPlaceholder: string;
  emptyMessage: string;
  records: { id: string; name: string; detail?: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const selected = records.find((r) => r.id === value);
  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className="w-full justify-between font-normal"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.name ?? placeholder}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__none__" onSelect={() => choose(null)}>
                <Check className={cn(value ? 'opacity-0' : 'opacity-100')} />
                {placeholder}
              </CommandItem>
              {records.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`${r.name} ${r.detail ?? ''} ${r.id}`}
                  onSelect={() => choose(r.id)}
                >
                  <Check className={cn(value === r.id ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{r.name}</span>
                  {r.detail && <span className="text-muted-foreground text-xs">{r.detail}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function OrganizationPicker({ placeholder = 'No organization', ...props }: PickerProps) {
  const orgs = useOrganizations('active').data ?? [];
  return (
    <RecordPicker
      {...props}
      placeholder={placeholder}
      searchPlaceholder="Search organizations…"
      emptyMessage="No organizations found."
      records={orgs.map((o) => ({ id: o.id, name: o.name, detail: o.city }))}
    />
  );
}

/** Contacts, narrowed to one organization's people when `organizationId` is set. */
export function ContactPicker({
  organizationId,
  placeholder = 'No contact',
  ...props
}: PickerProps & { organizationId?: string | null }) {
  const contacts = useContacts('active').data ?? [];
  const shown = organizationId
    ? contacts.filter((c) => c.organizationId === organizationId || c.id === props.value)
    : contacts;
  return (
    <RecordPicker
      {...props}
      placeholder={placeholder}
      searchPlaceholder="Search contacts…"
      emptyMessage="No contacts found."
      records={shown.map((c) => ({ id: c.id, name: c.name, detail: c.organizationName }))}
    />
  );
}
