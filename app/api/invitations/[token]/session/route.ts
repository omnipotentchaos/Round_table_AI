import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAgoraChannel, createAgoraRtcUid, createAgoraToken } from '@/lib/agora-server';
import { apiError } from '@/lib/http';
import { interviewStore } from '@/lib/interview-store';
import { candidateCookieName, createCandidateGrant, createOpaqueToken, hashToken } from '@/lib/security';
import type { CompetencyState, InterviewSessionRecord } from '@/types/interview';
import { agentUidForRole } from '@/lib/agora';
import { DEMO_OPENING_QUESTION, demoRoles } from '@/lib/interview-demo';

const StartSchema = z.object({
  consent: z.literal(true),
  candidateName: z.string().trim().min(1).max(160).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new Error('Interview consent is required. Refresh the invitation and start again.');
    }
    const body = StartSchema.parse(rawBody);
    const { token } = await params;
    let invitation = await interviewStore.getInvitationByTokenHash(hashToken(token));
    if (!invitation || invitation.revokedAt) throw new Error('Invitation not found or revoked');
    if (Date.parse(invitation.expiresAt) <= Date.now()) throw new Error('Invitation has expired');
    if (invitation.claimedAt) throw new Error('Invitation has already been used');
    const version = await interviewStore.getInterviewVersion(invitation.interviewVersionId);
    if (!version) throw new Error('Interview version not found');

    if (body.candidateName && body.candidateName !== invitation.candidateName) {
      invitation = await interviewStore.setInvitationCandidateName(invitation.id, body.candidateName);
    }

    const id = randomUUID();
    const rtcUid = createAgoraRtcUid();
    const channelName = createAgoraChannel(id);
    const llmToken = createOpaqueToken();
    const startedAt = new Date().toISOString();
    const expiresAt = new Date(
      Math.min(Date.parse(invitation.expiresAt), Date.now() + (version.definition.durationMinutes + 60) * 60_000),
    ).toISOString();
    const competencyState: CompetencyState = Object.fromEntries(
      version.plan.competencies.map((competency) => [competency.id, {
        rating: null,
        confidence: 0,
        evidenceCount: 0,
        highConfidenceStreak: 0,
        lowConfidenceStreak: 0,
        difficulty: 3,
      }]),
    );
    const sessionInput: InterviewSessionRecord = {
      id,
      invitationId: invitation.id,
      interviewId: invitation.interviewId,
      interviewVersionId: invitation.interviewVersionId,
      organizationId: invitation.organizationId,
      status: 'ready',
      connectionHealth: 'unknown',
      channelName,
      rtcUid,
      agentUid: agentUidForRole(version.definition.demoMode ? demoRoles(version.definition.panelRoles)[0] : version.definition.panelRoles[0]),
      agoraAgentId: null,
      llmTokenHash: hashToken(llmToken),
      activeRole: version.definition.demoMode ? demoRoles(version.definition.panelRoles)[0] : version.definition.panelRoles[0],
      previousRole: null,
      consecutiveRoleTurns: 0,
      currentModality: 'voice',
      phase: version.definition.demoMode ? 'background' : 'introduction',
      competencyState,
      askedMustAsk: [],
      coveredTopics: [],
      pendingQuestion: version.definition.demoMode ? DEMO_OPENING_QUESTION : null,
      stateVersion: 0,
      toolRunCount: 0,
      startedAt,
      completedAt: null,
      expiresAt,
    };

    const tokenData = createAgoraToken(channelName, rtcUid);
    await interviewStore.createSession(invitation, sessionInput);
    await interviewStore.appendEvent(id, 'session.created', {
      consent: true,
      resumeProvided: Boolean(invitation.resumePath),
      candidateNameProvided: Boolean(body.candidateName),
    }).catch((eventError) => console.error('[session] failed to append creation event', eventError));
    const interviewEndsAt = new Date(Date.parse(startedAt) + version.definition.durationMinutes * 60_000).toISOString();
    const response = NextResponse.json({
      sessionId: id,
      channel: channelName,
      rtcToken: tokenData.token,
      rtmToken: tokenData.token,
      token: tokenData.token,
      rtcUid,
      uid: rtcUid,
      agentUid: agentUidForRole(version.definition.demoMode ? demoRoles(version.definition.panelRoles)[0] : version.definition.panelRoles[0]),
      agentId: null,
      expiresAt: tokenData.expiresAt,
      interviewEndsAt,
    }, { status: 201 });
    const feedbackAccessExpiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    response.cookies.set(candidateCookieName(), createCandidateGrant(id, feedbackAccessExpiresAt), {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      expires: new Date(feedbackAccessExpiresAt),
      path: '/',
    });
    return response;
  } catch (error) {
    return apiError(error, 'Failed to start interview session');
  }
}
