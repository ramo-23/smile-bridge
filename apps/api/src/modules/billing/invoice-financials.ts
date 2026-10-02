import { EntityManager } from 'typeorm';

export enum PaymentStatus {
  Unpaid = 'unpaid',
  PartPaid = 'part_paid',
  Paid = 'paid',
  Overpaid = 'overpaid',
  Cancelled = 'cancelled',
}

export type InvoiceFinancials = {
  creditedCents: number;
  paidCents: number;
  balanceCents: number | null;
  paymentStatus: PaymentStatus | null;
};

/**
 * The single definition of credited, paid, balance and payment status for an invoice.
 * balance = total - credited - paid (negative means a refund is due). Drafts have neither
 * a balance nor a payment status. Status precedence (first match wins):
 *   cancelled  net total after credits is 0 and nothing was paid
 *   overpaid   balance < 0
 *   paid       balance 0 and net total > 0
 *   part_paid  paid > 0 and balance > 0
 *   unpaid     otherwise (paid 0, balance > 0)
 * Used as a derived table exposing: invoice_id, credited_cents, paid_cents, balance_cents, payment_status.
 */
export const INVOICE_FINANCIALS_SQL = `
  SELECT i.id AS invoice_id,
         cr.credited_cents,
         pa.paid_cents,
         CASE WHEN i.status = 'issued'
              THEN i.total_cents - cr.credited_cents - pa.paid_cents END AS balance_cents,
         CASE
           WHEN i.status <> 'issued' THEN NULL
           WHEN i.total_cents - cr.credited_cents = 0 AND pa.paid_cents = 0 THEN 'cancelled'
           WHEN i.total_cents - cr.credited_cents - pa.paid_cents < 0 THEN 'overpaid'
           WHEN i.total_cents - cr.credited_cents - pa.paid_cents = 0
                AND i.total_cents - cr.credited_cents > 0 THEN 'paid'
           WHEN pa.paid_cents > 0 THEN 'part_paid'
           ELSE 'unpaid'
         END AS payment_status
    FROM invoices i
   CROSS JOIN LATERAL (
     SELECT COALESCE(SUM(amount_cents), 0)::bigint AS credited_cents
       FROM credit_notes WHERE invoice_id = i.id) cr
   CROSS JOIN LATERAL (
     SELECT COALESCE(SUM(amount_cents), 0)::bigint AS paid_cents
       FROM payments WHERE invoice_id = i.id) pa`;

export function toFinancials(row: {
  credited_cents: string;
  paid_cents: string;
  balance_cents: string | null;
  payment_status: string | null;
}): InvoiceFinancials {
  return {
    creditedCents: Number(row.credited_cents),
    paidCents: Number(row.paid_cents),
    balanceCents: row.balance_cents === null ? null : Number(row.balance_cents),
    paymentStatus: row.payment_status as PaymentStatus | null,
  };
}

export async function loadInvoiceFinancials(
  manager: EntityManager,
  invoiceId: string,
): Promise<InvoiceFinancials> {
  const [row] = await manager.query(
    `SELECT * FROM (${INVOICE_FINANCIALS_SQL}) f WHERE f.invoice_id = $1`,
    [invoiceId],
  );
  return toFinancials(row);
}
