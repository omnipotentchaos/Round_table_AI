import { createHash } from 'crypto';
import { interviewStore } from '@/lib/interview-store';
import { demoQuestionForRole, processCandidateTurn, turnDedupeKey } from '@/lib/interview-controller';
import { DEMO_CLOSING, DEMO_OPENING_QUESTION, demoRoles, normalizeSpokenText } from '@/lib/interview-demo';
import { demoWorkspaceQuestion } from '@/lib/workspace-policy';
import type { InterviewSessionRecord, PanelRole } from '@/types/interview';

const ROLE_LABEL: Record<PanelRole, string> = {
  hiring_manager: 'Hiring manager',
  technical: 'Technical interviewer',
  product: 'Product manager',
  customer: 'Customer',
  behavioral: 'Behavioural interviewer',
};

// A question is an epoch, not an ASR segment. Transport receipts never supply
// role, score or coverage; those remain derived from server-owned questions.
export function demoQuestion(session: InterviewSessionRecord) {
  const text = session.pendingQuestion ?? DEMO_OPENING_QUESTION;
  return { id: createHash('sha256').update(`${session.id}:${text}`).digest('hex'), text };
}

export function mergeAnswerFragments(fragments: string[]): string {
  return fragments.reduce((combined, fragment) => {
    if (!combined) return fragment.trim();
    if (normalizeSpokenText(fragment).startsWith(normalizeSpokenText(combined))) return fragment.trim();
    if (normalizeSpokenText(combined).endsWith(normalizeSpokenText(fragment))) return combined;
    return `${combined} ${fragment.trim()}`;
  }, '');
}

export function isIncompleteDemoAnswer(answer: string, role: string): boolean {
  if (/^(?:please )?(?:skip(?: this(?: question)?)?|pass|continue(?: (?:now|please|for(?: the)? next panel(?: perspective)?))?|next(?: question)?|i (?:don't|do not) know)[.! ]*$/i.test(answer)
    || /\b(that['’]s (?:all|my answer)|i['’]m done)\W*$/i.test(answer)) return false;
  const words = answer.trim().split(/\s+/);
  // Customer answers are naturally concise. A clear benefit statement should
  // advance the demo instead of leaving the candidate in silence to guess that
  // they must say "continue".
  if (role === 'customer' && words.length >= 4
    && /\b(faster|fewer|improved?|reduced?|saved?|easier|simple|latency|time|reliable|cost|benefit|workflow)\b/i.test(answer)) {
    return false;
  }
  if (words.length < 8 || /\b(that|was|is|the|a|an|to|and|but|because|with|my|took|were)\W*$/i.test(answer)) return true;
  // An introduction alone is not the requested project example.
  return role === 'hiring_manager'
    && !/\b(project|assignment|exercise|coursework|homework|built|implemented|developed|owned|led|created|delivered|worked on|checkout|service|system|application|platform)\b/i.test(answer);
}

export async function processDemoAnswer(input: {
  session: InterviewSessionRecord; answer: string; upstreamTurnId: string; allowUndeliveredSkip?: boolean;
}): Promise<string> {
  // Retry lookup precedes refreshing the question epoch: a retried response must
  // not become an answer to the next panel member.
  const events = await interviewStore.listEvents(input.session.id);
  const cached = events.find((event) => event.type === 'demo.response'
    && event.payload.requestId === input.upstreamTurnId);
  if (cached) return String(cached.payload.text ?? '');
  const reservedRequest = events.find((event) => event.type === 'answer.fragment'
    && event.payload.requestId === input.upstreamTurnId);
  if (reservedRequest) {
    const turn = await interviewStore.findTurnByDedupeKey(input.session.id,
      turnDedupeKey(input.session.id, String(reservedRequest.payload.questionId), 'demo-answer'));
    const analysis = turn ? await interviewStore.getAnalysisByTurn(turn.id) : null;
    if (analysis) return analysis.responseText;
  }
  const session = await interviewStore.getSession(input.session.id);
  if (!session || !['ready', 'starting', 'in_progress'].includes(session.status)) throw new Error('Session is not active');
  const question = demoQuestion(session);
  const delivered = events.some((event) => event.type === 'question.delivered'
    && event.payload.questionId === question.id);
  const saveResponse = async (text: string) => {
    await interviewStore.appendEvent(session.id, 'demo.response', {
      requestId: input.upstreamTurnId, questionId: question.id, text,
    });
    return text;
  };
  if (!delivered && !input.allowUndeliveredSkip) {
    // Speech that interrupts an unheard question cannot complete that role.
    // Rephrase/resume that question instead of silently skipping it.
    return saveResponse(`Let me repeat the question. ${question.text}`);
  }

  const prior = events.filter((event) => event.type === 'answer.fragment'
    && event.payload.questionId === question.id);
  if (!prior.some((event) => event.payload.requestId === input.upstreamTurnId)) {
    await interviewStore.appendEvent(session.id, 'answer.fragment', {
      questionId: question.id, requestId: input.upstreamTurnId, text: input.answer.slice(0, 12_000),
    });
  }
  const answer = mergeAnswerFragments([
    ...prior.map((event) => String(event.payload.text ?? '')),
    input.answer,
  ]).slice(0, 24_000);
  if (isIncompleteDemoAnswer(answer, session.activeRole)) {
    // Ask for a short completion instead of returning silence. Silence makes a
    // live STT turn look lost, especially while the workspace is open.
    const prompt = session.activeRole === 'hiring_manager' && answer.split(/\s+/).length >= 8
      ? 'Thank you. Tell me about one project you personally worked on.'
      : session.activeRole === 'customer'
        ? 'Could you put that benefit in simple customer terms?'
        : 'I caught part of that. Please finish your answer, or say continue when you are ready for the next perspective.';
    return saveResponse(prompt);
  }
  // One accepted answer per question, even if two ASR requests race. The store's
  // compare-and-swap is the cross-process arbiter; the stable reservation key
  // ensures both calls converge on the same answer and cached response.
  const result = await processCandidateTurn({
    session, answer, upstreamTurnId: question.id,
    reservationKey: turnDedupeKey(session.id, question.id, 'demo-answer'),
  });
  return saveResponse(result.responseText);
}

/**
 * Move on from a code/canvas task without creating a fake candidate answer.
 * "Check now" and "continue" are workspace controls, never assessment evidence.
 */
export async function advanceDemoWorkspace(input: {
  session: InterviewSessionRecord;
  upstreamTurnId: string;
  outcome: 'completed' | 'skipped';
}): Promise<string> {
  const initialEvents = await interviewStore.listEvents(input.session.id);
  const cached = initialEvents.find((event) => event.type === 'demo.workspace_response'
    && event.payload.requestId === input.upstreamTurnId);
  if (cached) return String(cached.payload.text ?? '');

  const session = await interviewStore.getSession(input.session.id);
  if (!session || !['ready', 'in_progress'].includes(session.status)) throw new Error('Session is not active');
  if (session.currentModality !== 'code' && session.currentModality !== 'canvas') {
    return 'There is no active workspace task to complete. Please answer the current question, or ask me to repeat it.';
  }
  const version = await interviewStore.getInterviewVersion(session.interviewVersionId);
  if (!version?.definition.demoMode) return 'The workspace review is recorded. Please continue with your explanation when you are ready.';
  const interview = await interviewStore.getInterview(session.interviewId, session.organizationId);
  if (!interview) throw new Error('Interview definition is unavailable');

  const completedArtifact = input.outcome === 'completed'
    ? await interviewStore.getLatestArtifactVersion(session.id, session.currentModality)
    : null;
  await interviewStore.appendEvent(session.id, input.outcome === 'completed' ? 'demo.workspace_completed' : 'demo.workspace_skipped', {
    requestId: input.upstreamTurnId,
    role: session.activeRole,
    modality: session.currentModality,
    ...(completedArtifact ? { artifactVersionId: completedArtifact.id } : {}),
  });
  const events = await interviewStore.listEvents(session.id);
  const completed = new Set(events
    .filter((event) => event.type === 'demo.workspace_completed' || event.type === 'demo.workspace_skipped')
    .map((event) => event.payload.role)
    .filter((role): role is PanelRole => typeof role === 'string' && interview.panelRoles.includes(role as PanelRole)));
  const next = demoRoles(interview.panelRoles).find((role) => !completed.has(role) && role !== 'hiring_manager');

  const extendedDemo = interview.durationMinutes >= 10;
  const workspace = next === 'technical'
    ? demoWorkspaceQuestion(interview, version.plan, extendedDemo ? 'code' : undefined)
    : next === 'product' && extendedDemo
      ? demoWorkspaceQuestion(interview, version.plan, 'canvas')
      : null;
  const modality = workspace?.modality ?? (next === 'customer' ? 'scenario' : 'voice');
  const text = next
    ? `${ROLE_LABEL[next]} here. ${workspace?.objective ?? demoQuestionForRole(next)}`
    : DEMO_CLOSING;

  const updated = await interviewStore.updateSession(session.id, {
    previousRole: session.activeRole,
    activeRole: next ?? session.activeRole,
    consecutiveRoleTurns: next === session.activeRole ? session.consecutiveRoleTurns + 1 : 1,
    currentModality: modality,
    phase: next ? 'panel' : 'wrap_up',
    pendingQuestion: text,
    stateVersion: session.stateVersion + 1,
  }, session.stateVersion);
  await interviewStore.createTurn({
    sessionId: session.id,
    speaker: 'interviewer',
    speakerRole: next ?? session.activeRole,
    text,
    status: 'final',
    dedupeKey: turnDedupeKey(session.id, text, `workspace-handoff:${input.upstreamTurnId}`),
  });
  await interviewStore.appendEvent(session.id, 'demo.workspace_handoff', {
    requestId: input.upstreamTurnId,
    fromRole: session.activeRole,
    toRole: updated.activeRole,
    text,
  });
  await interviewStore.appendEvent(session.id, 'demo.workspace_response', {
    requestId: input.upstreamTurnId,
    text,
  });
  return text;
}
