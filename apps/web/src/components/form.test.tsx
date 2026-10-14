import { zodResolver } from '@hookform/resolvers/zod';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createUserSchema } from '@disco/shared';
import { useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { FormField, applyServerErrors } from './form';

type Values = z.infer<typeof createUserSchema>;

function UserForm({ onSubmit }: { onSubmit: (v: Values) => Promise<void> }) {
  const form = useForm<Values>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { username: '', displayName: '', role: 'staff', password: '' },
  });
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (v) => {
        try {
          await onSubmit(v);
        } catch (err) {
          applyServerErrors(form.setError, err);
        }
      })}
    >
      <FormField
        control={form.control}
        name="displayName"
        label="Name"
        render={({ field }) => <Input {...field} />}
      />
      <FormField
        control={form.control}
        name="username"
        label="Username"
        render={({ field }) => <Input {...field} />}
      />
      <FormField
        control={form.control}
        name="password"
        label="Password"
        description="At least 10 characters."
        render={({ field }) => <Input {...field} type="password" />}
      />
      <Button type="submit">Save</Button>
    </form>
  );
}

describe('form pattern', () => {
  it('shows Zod validation messages next to the fields and marks them invalid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UserForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Username'), 'bad name!');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Letters, numbers, dot, dash, underscore only')).toBeInTheDocument();
    expect(screen.getByText('Use at least 10 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      'At least 10 characters.',
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('maps server field errors onto fields', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError(409, 'conflict', 'Taken', {
        fieldErrors: { username: 'That username is already taken' },
      }),
    );
    render(<UserForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Name'), 'Sam');
    await user.type(screen.getByLabelText('Username'), 'kali');
    await user.type(screen.getByLabelText('Password'), 'long-enough-pw');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('That username is already taken')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveFocus();
  });
});
