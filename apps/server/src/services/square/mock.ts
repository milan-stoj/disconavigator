import { randomUUID } from 'node:crypto';
import {
  SquareAuthError,
  SquareDeclinedError,
  type CreateInvoiceInput,
  type SquareConnector,
  type SquareGateway,
  type SquareInvoiceState,
  type SquarePayment,
} from './gateway.js';

interface MockInvoice {
  input: CreateInvoiceInput;
  id: string;
  orderId: string;
  version: number;
  status: string;
  totalCents: number;
  payments: SquarePayment[];
}

/**
 * An in-memory stand-in for Square used in development and tests (SQUARE_MODE=mock).
 * Access tokens starting with "invalid" are rejected; set `offline` to simulate an outage.
 */
export class MockSquare implements SquareConnector {
  readonly mode = 'mock' as const;
  offline = false;
  readonly calls: { method: string; input: unknown }[] = [];
  readonly customers = new Map<string, { id: string; name: string; email: string | null }>();
  readonly invoices = new Map<string, MockInvoice>();
  readonly cards = new Map<string, { id: string; label: string }[]>();
  private readonly byKey = new Map<string, unknown>();

  connect({ accessToken }: { accessToken: string }): SquareGateway {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the gateway closes over the backend
    const self = this;
    const guard = (method: string, input: unknown) => {
      if (self.offline) throw new Error('Square is unreachable (mock offline)');
      if (accessToken.startsWith('invalid')) throw new SquareAuthError();
      self.calls.push({ method, input });
    };
    /** Replays the first result for a repeated idempotency key, like Square does. */
    const once = <T>(key: string, fn: () => T): T => {
      if (!self.byKey.has(key)) self.byKey.set(key, fn());
      return self.byKey.get(key) as T;
    };
    return {
      async listLocations() {
        guard('listLocations', null);
        return [
          { id: 'MOCK-LOC-1', name: 'Mock Milwaukee' },
          { id: 'MOCK-LOC-2', name: 'Mock Madison' },
        ];
      },
      async findCustomerByEmail(email) {
        guard('findCustomerByEmail', email);
        return [...self.customers.values()].find((c) => c.email === email)?.id ?? null;
      },
      async createCustomer(input) {
        guard('createCustomer', input);
        return once(input.idempotencyKey, () => {
          const id = `MOCK-CUST-${randomUUID().slice(0, 8)}`;
          self.customers.set(id, { id, name: input.name, email: input.email });
          return id;
        });
      },
      async createInvoice(input) {
        guard('createInvoice', input);
        return once(input.idempotencyKey, () => {
          const inv: MockInvoice = {
            input,
            id: `MOCK-INV-${randomUUID().slice(0, 8)}`,
            orderId: `MOCK-ORDER-${randomUUID().slice(0, 8)}`,
            version: 0,
            status: 'DRAFT',
            totalCents: input.lineItems.reduce((s, l) => s + l.quantity * l.unitCents, 0),
            payments: [],
          };
          self.invoices.set(inv.id, inv);
          return { invoiceId: inv.id, orderId: inv.orderId, version: inv.version };
        });
      },
      async publishInvoice(input) {
        guard('publishInvoice', input);
        const inv = self.mustGet(input.invoiceId);
        if (inv.status === 'DRAFT') {
          if (input.version !== inv.version) throw new Error('Square error 409: version mismatch');
          inv.status = 'UNPAID';
          inv.version += 1;
        }
        return self.stateOf(inv);
      },
      async getInvoice(invoiceId) {
        guard('getInvoice', invoiceId);
        return self.stateOf(self.mustGet(invoiceId));
      },
      async listCards(customerId) {
        guard('listCards', customerId);
        return self.cards.get(customerId) ?? [];
      },
      async chargeCard(input) {
        guard('chargeCard', input);
        return once(input.idempotencyKey, () => {
          if (!(self.cards.get(input.customerId) ?? []).some((c) => c.id === input.cardId)) {
            throw new SquareDeclinedError('Card not found');
          }
          return {
            id: `MOCK-PAY-${randomUUID().slice(0, 8)}`,
            amountCents: input.amountCents,
            createdAt: new Date().toISOString(),
            method: 'card',
          };
        });
      },
    };
  }

  /** Simulates the customer paying an invoice (by default, the next amount due). */
  pay(invoiceId: string, opts: { amountCents?: number; saveCard?: boolean } = {}) {
    const inv = this.mustGet(invoiceId);
    if (inv.status === 'DRAFT') throw new Error('The invoice has not been published');
    const paid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
    const deposit = inv.input.paymentRequests.find((r) => r.type === 'DEPOSIT');
    const next =
      deposit && paid < deposit.amountCents ? deposit.amountCents - paid : inv.totalCents - paid;
    const payment: SquarePayment = {
      id: `MOCK-PAY-${randomUUID().slice(0, 8)}`,
      amountCents: Math.min(opts.amountCents ?? next, inv.totalCents - paid),
      createdAt: new Date().toISOString(),
      method: 'card',
    };
    inv.payments.push(payment);
    inv.status = paid + payment.amountCents >= inv.totalCents ? 'PAID' : 'PARTIALLY_PAID';
    inv.version += 1;
    if (opts.saveCard && inv.input.storeCard) this.addCard(inv.input.customerId);
    return payment;
  }

  addCard(customerId: string, label = 'VISA ending 1111') {
    const card = { id: `MOCK-CARD-${randomUUID().slice(0, 8)}`, label };
    this.cards.set(customerId, [...(this.cards.get(customerId) ?? []), card]);
    return card;
  }

  callsTo(method: string) {
    return this.calls.filter((c) => c.method === method).map((c) => c.input);
  }

  private mustGet(invoiceId: string) {
    const inv = this.invoices.get(invoiceId);
    if (!inv) throw new Error(`Square error 404: invoice ${invoiceId} not found`);
    return inv;
  }

  private stateOf(inv: MockInvoice): SquareInvoiceState {
    return {
      id: inv.id,
      version: inv.version,
      status: inv.status,
      orderId: inv.orderId,
      publicUrl: inv.status === 'DRAFT' ? null : `https://squareup.test/pay-invoice/${inv.id}`,
      paidCents: inv.payments.reduce((s, p) => s + p.amountCents, 0),
      payments: [...inv.payments],
    };
  }
}
