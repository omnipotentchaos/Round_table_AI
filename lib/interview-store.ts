import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import type {
  ArtifactVersionRecord,
  AssessmentRecord,
  FinalAssessment,
  InterviewCreateInput,
  InterviewDefinitionRecord,
  InterviewPlan,
  InterviewSessionRecord,
  InterviewVersionRecord,
  InvitationRecord,
  SessionEventRecord,
  ToolRunRecord,
  TranscriptTurnRecord,
  TurnAnalysisRecord,
  WorkspaceArtifactRecord,
} from '@/types/interview';

type MemoryDatabase = {
  interviews: Map<string, InterviewDefinitionRecord>;
  interviewVersions: Map<string, InterviewVersionRecord>;
  invitations: Map<string, InvitationRecord>;
  sessions: Map<string, InterviewSessionRecord>;
  turns: Map<string, TranscriptTurnRecord>;
  analyses: Map<string, TurnAnalysisRecord>;
  artifacts: Map<string, WorkspaceArtifactRecord>;
  artifactVersions: Map<string, ArtifactVersionRecord>;
  toolRuns: Map<string, ToolRunRecord>;
  events: Map<string, SessionEventRecord>;
  assessments: Map<string, AssessmentRecord>;
};

declare global {
  var __roundtableMemoryDatabase: MemoryDatabase | undefined;
}

function memory(): MemoryDatabase {
  if (!globalThis.__roundtableMemoryDatabase) {
    globalThis.__roundtableMemoryDatabase = {
      interviews: new Map(),
      interviewVersions: new Map(),
      invitations: new Map(),
      sessions: new Map(),
      turns: new Map(),
      analyses: new Map(),
      artifacts: new Map(),
      artifactVersions: new Map(),
      toolRuns: new Map(),
      events: new Map(),
      assessments: new Map(),
    };
  }
  return globalThis.__roundtableMemoryDatabase;
}

function now(): string {
  return new Date().toISOString();
}

function throwDatabase(error: { message?: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message ?? 'database error'}`);
}

function interviewFromRow(row: Record<string, unknown>): InterviewDefinitionRecord {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    title: String(row.title),
    roleTitle: String(row.role_title),
    jdText: String(row.jd_text),
    desiredOutcomes: (row.desired_outcomes ?? []) as string[],
    panelRoles: row.panel_roles as InterviewDefinitionRecord['panelRoles'],
    mustAskQuestions: (row.must_ask_questions ?? []) as string[],
    mustCoverTopics: (row.must_cover_topics ?? []) as string[],
    durationMinutes: Number(row.duration_minutes),
    demoMode: row.demo_mode === true,
    linearIssueIdentifier: row.linear_issue_identifier ? String(row.linear_issue_identifier) : undefined,
    instructions: String(row.instructions ?? ''),
    status: row.status as InterviewDefinitionRecord['status'],
    plan: (row.plan as InterviewPlan | null) ?? null,
    planVersion: Number(row.plan_version ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function invitationFromRow(row: Record<string, unknown>): InvitationRecord {
  return {
    id: String(row.id),
    interviewId: String(row.interview_id),
    interviewVersionId: String(row.interview_version_id),
    organizationId: String(row.organization_id),
    tokenHash: String(row.token_hash),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    claimedAt: row.claimed_at ? String(row.claimed_at) : null,
    candidateName: row.candidate_name ? String(row.candidate_name) : null,
    candidateEmail: row.candidate_email ? String(row.candidate_email) : null,
    resumePath: row.resume_path ? String(row.resume_path) : null,
    createdAt: String(row.created_at),
  };
}

function sessionFromRow(row: Record<string, unknown>): InterviewSessionRecord {
  return {
    id: String(row.id),
    invitationId: String(row.invitation_id),
    interviewId: String(row.interview_id),
    interviewVersionId: String(row.interview_version_id),
    organizationId: String(row.organization_id),
    status: row.status as InterviewSessionRecord['status'],
    connectionHealth: (row.connection_health as InterviewSessionRecord['connectionHealth']) ?? 'unknown',
    channelName: String(row.channel_name),
    rtcUid: String(row.rtc_uid),
    agentUid: String(row.agent_uid),
    agoraAgentId: row.agora_agent_id ? String(row.agora_agent_id) : null,
    llmTokenHash: String(row.llm_token_hash),
    activeRole: row.active_role as InterviewSessionRecord['activeRole'],
    previousRole: (row.previous_role as InterviewSessionRecord['previousRole']) ?? null,
    consecutiveRoleTurns: Number(row.consecutive_role_turns ?? 0),
    currentModality: row.current_modality as InterviewSessionRecord['currentModality'],
    phase: (row.phase as InterviewSessionRecord['phase']) ?? 'introduction',
    competencyState: row.competency_state as InterviewSessionRecord['competencyState'],
    askedMustAsk: (row.asked_must_ask ?? []) as string[],
    coveredTopics: (row.covered_topics ?? []) as string[],
    pendingQuestion: row.pending_question ? String(row.pending_question) : null,
    stateVersion: Number(row.state_version ?? 0),
    toolRunCount: Number(row.tool_run_count ?? 0),
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : null,
    expiresAt: String(row.expires_at),
  };
}

function sessionPatch(patch: Partial<InterviewSessionRecord>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const fields: Array<[keyof InterviewSessionRecord, string]> = [
    ['status', 'status'],
    ['connectionHealth', 'connection_health'],
    ['agentUid', 'agent_uid'],
    ['agoraAgentId', 'agora_agent_id'],
    ['llmTokenHash', 'llm_token_hash'],
    ['activeRole', 'active_role'],
    ['previousRole', 'previous_role'],
    ['consecutiveRoleTurns', 'consecutive_role_turns'],
    ['currentModality', 'current_modality'],
    ['phase', 'phase'],
    ['competencyState', 'competency_state'],
    ['askedMustAsk', 'asked_must_ask'],
    ['coveredTopics', 'covered_topics'],
    ['pendingQuestion', 'pending_question'],
    ['stateVersion', 'state_version'],
    ['toolRunCount', 'tool_run_count'],
    ['startedAt', 'started_at'],
    ['completedAt', 'completed_at'],
  ];
  for (const [source, destination] of fields) {
    if (source in patch) output[destination] = patch[source] ?? null;
  }
  return output;
}

export const interviewStore = {
  async createInterview(
    organizationId: string,
    input: InterviewCreateInput,
  ): Promise<InterviewDefinitionRecord> {
    const timestamp = now();
    const record: InterviewDefinitionRecord = {
      ...input,
      id: randomUUID(),
      organizationId,
      status: 'draft',
      plan: null,
      planVersion: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().interviews.set(record.id, record);
      return record;
    }

    const { data, error } = await admin
      .from('interview_definitions')
      .insert({
        id: record.id,
        organization_id: organizationId,
        title: input.title,
        role_title: input.roleTitle,
        jd_text: input.jdText,
        desired_outcomes: input.desiredOutcomes,
        panel_roles: input.panelRoles,
        must_ask_questions: input.mustAskQuestions,
        must_cover_topics: input.mustCoverTopics,
        duration_minutes: input.durationMinutes,
        demo_mode: input.demoMode ?? false,
        linear_issue_identifier: input.linearIssueIdentifier ?? null,
        instructions: input.instructions,
      })
      .select('*')
      .single();
    throwDatabase(error, 'create interview');
    return interviewFromRow(data as Record<string, unknown>);
  },

  async listInterviews(organizationId: string): Promise<InterviewDefinitionRecord[]> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().interviews.values()].filter(
        (item) => item.organizationId === organizationId,
      );
    }
    const { data, error } = await admin
      .from('interview_definitions')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    throwDatabase(error, 'list interviews');
    return (data ?? []).map((row) => interviewFromRow(row));
  },

  async getInterview(
    id: string,
    organizationId?: string,
  ): Promise<InterviewDefinitionRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      const record = memory().interviews.get(id) ?? null;
      return record && (!organizationId || record.organizationId === organizationId)
        ? record
        : null;
    }
    let query = admin.from('interview_definitions').select('*').eq('id', id);
    if (organizationId) query = query.eq('organization_id', organizationId);
    const { data, error } = await query.maybeSingle();
    throwDatabase(error, 'get interview');
    return data ? interviewFromRow(data) : null;
  },

  async getOrganizationName(organizationId: string): Promise<string> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return process.env.DEMO_COMPANY_NAME?.trim() || 'the hiring company';
    }
    const { data, error } = await admin
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle();
    throwDatabase(error, 'get organization');
    return data?.name ? String(data.name) : 'the hiring company';
  },

  async setInterviewPlan(
    id: string,
    organizationId: string,
    plan: InterviewPlan,
  ): Promise<InterviewDefinitionRecord> {
    const existing = await this.getInterview(id, organizationId);
    if (!existing) throw new Error('Interview not found');
    const next = {
      ...existing,
      plan,
      planVersion: existing.planVersion + 1,
      status: 'ready' as const,
      updatedAt: now(),
    };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().interviews.set(id, next);
      return next;
    }
    const { data, error } = await admin
      .from('interview_definitions')
      .update({
        plan,
        plan_version: next.planVersion,
        status: 'ready',
        updated_at: next.updatedAt,
      })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('*')
      .single();
    throwDatabase(error, 'set interview plan');
    return interviewFromRow(data as Record<string, unknown>);
  },

  async createInterviewVersion(
    interview: InterviewDefinitionRecord,
  ): Promise<InterviewVersionRecord> {
    if (!interview.plan) throw new Error('Generate and review an interview plan before publishing');
    const record: InterviewVersionRecord = {
      id: randomUUID(),
      interviewId: interview.id,
      organizationId: interview.organizationId,
      version: interview.planVersion,
      definition: {
        title: interview.title,
        roleTitle: interview.roleTitle,
        jdText: interview.jdText,
        desiredOutcomes: interview.desiredOutcomes,
        panelRoles: interview.panelRoles,
        mustAskQuestions: interview.mustAskQuestions,
        mustCoverTopics: interview.mustCoverTopics,
        durationMinutes: interview.durationMinutes,
        demoMode: interview.demoMode ?? false,
        linearIssueIdentifier: interview.linearIssueIdentifier,
        instructions: interview.instructions,
      },
      plan: interview.plan,
      promptVersion: 'roundtable-panel-v1',
      createdAt: now(),
    };
    const admin = getSupabaseAdmin();
    if (!admin) {
      const existing = [...memory().interviewVersions.values()].find(
        (item) => item.interviewId === interview.id && item.version === record.version,
      );
      if (existing) return existing;
      memory().interviewVersions.set(record.id, record);
      return record;
    }
    const { data: existingRow, error: existingError } = await admin
      .from('interview_versions')
      .select('*')
      .eq('interview_id', record.interviewId)
      .eq('version', record.version)
      .maybeSingle();
    throwDatabase(existingError, 'find interview version');
    if (existingRow) return versionFromRow(existingRow);
    const { data, error } = await admin.from('interview_versions').insert({
      id: record.id,
      interview_id: record.interviewId,
      organization_id: record.organizationId,
      version: record.version,
      definition: record.definition,
      plan: record.plan,
      prompt_version: record.promptVersion,
    }).select('*').single();
    if (error?.message?.toLocaleLowerCase().includes('duplicate')) {
      const { data: raced, error: racedError } = await admin
        .from('interview_versions')
        .select('*')
        .eq('interview_id', record.interviewId)
        .eq('version', record.version)
        .single();
      throwDatabase(racedError, 'read concurrent interview version');
      return versionFromRow(raced as Record<string, unknown>);
    }
    throwDatabase(error, 'create interview version');
    return versionFromRow(data as Record<string, unknown>);
  },

  async getInterviewVersion(id: string): Promise<InterviewVersionRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) return memory().interviewVersions.get(id) ?? null;
    const { data, error } = await admin
      .from('interview_versions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwDatabase(error, 'get interview version');
    return data ? versionFromRow(data) : null;
  },

  async createInvitation(record: InvitationRecord): Promise<InvitationRecord> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().invitations.set(record.id, record);
      return record;
    }
    const { data, error } = await admin
      .from('invitations')
      .insert({
        id: record.id,
        interview_id: record.interviewId,
        interview_version_id: record.interviewVersionId,
        organization_id: record.organizationId,
        token_hash: record.tokenHash,
        expires_at: record.expiresAt,
        candidate_name: record.candidateName,
        candidate_email: record.candidateEmail,
        resume_path: record.resumePath,
      })
      .select('*')
      .single();
    throwDatabase(error, 'create invitation');
    return invitationFromRow(data as Record<string, unknown>);
  },

  async getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return (
        [...memory().invitations.values()].find(
          (invitation) => invitation.tokenHash === tokenHash,
        ) ?? null
      );
    }
    const { data, error } = await admin
      .from('invitations')
      .select('*')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    throwDatabase(error, 'get invitation');
    return data ? invitationFromRow(data) : null;
  },

  async getInvitation(id: string, organizationId?: string): Promise<InvitationRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      const record = memory().invitations.get(id) ?? null;
      return record && (!organizationId || record.organizationId === organizationId) ? record : null;
    }
    let query = admin.from('invitations').select('*').eq('id', id);
    if (organizationId) query = query.eq('organization_id', organizationId);
    const { data, error } = await query.maybeSingle();
    throwDatabase(error, 'get invitation');
    return data ? invitationFromRow(data) : null;
  },

  async revokeInvitation(id: string, organizationId: string): Promise<InvitationRecord> {
    const existing = await this.getInvitation(id, organizationId);
    if (!existing) throw new Error('Invitation not found');
    const next = { ...existing, revokedAt: now() };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().invitations.set(id, next);
      return next;
    }
    const { data, error } = await admin
      .from('invitations')
      .update({ revoked_at: next.revokedAt })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('*')
      .single();
    throwDatabase(error, 'revoke invitation');
    return invitationFromRow(data as Record<string, unknown>);
  },

  async setInvitationResumePath(id: string, resumePath: string): Promise<InvitationRecord> {
    const existing = await this.getInvitation(id);
    if (!existing) throw new Error('Invitation not found');
    const next = { ...existing, resumePath };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().invitations.set(id, next);
      return next;
    }
    const { data, error } = await admin
      .from('invitations')
      .update({ resume_path: resumePath })
      .eq('id', id)
      .select('*')
      .single();
    throwDatabase(error, 'set invitation resume path');
    return invitationFromRow(data as Record<string, unknown>);
  },

  async setInvitationCandidateName(id: string, candidateName: string): Promise<InvitationRecord> {
    const existing = await this.getInvitation(id);
    if (!existing) throw new Error('Invitation not found');
    if (existing.claimedAt) throw new Error('Invitation has already been used');
    const next = { ...existing, candidateName };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().invitations.set(id, next);
      return next;
    }
    const { data, error } = await admin
      .from('invitations')
      .update({ candidate_name: candidateName })
      .eq('id', id)
      .is('claimed_at', null)
      .select('*')
      .maybeSingle();
    throwDatabase(error, 'set invitation candidate name');
    if (!data) throw new Error('Invitation has already been used');
    return invitationFromRow(data as Record<string, unknown>);
  },

  async createSession(
    invitation: InvitationRecord,
    session: InterviewSessionRecord,
  ): Promise<InterviewSessionRecord> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      const latestInvitation = memory().invitations.get(invitation.id);
      if (!latestInvitation || latestInvitation.claimedAt) {
        throw new Error('Invitation has already been used');
      }
      memory().invitations.set(invitation.id, {
        ...latestInvitation,
        claimedAt: session.startedAt,
      });
      memory().sessions.set(session.id, session);
      return session;
    }

    const { data, error } = await admin
      .rpc('claim_invitation_and_create_session', {
        target_invitation_id: invitation.id,
        session_record: {
          id: session.id,
          invitation_id: session.invitationId,
          interview_id: session.interviewId,
          interview_version_id: session.interviewVersionId,
          organization_id: session.organizationId,
          status: session.status,
          connection_health: session.connectionHealth,
          channel_name: session.channelName,
          rtc_uid: session.rtcUid,
          agent_uid: session.agentUid,
          llm_token_hash: session.llmTokenHash,
          active_role: session.activeRole,
          current_modality: session.currentModality,
          phase: session.phase,
          competency_state: session.competencyState,
          asked_must_ask: session.askedMustAsk,
          covered_topics: session.coveredTopics,
          state_version: session.stateVersion,
          tool_run_count: session.toolRunCount,
          started_at: session.startedAt,
          expires_at: session.expiresAt,
        },
      })
      .single();
    throwDatabase(error, 'create interview session');
    return sessionFromRow(data as Record<string, unknown>);
  },

  async getSession(id: string): Promise<InterviewSessionRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) return memory().sessions.get(id) ?? null;
    const { data, error } = await admin
      .from('interview_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    throwDatabase(error, 'get session');
    return data ? sessionFromRow(data) : null;
  },

  async listSessionsForInterview(
    interviewId: string,
    organizationId: string,
  ): Promise<InterviewSessionRecord[]> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().sessions.values()]
        .filter((session) => session.interviewId === interviewId && session.organizationId === organizationId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    }
    const { data, error } = await admin
      .from('interview_sessions')
      .select('*')
      .eq('interview_id', interviewId)
      .eq('organization_id', organizationId)
      .order('started_at', { ascending: false });
    throwDatabase(error, 'list interview sessions');
    return (data ?? []).map(sessionFromRow);
  },

  async getSessionByInvitation(invitationId: string): Promise<InterviewSessionRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().sessions.values()].find((session) => session.invitationId === invitationId) ?? null;
    }
    const { data, error } = await admin
      .from('interview_sessions')
      .select('*')
      .eq('invitation_id', invitationId)
      .maybeSingle();
    throwDatabase(error, 'get session by invitation');
    return data ? sessionFromRow(data) : null;
  },

  async getSessionByAgentId(agentId: string): Promise<InterviewSessionRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().sessions.values()].find((session) => session.agoraAgentId === agentId) ?? null;
    }
    const { data, error } = await admin
      .from('interview_sessions')
      .select('*')
      .eq('agora_agent_id', agentId)
      .maybeSingle();
    throwDatabase(error, 'get session by agent id');
    return data ? sessionFromRow(data) : null;
  },

  async getSessionByLlmTokenHash(
    llmTokenHash: string,
  ): Promise<InterviewSessionRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return (
        [...memory().sessions.values()].find(
          (session) => session.llmTokenHash === llmTokenHash,
        ) ?? null
      );
    }
    const { data, error } = await admin
      .from('interview_sessions')
      .select('*')
      .eq('llm_token_hash', llmTokenHash)
      .maybeSingle();
    throwDatabase(error, 'get session by LLM token');
    return data ? sessionFromRow(data) : null;
  },

  async updateSession(
    id: string,
    patch: Partial<InterviewSessionRecord>,
    expectedVersion?: number,
  ): Promise<InterviewSessionRecord> {
    const existing = await this.getSession(id);
    if (!existing) throw new Error('Session not found');
    if (expectedVersion !== undefined && existing.stateVersion !== expectedVersion) {
      throw new Error('Session state changed; retry the turn');
    }
    const next = { ...existing, ...patch };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().sessions.set(id, next);
      return next;
    }
    let query = admin.from('interview_sessions').update(sessionPatch(patch)).eq('id', id);
    if (expectedVersion !== undefined) query = query.eq('state_version', expectedVersion);
    const { data, error } = await query.select('*').maybeSingle();
    throwDatabase(error, 'update session');
    if (!data) throw new Error('Session state changed; retry the turn');
    return sessionFromRow(data);
  },

  async findTurnByDedupeKey(
    sessionId: string,
    dedupeKey: string,
  ): Promise<TranscriptTurnRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return (
        [...memory().turns.values()].find(
          (turn) => turn.sessionId === sessionId && turn.dedupeKey === dedupeKey,
        ) ?? null
      );
    }
    const { data, error } = await admin
      .from('transcript_turns')
      .select('*')
      .eq('session_id', sessionId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    throwDatabase(error, 'find transcript turn');
    return data ? turnFromRow(data) : null;
  },

  async createTurn(
    input: Omit<TranscriptTurnRecord, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<TranscriptTurnRecord> {
    const record: TranscriptTurnRecord = {
      ...input,
      id: randomUUID(),
      sequence: 0,
      createdAt: now(),
    };
    const admin = getSupabaseAdmin();
    if (!admin) {
      // Keep the memory reservation synchronous, matching the database RPC's
      // atomic uniqueness guarantee when overlapping ASR requests arrive.
      const turns = [...memory().turns.values()].filter((turn) => turn.sessionId === input.sessionId);
      const duplicate = turns.find((turn) => turn.dedupeKey === input.dedupeKey);
      if (duplicate) return duplicate;
      const localRecord = { ...record, sequence: turns.length + 1 };
      memory().turns.set(localRecord.id, localRecord);
      return localRecord;
    }
    const { data, error } = await admin
      .rpc('reserve_transcript_turn', {
        target_session_id: record.sessionId,
        target_turn_id: record.id,
        target_speaker: record.speaker,
        target_speaker_role: record.speakerRole,
        target_text: record.text,
        target_status: record.status,
        target_dedupe_key: record.dedupeKey,
      })
      .single();
    throwDatabase(error, 'create transcript turn');
    return turnFromRow(data as Record<string, unknown>);
  },

  async listTurns(sessionId: string): Promise<TranscriptTurnRecord[]> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().turns.values()]
        .filter((turn) => turn.sessionId === sessionId)
        .sort((a, b) => a.sequence - b.sequence);
    }
    const { data, error } = await admin
      .from('transcript_turns')
      .select('*')
      .eq('session_id', sessionId)
      .order('sequence', { ascending: true });
    throwDatabase(error, 'list transcript turns');
    return (data ?? []).map(turnFromRow);
  },

  async markLatestInterviewerTurnInterrupted(sessionId: string): Promise<void> {
    const turns = await this.listTurns(sessionId);
    const latest = [...turns].reverse().find((turn) => turn.speaker === 'interviewer' && turn.status === 'final');
    if (!latest) return;
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().turns.set(latest.id, { ...latest, status: 'interrupted' });
      return;
    }
    const { error } = await admin
      .from('transcript_turns')
      .update({ status: 'interrupted' })
      .eq('id', latest.id)
      .eq('session_id', sessionId);
    throwDatabase(error, 'mark interviewer turn interrupted');
  },

  async createAnalysis(record: TurnAnalysisRecord): Promise<TurnAnalysisRecord> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().analyses.set(record.id, record);
      return record;
    }
    const { error } = await admin.from('turn_analyses').insert({
      id: record.id,
      session_id: record.sessionId,
      turn_id: record.turnId,
      analysis: record.analysis,
      decision: record.decision,
      response_text: record.responseText,
      model: record.model,
      created_at: record.createdAt,
    });
    throwDatabase(error, 'create turn analysis');
    return record;
  },

  async commitTurnOutcome({
    expectedVersion,
    sessionPatch: patch,
    interviewerTurn,
    analysis,
  }: {
    expectedVersion: number;
    sessionPatch: Partial<InterviewSessionRecord>;
    interviewerTurn: Omit<TranscriptTurnRecord, 'id' | 'sequence' | 'createdAt'>;
    analysis: TurnAnalysisRecord;
  }): Promise<TurnAnalysisRecord> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      const cached = [...memory().analyses.values()].find((item) => item.turnId === analysis.turnId);
      if (cached) return cached;
      const existing = memory().sessions.get(analysis.sessionId);
      if (!existing) throw new Error('Session not found');
      if (existing.stateVersion !== expectedVersion) throw new Error('Session state changed; retry the turn');
      memory().sessions.set(existing.id, { ...existing, ...patch });
      const duplicateTurn = [...memory().turns.values()].find(
        (turn) => turn.sessionId === interviewerTurn.sessionId && turn.dedupeKey === interviewerTurn.dedupeKey,
      );
      if (!duplicateTurn) {
        const sequence = [...memory().turns.values()].filter((turn) => turn.sessionId === interviewerTurn.sessionId).length + 1;
        const turn: TranscriptTurnRecord = { ...interviewerTurn, id: randomUUID(), sequence, createdAt: now() };
        memory().turns.set(turn.id, turn);
      }
      memory().analyses.set(analysis.id, analysis);
      return analysis;
    }

    const { data, error } = await admin.rpc('commit_interview_turn_outcome', {
      target_session_id: analysis.sessionId,
      expected_state_version: expectedVersion,
      session_patch: sessionPatch(patch),
      interviewer_turn: {
        id: randomUUID(),
        session_id: interviewerTurn.sessionId,
        speaker: interviewerTurn.speaker,
        speaker_role: interviewerTurn.speakerRole,
        text: interviewerTurn.text,
        status: interviewerTurn.status,
        dedupe_key: interviewerTurn.dedupeKey,
      },
      analysis_record: {
        id: analysis.id,
        session_id: analysis.sessionId,
        turn_id: analysis.turnId,
        analysis: analysis.analysis,
        decision: analysis.decision,
        response_text: analysis.responseText,
        model: analysis.model,
        created_at: analysis.createdAt,
      },
    });
    throwDatabase(error, 'commit interview turn outcome');
    return analysisFromRow(data as Record<string, unknown>);
  },

  async getAnalysisByTurn(turnId: string): Promise<TurnAnalysisRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return (
        [...memory().analyses.values()].find((analysis) => analysis.turnId === turnId) ??
        null
      );
    }
    const { data, error } = await admin
      .from('turn_analyses')
      .select('*')
      .eq('turn_id', turnId)
      .maybeSingle();
    throwDatabase(error, 'get turn analysis');
    return data ? analysisFromRow(data) : null;
  },

  async listAnalyses(sessionId: string): Promise<TurnAnalysisRecord[]> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().analyses.values()]
        .filter((analysis) => analysis.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    const { data, error } = await admin
      .from('turn_analyses')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    throwDatabase(error, 'list turn analyses');
    return (data ?? []).map(analysisFromRow);
  },

  async saveArtifact(
    sessionId: string,
    type: 'code' | 'canvas',
    content: unknown,
    expectedVersion: number,
  ): Promise<WorkspaceArtifactRecord> {
    const existing = await this.getArtifact(sessionId, type);
    if (existing && existing.version !== expectedVersion) {
      throw new Error('Artifact version conflict');
    }
    if (!existing && expectedVersion !== 0) throw new Error('Artifact version conflict');
    const timestamp = now();
    const record: WorkspaceArtifactRecord = {
      id: existing?.id ?? randomUUID(),
      sessionId,
      type,
      version: expectedVersion + 1,
      content,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().artifacts.set(`${sessionId}:${type}`, record);
      const versionRecord: ArtifactVersionRecord = {
        id: randomUUID(),
        artifactId: record.id,
        sessionId,
        type,
        version: record.version,
        content,
        createdAt: timestamp,
      };
      memory().artifactVersions.set(`${record.id}:${record.version}`, versionRecord);
      return record;
    }
    const payload = {
      id: record.id,
      session_id: sessionId,
      type,
      version: record.version,
      content,
      updated_at: timestamp,
    };
    const operation = existing
      ? admin.from('workspace_artifacts').update(payload).eq('id', existing.id).eq('version', expectedVersion)
      : admin.from('workspace_artifacts').insert(payload);
    const { data, error } = await operation.select('*').maybeSingle();
    throwDatabase(error, 'save workspace artifact');
    if (!data) throw new Error('Artifact version conflict');
    return artifactFromRow(data as Record<string, unknown>);
  },

  async getArtifact(
    sessionId: string,
    type: 'code' | 'canvas',
  ): Promise<WorkspaceArtifactRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) return memory().artifacts.get(`${sessionId}:${type}`) ?? null;
    const { data, error } = await admin
      .from('workspace_artifacts')
      .select('*')
      .eq('session_id', sessionId)
      .eq('type', type)
      .maybeSingle();
    throwDatabase(error, 'get workspace artifact');
    return data ? artifactFromRow(data) : null;
  },

  async getLatestArtifactVersion(
    sessionId: string,
    type: 'code' | 'canvas',
  ): Promise<ArtifactVersionRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().artifactVersions.values()]
        .filter((item) => item.sessionId === sessionId && item.type === type)
        .sort((a, b) => b.version - a.version)[0] ?? null;
    }
    const { data, error } = await admin
      .from('artifact_versions')
      .select('*')
      .eq('session_id', sessionId)
      .eq('type', type)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    throwDatabase(error, 'get latest artifact version');
    return data ? artifactVersionFromRow(data) : null;
  },

  async getArtifactVersion(
    sessionId: string,
    id: string,
  ): Promise<ArtifactVersionRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().artifactVersions.values()].find((item) => item.sessionId === sessionId && item.id === id) ?? null;
    }
    const { data, error } = await admin
      .from('artifact_versions')
      .select('*')
      .eq('session_id', sessionId)
      .eq('id', id)
      .maybeSingle();
    throwDatabase(error, 'get artifact version');
    return data ? artifactVersionFromRow(data) : null;
  },

  async createToolRun(record: ToolRunRecord): Promise<ToolRunRecord> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().toolRuns.set(record.id, record);
      return record;
    }
    const { error } = await admin.from('tool_runs').insert({
      id: record.id,
      session_id: record.sessionId,
      name: record.name,
      input: record.input,
      output: record.output,
      status: record.status,
      created_at: record.createdAt,
    });
    throwDatabase(error, 'create tool run');
    return record;
  },

  async listToolRuns(sessionId: string): Promise<ToolRunRecord[]> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().toolRuns.values()].filter((run) => run.sessionId === sessionId);
    }
    const { data, error } = await admin
      .from('tool_runs')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    throwDatabase(error, 'list tool runs');
    return (data ?? []).map(toolRunFromRow);
  },

  async appendEvent(
    sessionId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<SessionEventRecord> {
    const record: SessionEventRecord = {
      id: randomUUID(),
      sessionId,
      type,
      payload,
      createdAt: now(),
    };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().events.set(record.id, record);
      return record;
    }
    const { error } = await admin.from('session_events').insert({
      id: record.id,
      session_id: sessionId,
      type,
      payload,
      created_at: record.createdAt,
    });
    throwDatabase(error, 'append session event');
    return record;
  },

  async listEvents(sessionId: string): Promise<SessionEventRecord[]> {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return [...memory().events.values()]
        .filter((event) => event.sessionId === sessionId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    const { data, error } = await admin
      .from('session_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    throwDatabase(error, 'list session events');
    return (data ?? []).map(eventFromRow);
  },

  async upsertAssessment(
    sessionId: string,
    assessment: FinalAssessment,
  ): Promise<AssessmentRecord> {
    const existing = await this.getAssessment(sessionId);
    const timestamp = now();
    const record: AssessmentRecord = {
      id: existing?.id ?? randomUUID(),
      sessionId,
      assessment,
      releasedAt: existing?.releasedAt ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().assessments.set(sessionId, record);
      return record;
    }
    const { data, error } = await admin
      .from('assessments')
      .upsert({
        id: record.id,
        session_id: sessionId,
        assessment,
        updated_at: timestamp,
      }, { onConflict: 'session_id' })
      .select('*')
      .single();
    throwDatabase(error, 'upsert assessment');
    return assessmentFromRow(data as Record<string, unknown>);
  },

  async getAssessment(sessionId: string): Promise<AssessmentRecord | null> {
    const admin = getSupabaseAdmin();
    if (!admin) return memory().assessments.get(sessionId) ?? null;
    const { data, error } = await admin
      .from('assessments')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();
    throwDatabase(error, 'get assessment');
    return data ? assessmentFromRow(data) : null;
  },

  async releaseAssessment(sessionId: string): Promise<AssessmentRecord> {
    const existing = await this.getAssessment(sessionId);
    if (!existing) throw new Error('Assessment not found');
    const releasedAt = now();
    const next = { ...existing, releasedAt, updatedAt: releasedAt };
    const admin = getSupabaseAdmin();
    if (!admin) {
      memory().assessments.set(sessionId, next);
      return next;
    }
    const { data, error } = await admin
      .from('assessments')
      .update({ released_at: releasedAt, updated_at: releasedAt })
      .eq('session_id', sessionId)
      .select('*')
      .single();
    throwDatabase(error, 'release assessment');
    return assessmentFromRow(data as Record<string, unknown>);
  },
};

function versionFromRow(row: Record<string, unknown>): InterviewVersionRecord {
  return {
    id: String(row.id),
    interviewId: String(row.interview_id),
    organizationId: String(row.organization_id),
    version: Number(row.version),
    definition: row.definition as InterviewVersionRecord['definition'],
    plan: row.plan as InterviewPlan,
    promptVersion: String(row.prompt_version),
    createdAt: String(row.created_at),
  };
}

function turnFromRow(row: Record<string, unknown>): TranscriptTurnRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    sequence: Number(row.sequence),
    speaker: row.speaker as TranscriptTurnRecord['speaker'],
    speakerRole: (row.speaker_role as TranscriptTurnRecord['speakerRole']) ?? null,
    text: String(row.text),
    status: row.status as TranscriptTurnRecord['status'],
    dedupeKey: String(row.dedupe_key),
    createdAt: String(row.created_at),
  };
}

function analysisFromRow(row: Record<string, unknown>): TurnAnalysisRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    turnId: String(row.turn_id),
    analysis: row.analysis as TurnAnalysisRecord['analysis'],
    decision: row.decision as TurnAnalysisRecord['decision'],
    responseText: String(row.response_text),
    model: String(row.model),
    createdAt: String(row.created_at),
  };
}

function artifactFromRow(row: Record<string, unknown>): WorkspaceArtifactRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    type: row.type as WorkspaceArtifactRecord['type'],
    version: Number(row.version),
    content: row.content,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function artifactVersionFromRow(row: Record<string, unknown>): ArtifactVersionRecord {
  return {
    id: String(row.id),
    artifactId: String(row.artifact_id),
    sessionId: String(row.session_id),
    type: row.type as ArtifactVersionRecord['type'],
    version: Number(row.version),
    content: row.content,
    createdAt: String(row.created_at),
  };
}

function toolRunFromRow(row: Record<string, unknown>): ToolRunRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    name: row.name as ToolRunRecord['name'],
    input: (row.input ?? {}) as Record<string, unknown>,
    output: row.output,
    status: row.status as ToolRunRecord['status'],
    createdAt: String(row.created_at),
  };
}

function assessmentFromRow(row: Record<string, unknown>): AssessmentRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    assessment: row.assessment as FinalAssessment,
    releasedAt: row.released_at ? String(row.released_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function eventFromRow(row: Record<string, unknown>): SessionEventRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    type: String(row.type),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

export function resetMemoryStoreForTests(): void {
  globalThis.__roundtableMemoryDatabase = undefined;
}
