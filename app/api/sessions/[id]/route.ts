import { NextResponse } from 'next/server';
import { requireCandidateSession } from '@/lib/api-auth';
import { apiError } from '@/lib/http';
import { interviewStore } from '@/lib/interview-store';
import { requireCompanyContext } from '@/lib/supabase-admin';
import { answeredDemoRoles, demoRoles } from '@/lib/interview-demo';
import { demoQuestion } from '@/lib/demo-turns';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await interviewStore.getSession(id);
    if (!session) throw new Error('Session not found');
    if (request.headers.get('authorization')) {
      const company = await requireCompanyContext(request);
      if (session.organizationId !== company.organizationId) throw new Error('Session not found');
      const base = {
        id: session.id,
        status: session.status,
        health: session.status === 'failed' ? 'error' : session.connectionHealth,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      };
      if (session.status !== 'completed') return NextResponse.json({ session: base });
      const [transcript, assessment, artifacts, toolRuns, events] = await Promise.all([
        interviewStore.listTurns(id),
        interviewStore.getAssessment(id),
        Promise.all([interviewStore.getArtifact(id, 'code'), interviewStore.getArtifact(id, 'canvas')]),
        interviewStore.listToolRuns(id),
        interviewStore.listEvents(id),
      ]);
      return NextResponse.json({ session: base, transcript, assessment, artifacts, toolRuns, events });
    }

    await requireCandidateSession(request, id);
    const [assessment, events] = await Promise.all([
      interviewStore.getAssessment(id),
      interviewStore.listEvents(id),
    ]);
    const version = await interviewStore.getInterviewVersion(session.interviewVersionId);
    const demo = version?.definition.demoMode ? {
      roles: demoRoles(version.definition.panelRoles),
      answeredRoles: answeredDemoRoles(version.definition.panelRoles, await interviewStore.listAnalyses(id)),
      closing: session.phase === 'wrap_up',
      pendingQuestion: demoQuestion(session),
    } : null;
    return NextResponse.json({
      session: {
        id,
        status: session.status,
        completedAt: session.completedAt,
        activeRole: session.activeRole,
        currentModality: session.currentModality,
        phase: session.phase,
        workspacePrompt: ['code', 'canvas'].includes(session.currentModality) ? session.pendingQuestion : null,
        demo,
        interviewEndsAt: version && session.status === 'in_progress'
          ? new Date(Date.parse(session.startedAt) + version.definition.durationMinutes * 60_000).toISOString()
          : null,
      },
      feedback: assessment?.releasedAt ? assessment.assessment.candidateSummary : null,
      feedbackReleasedAt: assessment?.releasedAt ?? null,
      humanReviewRequired: true,
      // These captions are server-confirmed STT input sent to the custom LLM.
      // They are returned only to the candidate's signed session, never via the
      // company Realtime feed.
      liveCaptions: events
        .filter((event) => event.type === 'candidate.live_caption' && typeof event.payload.text === 'string')
        .slice(-30)
        .map((event) => ({ id: event.id, text: String(event.payload.text), createdAt: event.createdAt })),
    });
  } catch (error) {
    return apiError(error, 'Failed to load interview session');
  }
}
