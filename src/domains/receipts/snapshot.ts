import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const cents = z.number().int().nonnegative()

/**
 * Instantané de tout ce que le document affiche, figé en base à l'émission (ADR 0004).
 * Le PDF est construit uniquement à partir de lui : jamais de relecture des données vivantes.
 */
export const receiptSnapshotSchema = z.object({
  kind: z.enum(['quittance', 'partial_receipt']),
  number: z.string().min(1),
  version: z.number().int().min(1),
  lessor: z.object({
    name: z.string(),
    kind: z.string().nullable().optional(),
    address_line: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    siret: z.string().nullable().optional(),
  }),
  tenants: z.array(z.string()),
  property: z.object({
    label: z.string(),
    address_line1: z.string().nullable().optional(),
    address_line2: z.string().nullable().optional(),
    postal_code: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
  }),
  period: z.object({ start: isoDate, end: isoDate }),
  due_on: isoDate,
  rent_cents: cents,
  charges_cents: cents,
  total_cents: cents,
  amount_cents: cents,
  received_cents: cents,
  remaining_cents: cents,
  settlements: z.array(
    z.object({
      payment_id: z.string(),
      received_on: isoDate,
      mode: z.enum(['transfer', 'cheque', 'cash', 'other']),
      amount_cents: cents,
    }),
  ),
  issued_on: isoDate,
  paid_on: isoDate,
  issuer: z.string(),
  signature: z.object({ id: z.string(), sha256: z.string() }).nullable(),
})

export type ReceiptSnapshot = z.infer<typeof receiptSnapshotSchema>
