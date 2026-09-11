import { NextResponse } from 'next/server';
import { requireCandidateSession } from '@/lib/api-auth';
import { startInterviewAgent, stopInterviewAgent } from '@/lib/agora-server';
import { apiError } from '@/lib/http';
import { interviewStore } from '@/lib/interview-store';
import { createOpaqueToken, hashToken } from '@/lib/security';
import { agentUidForRole } from '@/lib/agora';

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    let session = await requireCandidateSession(request, id);
    if (session.agoraAgentId && session.status === 'in_progress') {
      return NextResponse.json({ agentId: session.agoraAgentId, status: session.status });
    }
    if (session.status === 'starting') {
      // If another request is currently starting the agent, wait up to 10s for it to finish.
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const check = await interviewStore.getSession(id);
        if (check?.agoraAgentId && check.status === 'in_progress') {
          return NextResponse.json({ agentId: check.agoraAgentId, status: check.status });
        }
        if (check?.status !== 'starting') break;
      }
      const latest = await interviewStore.getSession(id);
      if (latest?.agoraAgentId && latest.status === 'in_progress') {
        return NextResponse.json({ agentId: latest.agoraAgentId, status: latest.status });
      }
      return NextResponse.json({ agentId: latest?.agoraAgentId ?? null, status: latest?.status ?? 'starting' }, { status: 202 });
    }
    if (session.status !== 'ready') throw new Error('Session is not available to start');

    const llmToken = createOpaqueToken();
    session = await interviewStore.updateSession(id, {
      status: 'starting',
      llmTokenHash: hashToken(llmToken),
      stateVersion: session.stateVersion + 1,
    }, session.stateVersion);

    const version = await interviewStore.getInterviewVersion(session.interviewVersionId);
    if (!version) throw new Error('Published interview plan not found');
    const companyName = await interviewStore.getOrganizationName(session.organizationId);
    let agentId: string | null = null;
    try {
      agentId = await startInterviewAgent({
        sessionId: session.id,
        channel: session.channelName,
        rtcUid: session.rtcUid,
        llmToken,
        roleTitle: version.definition.roleTitle,
        companyName,
        panelRoles: version.definition.panelRoles,
        durationMinutes: version.definition.durationMinutes,
        demoMode: version.definition.demoMode,
        activeRole: session.activeRole,
        agentUid: agentUidForRole(session.activeRole),
      });
      const fresh = (await interviewStore.getSession(id)) ?? session;
      if (fresh.status === 'completed' || fresh.status === 'failed') {
        await stopInterviewAgent(agentId).catch(() => {});
        throw new Error('Session is no longer active');
      }
      // Authoritatively update session with agentId and move to in_progress.
      // Do not use optimistic locking here to avoid race conditions with telemetry/connection events.
      const updated = await interviewStore.updateSession(id, {
        agoraAgentId: agentId,
        agentUid: agentUidForRole(session.activeRole),
        status: 'in_progress',
        startedAt: fresh.startedAt || new Date().toISOString(),
        stateVersion: fresh.stateVersion + 1,
      });
      await interviewStore.appendEvent(id, 'session.started', { agentId }).catch(() => {});
      return NextResponse.json({ agentId, status: updated.status });
    } catch (error) {
      console.error('[sessions/start] agent start failure:', { id, agentId, error });
      // Only stop the agent if the session did NOT transition to in_progress
      if (agentId) {
        const latest = await interviewStore.getSession(id).catch(() => null);
        if (latest?.status !== 'in_progress') {
          await stopInterviewAgent(agentId).catch(() => {});
        }
      }
      const fresh = await interviewStore.getSession(id).catch(() => null);
      if (fresh?.status === 'starting') {
        await interviewStore.updateSession(id, {
          status: 'failed',
          connectionHealth: 'disconnected',
          stateVersion: fresh.stateVersion + 1,
        }).catch(() => {});
      }
      await interviewStore.appendEvent(id, 'session.start_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      }).catch(() => {});
      throw error;
    }
  } catch (error) {
    return apiError(error, 'Failed to start interview agent');
  }
}
