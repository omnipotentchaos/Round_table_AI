import { createHash, randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { requireLlmSession } from '@/lib/api-auth';
import { apiError } from '@/lib/http';
import {
  classifyCandidateConversationControl,
  processCandidateTurn,
  processConversationControlTurn,
} from '@/lib/interview-controller';
import { interviewStore } from '@/lib/interview-store';
import { DEMO_CLOSING } from '@/lib/interview-demo';
import { advanceDemoWorkspace, processDemoAnswer } from '@/lib/demo-turns';
import { workspaceCommand, respondToWorkspaceCommand } from '@/lib/workspace-conversation';
import { agentUidForRole } from '@/lib/agora';
import { startInterviewAgent, stopInterviewAgent } from '@/lib/agora-server';
import type { InterviewSessionRecord } from '@/types/interview';

export const maxDuration = 60;

type ChatMessage = { role?: string; content?: unknown };
type ChatBody = { messages?: ChatMessage[]; stream?: boolean; model?: string; [key: string]: unknown };

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && 'text' in item) return String((item as { text?: unknown }).text ?? '');
      return '';
    }).join(' ');
  }
  return '';
}

function sseResponse(text: string): NextResponse {
  const encoder = new TextEncoder();
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1_000);
  const chunks = text.match(/\S+\s*/g) ?? [text];
  const stream = new ReadableStream({
    start(controller) {
      const emit = (delta: Record<string, unknown>, finishReason: string | null = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'roundtable-controller', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`));
      emit({ role: 'assistant', content: '' });
      for (const chunk of chunks) emit({ content: chunk });
      emit({}, 'stop');
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new NextResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}

function isWorkspaceContinue(answer: string): boolean {
  const normalized = answer.trim().toLocaleLowerCase().replace(/[.!?]+$/g, '');
  if (normalized.split(/\s+/).filter(Boolean).length > 12) return false;
  return /\b(?:continue|next question)(?:\s+(?:now|please|for(?:\s+the)?\s+next\s+panel(?:\s+perspective)?))?\b/.test(normalized);
}

function llmBearerToken(request: Request): string {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('LLM authentication is required');
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) throw new Error('LLM authentication is required');
  return token;
}

/**
 * Agora does not support changing a cascading agent's TTS vendor/voice at
 * runtime. On a server-selected role handoff, replace only the speaking agent;
 * the candidate stays in the same RTC/RTM channel and interview state remains
 * in the durable session.
 */
async function handoffRoleAgent(
  request: Request,
  previousSession: InterviewSessionRecord,
  openingText: string,
): Promise<boolean> {
  const nextSession = await interviewStore.getSession(previousSession.id);
  if (!nextSession || nextSession.activeRole === previousSession.activeRole || !nextSession.agoraAgentId) return false;

  const version = await interviewStore.getInterviewVersion(nextSession.interviewVersionId);
  if (!version) throw new Error('Published interview plan not found');
  const companyName = await interviewStore.getOrganizationName(nextSession.organizationId);
  const oldAgentId = nextSession.agoraAgentId;
  const nextAgentUid = agentUidForRole(nextSession.activeRole);

  // Clear the old ID before issuing leave so its eventual STOPPED webhook is
  // not mistaken for an interview ending while the next role is joining.
  const detached = await interviewStore.updateSession(nextSession.id, {
    agoraAgentId: null,
    agentUid: nextAgentUid,
    connectionHealth: 'unknown',
    stateVersion: nextSession.stateVersion + 1,
  }, nextSession.stateVersion);
  await interviewStore.appendEvent(nextSession.id, 'agent.role_handoff_started', {
    fromRole: previousSession.activeRole,
    toRole: detached.activeRole,
    oldAgentId,
  }).catch(() => {});

  await stopInterviewAgent(oldAgentId);
  let nextAgentId: string | null = null;
  try {
    nextAgentId = await startInterviewAgent({
      sessionId: detached.id,
      channel: detached.channelName,
      rtcUid: detached.rtcUid,
      llmToken: llmBearerToken(request),
      roleTitle: version.definition.roleTitle,
      companyName,
      panelRoles: version.definition.panelRoles,
      durationMinutes: version.definition.durationMinutes,
      demoMode: version.definition.demoMode,
      activeRole: detached.activeRole,
      openingText,
      agentUid: nextAgentUid,
    });
    const latest = (await interviewStore.getSession(detached.id)) ?? detached;
    await interviewStore.updateSession(detached.id, {
      agoraAgentId: nextAgentId,
      agentUid: nextAgentUid,
      connectionHealth: 'connected',
      stateVersion: latest.stateVersion + 1,
    });
    await interviewStore.appendEvent(detached.id, 'agent.role_handoff_completed', {
      fromRole: previousSession.activeRole,
      toRole: detached.activeRole,
      agentId: nextAgentId,
    }).catch(() => {});
    return true;
  } catch (error) {
    if (nextAgentId) await stopInterviewAgent(nextAgentId).catch(() => {});
    const latest = await interviewStore.getSession(detached.id).catch(() => null);
    if (latest?.status === 'in_progress') {
      await interviewStore.updateSession(detached.id, {
        status: 'failed',
        connectionHealth: 'disconnected',
        stateVersion: latest.stateVersion + 1,
      }).catch(() => {});
    }
    throw error;
  }
}

async function responseWithRoleHandoff(
  request: Request,
  session: InterviewSessionRecord,
  text: string,
): Promise<NextResponse> {
  return sseResponse(await handoffRoleAgent(request, session, text) ? '' : text);
}

export async function POST(request: Request) {
  const receivedAt = Date.now();
  try {
    const session = await requireLlmSession(request);
    if (!['ready', 'starting', 'in_progress'].includes(session.status)) throw new Error('Session is not active');
    if (session.status === 'starting') {
      await interviewStore.updateSession(session.id, { status: 'in_progress' }).catch(() => {});
    }
    if (session.phase === 'wrap_up') {
      const version = await interviewStore.getInterviewVersion(session.interviewVersionId);
      if (version?.definition.demoMode) return sseResponse(DEMO_CLOSING);
    }
    let body: ChatBody;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const latestUser = [...messages].reverse().find((message) => message.role === 'user');
    const answer = messageText(latestUser?.content).trim();
    // Agora may probe the custom LLM immediately after joining, before STT
    // delivers a candidate turn. Returning a 4xx makes this look like an LLM
    // authentication failure and can destabilize an otherwise healthy call.
    if (!answer) return sseResponse('');
    // Caller-provided system messages and model names are intentionally ignored.
    const contextId = createHash('sha256').update(JSON.stringify(messages.slice(-6))).digest('hex');
    // The custom LLM receives this text only after Agora STT has finalized it.
    // Keep a private, candidate-readable caption so the interview rail remains
    // truthful if a role handoff briefly delays the browser toolkit event.
    const existingCaptions = await interviewStore.listEvents(session.id);
    if (!existingCaptions.some((event) => event.type === 'candidate.live_caption' && event.payload.requestId === contextId)) {
      await interviewStore.appendEvent(session.id, 'candidate.live_caption', {
        requestId: contextId,
        text: answer.slice(0, 12_000),
      });
    }
    const workspaceAction = workspaceCommand(answer);
    if (workspaceAction) return sseResponse(await respondToWorkspaceCommand(session, workspaceAction, contextId, answer));
    const version = await interviewStore.getInterviewVersion(session.interviewVersionId);
    // In a demo, “continue” is an explicit skip for a workspace explanation.
    // It must advance the pending panel role before generic repeat handling.
    if (version?.definition.demoMode && isWorkspaceContinue(answer)) {
      if (session.currentModality === 'code' || session.currentModality === 'canvas') {
        return responseWithRoleHandoff(request, session, await advanceDemoWorkspace({ session, upstreamTurnId: contextId, outcome: 'skipped' }));
      }
      // Candidate-directed workspace completion is deliberate. It must not be
      // blocked by a missing client receipt for the prior question, otherwise
      // the panel gets stuck repeating the same technical task.
      return responseWithRoleHandoff(request, session, await processDemoAnswer({ session, answer, upstreamTurnId: contextId, allowUndeliveredSkip: true }));
    }
    const control = classifyCandidateConversationControl(answer);
    if (control) {
      const responseText = await processConversationControlTurn({
        session,
        answer,
        control,
        upstreamTurnId: contextId,
      });
      return sseResponse(responseText);
    }
    // A workspace task is a mini-interview owned by its current role. A spoken
    // explanation must not silently consume that role and advance the demo.
    // The candidate explicitly says "continue" when they want the next role.
    if (version?.definition.demoMode && (session.currentModality === 'code' || session.currentModality === 'canvas')) {
      const role = session.currentModality === 'code' ? 'Technical interviewer' : 'Product manager';
      return sseResponse(`${role} here. I heard your explanation. Say check now for a grounded review, or say continue when you are ready for the next panel perspective.`);
    }
    if (version?.definition.demoMode) {
      return responseWithRoleHandoff(request, session, await processDemoAnswer({ session, answer, upstreamTurnId: contextId }));
    }
    const result = await processCandidateTurn({ session, answer, upstreamTurnId: contextId });
    await interviewStore.appendEvent(session.id, 'llm.response_ready', {
      durationMs: Date.now() - receivedAt,
      role: result.decision.activeSpeakerRole,
      reasonCode: result.decision.reasonCode,
      modality: result.decision.modality,
      difficulty: result.decision.difficulty,
    }).catch(() => {});
    return responseWithRoleHandoff(request, session, result.responseText);
  } catch (error) {
    return apiError(error, 'Adaptive interview response failed');
  }
}
