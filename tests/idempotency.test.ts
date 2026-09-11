import assert from 'node:assert/strict';
import test from 'node:test';
import { processCandidateTurn, processConversationControlTurn } from '@/lib/interview-controller';
import { buildFallbackPlan } from '@/lib/interview-planner';
import { interviewStore, resetMemoryStoreForTests } from '@/lib/interview-store';
import type { InterviewSessionRecord } from '@/types/interview';
import { answeredDemoRoles, DEMO_CLOSING, DEMO_OPENING_QUESTION, DEMO_ROLES } from '@/lib/interview-demo';
import { advanceDemoWorkspace, demoQuestion, processDemoAnswer, mergeAnswerFragments, isIncompleteDemoAnswer } from '@/lib/demo-turns';
import { respondToWorkspaceCommand } from '@/lib/workspace-conversation';
import { POST as recordSessionEvent } from '@/app/api/sessions/[id]/events/route';
import { candidateCookieName, createCandidateGrant } from '@/lib/security';

test('duplicate Agora LLM requests reuse one reserved turn and cached response', async () => {
  resetMemoryStoreForTests();
  delete process.env.GROQ_API_KEY;
  const organizationId = crypto.randomUUID();
  const interview = await interviewStore.createInterview(organizationId, {
    title: 'Idempotency interview',
    roleTitle: 'Backend Engineer',
    jdText: 'Build reliable TypeScript APIs, reason about system constraints, and connect engineering work to measurable customer outcomes.',
    desiredOutcomes: ['Reliable delivery'],
    panelRoles: ['technical', 'product'],
    mustAskQuestions: [],
    mustCoverTopics: [],
    durationMinutes: 30,
    instructions: '',
  });
  const planned = await interviewStore.setInterviewPlan(interview.id, organizationId, buildFallbackPlan(interview));
  const version = await interviewStore.createInterviewVersion(planned);
  const invitation = await interviewStore.createInvitation({
    id: crypto.randomUUID(),
    interviewId: interview.id,
    interviewVersionId: version.id,
    organizationId,
    tokenHash: 'b'.repeat(64),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revokedAt: null,
    claimedAt: null,
    candidateName: null,
    candidateEmail: null,
    resumePath: null,
    createdAt: new Date().toISOString(),
  });
  const session: InterviewSessionRecord = {
    id: crypto.randomUUID(),
    invitationId: invitation.id,
    interviewId: interview.id,
    interviewVersionId: version.id,
    organizationId,
    status: 'in_progress',
    connectionHealth: 'connected',
    channelName: 'idempotency-channel',
    rtcUid: '2001',
    agentUid: '123456',
    agoraAgentId: 'agent',
    llmTokenHash: 'c'.repeat(64),
    activeRole: 'technical',
    previousRole: null,
    consecutiveRoleTurns: 0,
    currentModality: 'voice',
    phase: 'panel',
    competencyState: {},
    askedMustAsk: [],
    coveredTopics: [],
    pendingQuestion: null,
    stateVersion: 0,
    toolRunCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await interviewStore.createSession(invitation, session);
  const args = {
    session,
    answer: 'I implemented a typed cache API because latency was high, added tests, and reduced p95 latency by 35 percent.',
    upstreamTurnId: 'same-agora-request',
  };
  const first = await processCandidateTurn(args);
  const second = await processCandidateTurn(args);
  assert.equal(second.id, first.id);
  assert.equal((await interviewStore.listAnalyses(session.id)).length, 1);
  assert.equal((await interviewStore.listTurns(session.id)).length, 2);
  assert.equal((await interviewStore.getSession(session.id))?.stateVersion, 1);
});

test('duplicate pause requests do not advance state or duplicate transcript turns', async () => {
  resetMemoryStoreForTests();
  const organizationId = crypto.randomUUID();
  const interview = await interviewStore.createInterview(organizationId, {
    title: 'Conversation control interview',
    roleTitle: 'Backend Engineer',
    jdText: 'Build reliable services and explain engineering trade-offs clearly to product and customer partners.',
    desiredOutcomes: ['Clear communication'],
    panelRoles: ['technical', 'product'],
    mustAskQuestions: [],
    mustCoverTopics: [],
    durationMinutes: 2,
    instructions: '',
  });
  const planned = await interviewStore.setInterviewPlan(interview.id, organizationId, buildFallbackPlan(interview));
  const version = await interviewStore.createInterviewVersion(planned);
  const invitation = await interviewStore.createInvitation({
    id: crypto.randomUUID(), interviewId: interview.id, interviewVersionId: version.id,
    organizationId, tokenHash: 'd'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    revokedAt: null, claimedAt: null, candidateName: null, candidateEmail: null, resumePath: null,
    createdAt: new Date().toISOString(),
  });
  const controlSession: InterviewSessionRecord = {
    id: crypto.randomUUID(), invitationId: invitation.id, interviewId: interview.id,
    interviewVersionId: version.id, organizationId, status: 'in_progress', connectionHealth: 'connected',
    channelName: 'control-channel', rtcUid: '2002', agentUid: '123456', agoraAgentId: 'agent-control',
    llmTokenHash: 'e'.repeat(64), activeRole: 'technical', previousRole: null, consecutiveRoleTurns: 0,
    currentModality: 'voice', phase: 'introduction', competencyState: {}, askedMustAsk: [], coveredTopics: [],
    pendingQuestion: null, stateVersion: 0, toolRunCount: 0, startedAt: new Date().toISOString(),
    completedAt: null, expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await interviewStore.createSession(invitation, controlSession);
  const args = { session: controlSession, answer: 'Wait, let me think.', control: 'pause' as const, upstreamTurnId: 'pause-1' };
  await processConversationControlTurn(args);
  await processConversationControlTurn(args);
  assert.equal((await interviewStore.listTurns(controlSession.id)).length, 2);
  assert.equal((await interviewStore.getSession(controlSession.id))?.stateVersion, 0);
});

test('showcase ends only after five answers, with pauses and retries preserving progress', async () => {
  resetMemoryStoreForTests();
  delete process.env.GROQ_API_KEY;
  const organizationId = crypto.randomUUID();
  const interview = await interviewStore.createInterview(organizationId, {
    title: 'Complete panel demo', roleTitle: 'Backend Engineer',
    jdText: 'Build reliable services and explain engineering trade-offs clearly to product and customer partners.',
    desiredOutcomes: ['Clear communication'], panelRoles: DEMO_ROLES,
    mustAskQuestions: [], mustCoverTopics: [], durationMinutes: 5, demoMode: true, instructions: '',
  });
  const planned = await interviewStore.setInterviewPlan(interview.id, organizationId, buildFallbackPlan(interview));
  const version = await interviewStore.createInterviewVersion(planned);
  assert.equal(version.definition.demoMode, true);
  const invitation = await interviewStore.createInvitation({
    id: crypto.randomUUID(), interviewId: interview.id, interviewVersionId: version.id,
    organizationId, tokenHash: 'f'.repeat(64), expiresAt: new Date(Date.now() + 600_000).toISOString(),
    revokedAt: null, claimedAt: null, candidateName: null, candidateEmail: null, resumePath: null,
    createdAt: new Date().toISOString(),
  });
  const initial: InterviewSessionRecord = {
    id: crypto.randomUUID(), invitationId: invitation.id, interviewId: interview.id,
    interviewVersionId: version.id, organizationId, status: 'in_progress', connectionHealth: 'connected',
    channelName: 'demo-channel', rtcUid: '2003', agentUid: '123456', agoraAgentId: 'agent-demo',
    llmTokenHash: 'a'.repeat(64), activeRole: 'hiring_manager', previousRole: null, consecutiveRoleTurns: 0,
    currentModality: 'voice', phase: 'background', competencyState: {}, askedMustAsk: [], coveredTopics: [],
    pendingQuestion: DEMO_OPENING_QUESTION, stateVersion: 0, toolRunCount: 0,
    // More than two minutes have elapsed; this must not stop the role sequence.
    startedAt: new Date(Date.now() - 150_000).toISOString(), completedAt: null,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  };
  await interviewStore.createSession(invitation, initial);
  const answers = [
    'I owned a TypeScript cache service and wrote tests because we needed faster database access.',
    'I implemented a 60 second cache because latency was high and tested invalidation after writes.',
    'Customers completed checkout faster and conversion improved by 10 percent in our experiment.',
    'You can check out faster because we save repeated work while keeping your order accurate.',
    'I missed an invalidation bug, added a regression test, and learned to test failure paths first.',
  ];
  for (let index = 0; index < answers.length; index++) {
    const current = (await interviewStore.getSession(initial.id))!;
    const beforePause = await interviewStore.listAnalyses(initial.id);
    // An ASR tail arriving while the next question is interrupted must keep
    // that panel member pending, including Product and Customer.
    const interruptedResponse = await processDemoAnswer({ session: current, answer: 'during the checkout page.', upstreamTurnId: `interrupted-${index}` });
    assert.ok(interruptedResponse.includes(demoQuestion(current).text));
    assert.equal((await interviewStore.listAnalyses(initial.id)).length, index);
    const question = demoQuestion(current);
    const receipt = (payload: Record<string, unknown>, authenticated = true) => recordSessionEvent(new Request('http://localhost/api/sessions/events', {
      method: 'POST', headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { cookie: `${candidateCookieName()}=${createCandidateGrant(initial.id, initial.expiresAt)}` } : {}),
      }, body: JSON.stringify({ type: 'QUESTION_DELIVERED', payload }),
    }), { params: Promise.resolve({ id: initial.id }) });
    assert.equal((await receipt({ questionId: question.id, text: question.text }, false)).status, 401);
    assert.equal((await receipt({ questionId: 'wrong-question', text: question.text })).status, 409);
    assert.equal((await receipt({ questionId: question.id, text: 'Only a fragment.' })).status, 409);
    assert.equal((await receipt({ questionId: question.id, text: question.text })).status, 202);
    assert.equal((await receipt({ questionId: question.id, text: question.text })).status, 202);
    assert.equal((await interviewStore.listEvents(initial.id)).filter((event) => event.type === 'question.delivered' && event.payload.questionId === question.id).length, 1);
    const fragments = index === 0 ? ["Hi. I'm Ashish Kal.", 'I have around two years of experience as a back end engineer.']
      : index === 1 ? ['One technical concrete technical decision,', 'took was']
        : index === 4 ? ['The setback I faced was', 'that'] : [];
    for (const [fragmentIndex, fragment] of fragments.entries()) {
      await processDemoAnswer({ session: current, answer: fragment, upstreamTurnId: `fragment-${index}-${fragmentIndex}` });
      assert.equal((await interviewStore.listAnalyses(initial.id)).length, index);
      assert.equal((await interviewStore.getSession(initial.id))?.activeRole, DEMO_ROLES[index]);
    }
    await processConversationControlTurn({ session: current, answer: 'Wait, let me think.', control: 'pause', upstreamTurnId: `pause-${index}` });
    await processConversationControlTurn({ session: current, answer: 'Repeat please.', control: 'repeat', upstreamTurnId: `repeat-${index}` });
    assert.equal((await interviewStore.listAnalyses(initial.id)).length, beforePause.length);
    const args = { session: current, answer: answers[index], upstreamTurnId: `demo-answer-${index}` };
    const responses = await Promise.all([processDemoAnswer(args), processDemoAnswer(args)]);
    assert.equal(responses[0], responses[1]);
    assert.equal(await processDemoAnswer(args), responses[0]);
    const analyses = await interviewStore.listAnalyses(initial.id);
    const outcome = analyses.at(-1)!;
    assert.deepEqual(answeredDemoRoles(DEMO_ROLES, analyses), DEMO_ROLES.slice(0, index + 1));
    assert.equal(outcome.analysis.roleFindings.length, 5);
    if (index < 4) {
      assert.equal(outcome.decision.activeSpeakerRole, DEMO_ROLES[index + 1]);
      assert.equal(outcome.decision.reasonCode, 'panel_coverage');
    } else {
      assert.equal(outcome.responseText, DEMO_CLOSING);
      assert.equal((await interviewStore.getSession(initial.id))?.phase, 'wrap_up');
      assert.doesNotMatch(outcome.responseText, /\?/);
    }
  }
  assert.equal((await interviewStore.listAnalyses(initial.id)).length, 5);
});

test('demo fragments merge cumulative ASR text and explicit short answers can finish', () => {
  assert.equal(mergeAnswerFragments(['I built a cache', 'I built a cache for checkout', 'for checkout']), 'I built a cache for checkout');
  assert.equal(isIncompleteDemoAnswer('that', 'behavioral'), true);
  assert.equal(isIncompleteDemoAnswer("I don't know.", 'technical'), false);
  assert.equal(isIncompleteDemoAnswer('Please continue.', 'technical'), false);
  assert.equal(isIncompleteDemoAnswer('Next question.', 'technical'), false);
  assert.equal(isIncompleteDemoAnswer("I used Redis. That's my answer.", 'technical'), false);
  assert.equal(isIncompleteDemoAnswer('I skipped the cache because latency was high and', 'technical'), true);
  assert.equal(isIncompleteDemoAnswer('Improved workflow reduced latency.', 'customer'), false);
});

test('an explicit workspace continue advances without creating a candidate answer', async () => {
  resetMemoryStoreForTests();
  delete process.env.GROQ_API_KEY;
  const organizationId = crypto.randomUUID();
  const interview = await interviewStore.createInterview(organizationId, {
    title: 'Workspace skip', roleTitle: 'Intern', jdText: 'Build a small application.',
    desiredOutcomes: ['Explain work'], panelRoles: DEMO_ROLES, mustAskQuestions: [], mustCoverTopics: [],
    durationMinutes: 10, demoMode: true, instructions: '',
  });
  const planned = await interviewStore.setInterviewPlan(interview.id, organizationId, buildFallbackPlan(interview));
  const version = await interviewStore.createInterviewVersion(planned);
  const invitation = await interviewStore.createInvitation({
    id: crypto.randomUUID(), interviewId: interview.id, interviewVersionId: version.id, organizationId,
    tokenHash: 'w'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null,
    claimedAt: null, candidateName: null, candidateEmail: null, resumePath: null, createdAt: new Date().toISOString(),
  });
  const session: InterviewSessionRecord = {
    id: crypto.randomUUID(), invitationId: invitation.id, interviewId: interview.id, interviewVersionId: version.id,
    organizationId, status: 'in_progress', connectionHealth: 'connected', channelName: 'workspace-skip', rtcUid: '2004',
    agentUid: '123456', agoraAgentId: 'agent', llmTokenHash: 's'.repeat(64), activeRole: 'technical', previousRole: 'hiring_manager',
    consecutiveRoleTurns: 1, currentModality: 'code', phase: 'panel', competencyState: {}, askedMustAsk: [], coveredTopics: [],
    pendingQuestion: 'Technical interviewer here. Write a small function.', stateVersion: 0, toolRunCount: 0,
    startedAt: new Date().toISOString(), completedAt: null, expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await interviewStore.createSession(invitation, session);
  // The previous Hiring Manager answer made Technical the pending role.
  const previous = await interviewStore.createTurn({
    sessionId: session.id, speaker: 'candidate', speakerRole: null, text: 'I built a class assignment.', status: 'final', dedupeKey: 'prior',
  });
  await interviewStore.createAnalysis({
    id: crypto.randomUUID(), sessionId: session.id, turnId: previous.id, analysis: {
      roleFindings: DEMO_ROLES.map((role) => ({ role, observations: [], strengths: [], gaps: [] })), competencyEvidence: [], vague: false,
      vagueReason: '', contradictions: [], recommendedDifficultyDelta: 0, recommendedRole: 'technical', recommendedObjective: '', recommendedModality: 'code', addressedTopics: [], toolRequest: null,
    }, decision: { activeSpeakerRole: 'technical', objective: 'Write code', modality: 'code', difficulty: 3, reasonCode: 'panel_coverage', remainingCoverage: [], roleHandoff: true },
    responseText: session.pendingQuestion!, model: 'test', createdAt: new Date().toISOString(),
  });
  const response = await advanceDemoWorkspace({ session, upstreamTurnId: 'skip', outcome: 'skipped' });
  assert.match(response, /Product manager here/);
  assert.equal((await interviewStore.getSession(session.id))?.activeRole, 'product');
  assert.equal((await interviewStore.listTurns(session.id)).filter((turn) => turn.speaker === 'candidate').length, 1);
  assert.equal((await interviewStore.listAnalyses(session.id)).length, 1);
});

test('a completed autosaved workspace review gives feedback and advances without a second continue', async () => {
  resetMemoryStoreForTests();
  delete process.env.GROQ_API_KEY;
  const organizationId = crypto.randomUUID();
  const interview = await interviewStore.createInterview(organizationId, {
    title: 'Workspace review', roleTitle: 'Intern', jdText: 'Build a small application.',
    desiredOutcomes: ['Explain work'], panelRoles: DEMO_ROLES, mustAskQuestions: [], mustCoverTopics: [],
    durationMinutes: 10, demoMode: true, instructions: '',
  });
  const planned = await interviewStore.setInterviewPlan(interview.id, organizationId, buildFallbackPlan(interview));
  const version = await interviewStore.createInterviewVersion(planned);
  const invitation = await interviewStore.createInvitation({
    id: crypto.randomUUID(), interviewId: interview.id, interviewVersionId: version.id, organizationId,
    tokenHash: 'x'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null,
    claimedAt: null, candidateName: null, candidateEmail: null, resumePath: null, createdAt: new Date().toISOString(),
  });
  const session: InterviewSessionRecord = {
    id: crypto.randomUUID(), invitationId: invitation.id, interviewId: interview.id, interviewVersionId: version.id,
    organizationId, status: 'in_progress', connectionHealth: 'connected', channelName: 'workspace-review', rtcUid: '2005',
    agentUid: '123456', agoraAgentId: 'agent', llmTokenHash: 't'.repeat(64), activeRole: 'technical', previousRole: 'hiring_manager',
    consecutiveRoleTurns: 1, currentModality: 'code', phase: 'panel', competencyState: {}, askedMustAsk: [], coveredTopics: [],
    pendingQuestion: 'Implement a function that takes a list of integers and returns the list sorted in ascending order.', stateVersion: 0, toolRunCount: 0,
    startedAt: new Date().toISOString(), completedAt: null, expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  await interviewStore.createSession(invitation, session);
  const previous = await interviewStore.createTurn({ sessionId: session.id, speaker: 'candidate', speakerRole: null, text: 'I built a class assignment.', status: 'final', dedupeKey: 'prior' });
  await interviewStore.createAnalysis({
    id: crypto.randomUUID(), sessionId: session.id, turnId: previous.id, analysis: {
      roleFindings: DEMO_ROLES.map((role) => ({ role, observations: [], strengths: [], gaps: [] })), competencyEvidence: [], vague: false,
      vagueReason: '', contradictions: [], recommendedDifficultyDelta: 0, recommendedRole: 'technical', recommendedObjective: '', recommendedModality: 'code', addressedTopics: [], toolRequest: null,
    }, decision: { activeSpeakerRole: 'technical', objective: 'Write code', modality: 'code', difficulty: 3, reasonCode: 'panel_coverage', remainingCoverage: [], roleHandoff: true }, responseText: session.pendingQuestion!, model: 'test', createdAt: new Date().toISOString(),
  });
  await interviewStore.saveArtifact(session.id, 'code', { language: 'python', source: 'def sort_ascending(values):\n    return sorted(values)' }, 0);
  const savedVersion = await interviewStore.getLatestArtifactVersion(session.id, 'code');
  assert.equal(savedVersion?.version, 1);
  assert.match(String((savedVersion?.content as { source?: string })?.source), /sort_ascending/);
  const response = await respondToWorkspaceCommand(session, 'review', 'autosave-review', 'Updated.');
  assert.match(response, /ascending sort/);
  assert.match(response, /Let’s move to the next panel perspective/);
  assert.match(response, /Product manager here/);
  assert.equal((await interviewStore.getSession(session.id))?.activeRole, 'product');
  const completionEvent = (await interviewStore.listEvents(session.id)).find((event) => event.type === 'demo.workspace_completed');
  assert.equal(completionEvent?.payload.artifactVersionId, savedVersion?.id);
});
