export const ROLES = ['administrator', 'manager', 'reader'] as const
export type Role = (typeof ROLES)[number]
export type MemberStatus = 'active' | 'suspended'

const ROLE_LABELS: Record<Role, string> = { administrator: 'Administrateur', manager: 'Gestionnaire', reader: 'Lecteur' }
const STATUS_LABELS: Record<MemberStatus, string> = { active: 'Actif', suspended: 'Suspendu' }

export const roleLabel = (role: string): string => ROLE_LABELS[role as Role] ?? role
export const statusLabel = (status: string): string => STATUS_LABELS[status as MemberStatus] ?? status

/** Jeton d'invitation : 64 caractères hexadécimaux en minuscules. */
export const isInvitationToken = (value: string): boolean => /^[0-9a-f]{64}$/.test(value)
