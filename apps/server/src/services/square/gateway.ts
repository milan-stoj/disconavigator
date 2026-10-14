/**
 * The narrow slice of Square that Disco Controller uses. The live implementation wraps the
 * official SDK; the mock keeps everything in memory for development and tests.
 */

export type SquareEnvironmentName = 'sandbox' | 'production';

export interface SquareCredentials {
  environment: SquareEnvironmentName;
  accessToken: string;
}

export interface SquareLocation {
  id: string;
  name: string;
}

export interface SquareLineItem {
  name: string;
  quantity: number;
  unitCents: number;
}

export type SquarePaymentRequest =
  { type: 'DEPOSIT'; amountCents: number; dueDate: string } | { type: 'BALANCE'; dueDate: string };

export interface CreateInvoiceInput {
  locationId: string;
  customerId: string;
  title: string;
  /** Our booking number; shown on the Square order. */
  referenceId: string;
  lineItems: SquareLineItem[];
  paymentRequests: SquarePaymentRequest[];
  /** Let the customer save their card so later loss charges can use it. */
  storeCard: boolean;
  /** Email the invoice when the customer has an address; otherwise it is shared by link. */
  deliverByEmail: boolean;
  idempotencyKey: string;
}

export interface SquarePayment {
  id: string;
  amountCents: number;
  createdAt: string;
  method: string;
}

export interface SquareInvoiceState {
  id: string;
  version: number;
  /** Square's invoice status, e.g. UNPAID, PARTIALLY_PAID, PAID, CANCELED. */
  status: string;
  orderId: string | null;
  publicUrl: string | null;
  paidCents: number;
  payments: SquarePayment[];
}

export interface SquareGateway {
  listLocations(): Promise<SquareLocation[]>;
  findCustomerByEmail(email: string): Promise<string | null>;
  createCustomer(input: {
    name: string;
    email: string | null;
    phone: string | null;
    idempotencyKey: string;
  }): Promise<string>;
  /** Creates the order and a draft invoice for it. */
  createInvoice(
    input: CreateInvoiceInput,
  ): Promise<{ invoiceId: string; orderId: string; version: number }>;
  publishInvoice(input: {
    invoiceId: string;
    version: number;
    idempotencyKey: string;
  }): Promise<SquareInvoiceState>;
  getInvoice(invoiceId: string): Promise<SquareInvoiceState>;
  listCards(customerId: string): Promise<{ id: string; label: string }[]>;
  chargeCard(input: {
    locationId: string;
    customerId: string;
    cardId: string;
    amountCents: number;
    note: string;
    idempotencyKey: string;
  }): Promise<SquarePayment>;
}

/** Square rejected the credentials (as opposed to being unreachable). */
export class SquareAuthError extends Error {
  constructor(message = 'Square rejected the access token') {
    super(message);
  }
}

/** Square refused a card payment (declined, expired or removed card). Not worth retrying. */
export class SquareDeclinedError extends Error {}

export interface SquareConnector {
  readonly mode: 'live' | 'mock';
  connect(credentials: SquareCredentials): SquareGateway;
}

/** Maps Square's invoice status onto ours. */
export function localInvoiceStatus(
  squareStatus: string,
): 'published' | 'partially_paid' | 'paid' | 'cancelled' | 'failed' {
  switch (squareStatus) {
    case 'PAID':
    case 'PARTIALLY_REFUNDED':
    case 'REFUNDED':
      return 'paid';
    case 'PARTIALLY_PAID':
      return 'partially_paid';
    case 'CANCELED':
      return 'cancelled';
    case 'FAILED':
      return 'failed';
    default:
      return 'published';
  }
}
