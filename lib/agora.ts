import type { PanelRole } from '@/types/interview';

export const DEFAULT_AGENT_UID = 123456;

export const ROLE_AGENT_UID: Record<PanelRole, number> = {
  hiring_manager: 123456,
  technical: 123457,
  product: 123458,
  customer: 123459,
  behavioral: 123460,
};

export const AGENT_UIDS = Object.values(ROLE_AGENT_UID).map(String);

export function agentUidForRole(role: PanelRole): string {
  return String(ROLE_AGENT_UID[role]);
}
