import type { RentChargeStatus } from './rules'

export type DisplayStatus = RentChargeStatus | 'cancelled'

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  to_pay: 'À payer',
  partially_paid: 'Partiellement payée',
  paid: 'Payée',
  late: 'En retard',
  cancelled: 'Annulée',
}
