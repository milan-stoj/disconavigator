import { SquareClient, SquareEnvironment, SquareError, type Square } from 'square';
import {
  SquareAuthError,
  SquareDeclinedError,
  type SquareConnector,
  type SquareGateway,
  type SquareInvoiceState,
  type SquarePayment,
} from './gateway.js';

const usd = (cents: number): Square.Money => ({ amount: BigInt(cents), currency: 'USD' });
const cents = (m: Square.Money | undefined | null) => Number(m?.amount ?? 0n);

/** Turns SDK errors into readable messages and flags rejected credentials. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SquareError) {
      if (err.statusCode === 401) throw new SquareAuthError();
      const detail = err.errors.map((e) => e.detail ?? e.code).join('; ');
      throw new Error(`Square error ${err.statusCode ?? ''}: ${detail || err.message}`.trim(), {
        cause: err,
      });
    }
    throw err;
  }
}

function splitName(name: string) {
  const [givenName, ...rest] = name.trim().split(/\s+/);
  return { givenName: givenName ?? name, familyName: rest.join(' ') || undefined };
}

class LiveSquareGateway implements SquareGateway {
  constructor(private readonly client: SquareClient) {}

  async listLocations() {
    const res = await call(() => this.client.locations.list());
    return (res.locations ?? [])
      .filter((l) => l.status !== 'INACTIVE' && l.id)
      .map((l) => ({ id: l.id!, name: l.name ?? l.id! }));
  }

  async findCustomerByEmail(email: string) {
    const res = await call(() =>
      this.client.customers.search({
        limit: 1n,
        query: { filter: { emailAddress: { exact: email } } },
      }),
    );
    return res.customers?.[0]?.id ?? null;
  }

  async createCustomer(input: {
    name: string;
    email: string | null;
    phone: string | null;
    idempotencyKey: string;
  }) {
    const res = await call(() =>
      this.client.customers.create({
        idempotencyKey: input.idempotencyKey,
        ...splitName(input.name),
        emailAddress: input.email ?? undefined,
        phoneNumber: input.phone ?? undefined,
      }),
    );
    if (!res.customer?.id) throw new Error('Square did not return a customer');
    return res.customer.id;
  }

  async createInvoice(input: Parameters<SquareGateway['createInvoice']>[0]) {
    const order = await call(() =>
      this.client.orders.create({
        idempotencyKey: `${input.idempotencyKey}:order`,
        order: {
          locationId: input.locationId,
          customerId: input.customerId,
          referenceId: input.referenceId,
          lineItems: input.lineItems.map((l) => ({
            name: l.name,
            quantity: String(l.quantity),
            basePriceMoney: usd(l.unitCents),
          })),
        },
      }),
    );
    const orderId = order.order?.id;
    if (!orderId) throw new Error('Square did not return an order');
    const res = await call(() =>
      this.client.invoices.create({
        idempotencyKey: `${input.idempotencyKey}:invoice`,
        invoice: {
          locationId: input.locationId,
          orderId,
          title: input.title,
          primaryRecipient: { customerId: input.customerId },
          deliveryMethod: input.deliverByEmail ? 'EMAIL' : 'SHARE_MANUALLY',
          acceptedPaymentMethods: { card: true, squareGiftCard: false, bankAccount: false },
          storePaymentMethodEnabled: input.storeCard,
          paymentRequests: input.paymentRequests.map((r) =>
            r.type === 'DEPOSIT'
              ? {
                  requestType: 'DEPOSIT',
                  dueDate: r.dueDate,
                  fixedAmountRequestedMoney: usd(r.amountCents),
                }
              : { requestType: 'BALANCE', dueDate: r.dueDate },
          ),
        },
      }),
    );
    if (!res.invoice?.id) throw new Error('Square did not return an invoice');
    return { invoiceId: res.invoice.id, orderId, version: res.invoice.version ?? 0 };
  }

  async publishInvoice(input: { invoiceId: string; version: number; idempotencyKey: string }) {
    const res = await call(() => this.client.invoices.publish(input));
    if (!res.invoice) throw new Error('Square did not return the published invoice');
    return this.stateOf(res.invoice);
  }

  async getInvoice(invoiceId: string) {
    const res = await call(() => this.client.invoices.get({ invoiceId }));
    if (!res.invoice) throw new Error('Square did not return the invoice');
    return this.stateOf(res.invoice);
  }

  async listCards(customerId: string) {
    const page = await call(() => this.client.cards.list({ customerId }));
    return page.data
      .filter((c) => c.enabled !== false && c.id)
      .map((c) => ({ id: c.id!, label: `${c.cardBrand ?? 'Card'} ending ${c.last4 ?? '????'}` }));
  }

  async chargeCard(input: Parameters<SquareGateway['chargeCard']>[0]): Promise<SquarePayment> {
    const res = await call(async () => {
      try {
        return await this.client.payments.create({
          sourceId: input.cardId,
          idempotencyKey: input.idempotencyKey,
          amountMoney: usd(input.amountCents),
          customerId: input.customerId,
          locationId: input.locationId,
          note: input.note,
          autocomplete: true,
        });
      } catch (err) {
        if (err instanceof SquareError && (err.statusCode === 400 || err.statusCode === 402)) {
          const detail = err.errors.map((e) => e.detail ?? e.code).join('; ');
          throw new SquareDeclinedError(detail || 'The card was declined');
        }
        throw err;
      }
    });
    const p = res.payment;
    if (!p?.id) throw new Error('Square did not return a payment');
    if (p.status === 'FAILED' || p.status === 'CANCELED') {
      throw new SquareDeclinedError(`The card payment ${p.status.toLowerCase()}`);
    }
    return {
      id: p.id,
      amountCents: cents(p.amountMoney),
      createdAt: p.createdAt ?? new Date().toISOString(),
      method: 'card',
    };
  }

  /** Reads paid amounts from the invoice and individual payments from the order's tenders. */
  private async stateOf(inv: Square.Invoice): Promise<SquareInvoiceState> {
    const paidCents = (inv.paymentRequests ?? []).reduce(
      (sum, r) => sum + cents(r.totalCompletedAmountMoney),
      0,
    );
    let payments: SquarePayment[] = [];
    if (inv.orderId && paidCents > 0) {
      const order = await call(() => this.client.orders.get({ orderId: inv.orderId! }));
      payments = (order.order?.tenders ?? [])
        .filter((t) => t.paymentId)
        .map((t) => ({
          id: t.paymentId!,
          amountCents: cents(t.amountMoney),
          createdAt: t.createdAt ?? new Date().toISOString(),
          method: t.type === 'CARD' ? 'card' : t.type.toLowerCase(),
        }));
    }
    return {
      id: inv.id!,
      version: inv.version ?? 0,
      status: inv.status ?? 'UNPAID',
      orderId: inv.orderId ?? null,
      publicUrl: inv.publicUrl ?? null,
      paidCents,
      payments,
    };
  }
}

export const liveSquareConnector: SquareConnector = {
  mode: 'live',
  connect: ({ environment, accessToken }) =>
    new LiveSquareGateway(
      new SquareClient({
        token: accessToken,
        environment:
          environment === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
        timeoutInSeconds: 20,
        maxRetries: 1,
      }),
    ),
};
