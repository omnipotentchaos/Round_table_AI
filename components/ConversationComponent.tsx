'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AgoraRTC, {
  useRTCClient,
  useLocalMicrophoneTrack,
  useRemoteUsers,
  useClientEvent,
  useJoin,
  usePublish,
  RemoteUser,
  UID,
} from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  AgentState,
  MessageSalStatus,
  TranscriptHelperMode,
  TurnStatus,
  type TranscriptHelperItem,
  type UserTranscription,
  type AgentTranscription,
} from 'agora-agent-client-toolkit';
import { AgentVisualizer } from './AgentVisualizer';
import { MicButtonWithVisualizer } from './MicButtonWithVisualizer';
import { AGENT_UIDS } from '@/lib/agora';
import {
  getCurrentInProgressMessage,
  getMessageList,
  mapAgentVisualizerState,
  normalizeTimestampMs,
  normalizeTranscript,
} from '@/lib/conversation';
import { MicrophoneSelector } from './MicrophoneSelector';
import {
  getConversationIssueSeverity,
  type ConnectionIssue,
} from './ConversationErrorCard';
import { ConnectionStatusPanel } from './ConnectionStatusPanel';
import { QuickstartConversationLayout } from './QuickstartConversationLayout';
import {
  QuickstartPipelineMetrics,
  type QuickstartAgentMetric,
} from './QuickstartPipelineMetrics';
import { QuickstartTranscriptPanel } from './QuickstartTranscriptPanel';
import { PanelAvatar } from './PanelAvatar';
import type { ConversationComponentProps } from '@/types/conversation';
import { DEMO_CLOSING, normalizeSpokenText } from '@/lib/interview-demo';

// Cap the displayed issues list to avoid overwhelming the UI during a cascade of errors.
const MAX_CONNECTION_ISSUES = 6;

type ServerCaption = { id: string; text: string; createdAt: string };

type AgoraRtcWithParameters = typeof AgoraRTC & {
  setParameter?: (key: string, value: unknown) => void;
};

// Payload shape for signaling-level errors forwarded by the agent over RTM.
// The `module` field identifies which backend subsystem (LLM / ASR / TTS) raised the error.
type RtmMessageErrorPayload = {
  object: 'message.error';
  module?: string;
  code?: number;
  message?: string;
  send_ts?: number;
};

// Payload shape for SAL (Session Abstraction Layer) registration status messages.
// VP_REGISTER_FAIL and VP_REGISTER_DUPLICATE indicate RTM channel subscription problems.
type RtmSalStatusPayload = {
  object: 'message.sal_status';
  status?: string;
  timestamp?: number;
};

// Type guard for RTM signaling-level error payloads (object: 'message.error').
function isRtmMessageErrorPayload(
  value: unknown,
): value is RtmMessageErrorPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { object?: unknown }).object === 'message.error'
  );
}

// Type guard for RTM SAL status payloads (object: 'message.sal_status').
function isRtmSalStatusPayload(value: unknown): value is RtmSalStatusPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { object?: unknown }).object === 'message.sal_status'
  );
}

export default function ConversationComponent({
  agoraData,
  rtmClient,
  onTokenWillExpire,
  onEndConversation,
  compactDemo = false,
  companionDemo = false,
}: ConversationComponentProps) {
  const agentUIDs = AGENT_UIDS;

  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [isEnabled, setIsEnabled] = useState(true);
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [isConnectionDetailsOpen, setIsConnectionDetailsOpen] = useState(false);
  const [activeModality, setActiveModality] = useState<'voice' | 'code' | 'canvas' | 'scenario'>('voice');
  const [activeRole, setActiveRole] = useState('technical');
  const [workspacePrompt, setWorkspacePrompt] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState('introduction');
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState<number | null>(null);
  const autoEndTriggeredRef = useRef(false);
  const interruptedTurnIdsRef = useRef(new Set<number>());
  const [demoProgress, setDemoProgress] = useState<{ roles: string[]; answeredRoles: string[]; closing: boolean } | null>(null);
  const [serverDeadline, setServerDeadline] = useState<string | null>(null);
  const [pendingDemoQuestion, setPendingDemoQuestion] = useState<{ id: string; text: string } | null>(null);
  const [serverCaptions, setServerCaptions] = useState<ServerCaption[]>([]);
  const [serverCaptionProcessing, setServerCaptionProcessing] = useState(false);
  const latestServerCaptionIdRef = useRef<string | null>(null);
  const serverCaptionTimerRef = useRef<number | null>(null);
  const deliveredQuestionsRef = useRef(new Set<string>());
  const finishedAgentTurnsRef = useRef(new Set<number>());

  const logEvent = useCallback((type: 'AGENT_STATE_CHANGED' | 'METRICS' | 'ERROR' | 'CONNECTION_STATE' | 'INTERRUPTED', payload: Record<string, unknown>) => {
    if (!agoraData.sessionId) return;
    fetch(`/api/sessions/${agoraData.sessionId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    }).catch(() => {});
  }, [agoraData.sessionId]);

  useEffect(() => {
    if (!agoraData.sessionId) return;
    const refresh = () => fetch(`/api/sessions/${agoraData.sessionId}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const modality = data?.session?.currentModality;
        if (['voice', 'code', 'canvas', 'scenario'].includes(modality)) setActiveModality(modality);
        if (typeof data?.session?.activeRole === 'string') setActiveRole(data.session.activeRole);
        if (typeof data?.session?.phase === 'string') setActivePhase(data.session.phase);
        if (data?.session) {
          setDemoProgress(data.session.demo ?? null);
          setWorkspacePrompt(data.session.workspacePrompt ?? null);
          setPendingDemoQuestion(data.session.demo?.pendingQuestion ?? null);
          setServerDeadline(data.session.interviewEndsAt ?? null);
        }
        if (Array.isArray(data?.liveCaptions)) {
          const captions = data.liveCaptions.filter((caption: unknown): caption is ServerCaption => (
            !!caption
            && typeof caption === 'object'
            && typeof (caption as ServerCaption).id === 'string'
            && typeof (caption as ServerCaption).text === 'string'
            && typeof (caption as ServerCaption).createdAt === 'string'
          ));
          setServerCaptions(captions);
          const latest = captions.at(-1);
          if (latest && latest.id !== latestServerCaptionIdRef.current) {
            latestServerCaptionIdRef.current = latest.id;
            if (serverCaptionTimerRef.current !== null) window.clearTimeout(serverCaptionTimerRef.current);
            setServerCaptionProcessing(true);
            serverCaptionTimerRef.current = window.setTimeout(() => {
              setServerCaptionProcessing(false);
              serverCaptionTimerRef.current = null;
            }, 10_000);
          }
        }
      })
      .catch(() => {});
    refresh();
    // Keep workspace captions and role-state feedback responsive without
    // depending exclusively on RTM during a sequential role handoff.
    const interval = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(interval);
  }, [agoraData.sessionId]);

  useEffect(() => () => {
    if (serverCaptionTimerRef.current !== null) window.clearTimeout(serverCaptionTimerRef.current);
  }, []);

  // Tracks granular RTC connection state for the status dot.
  // Agora states: DISCONNECTED | CONNECTING | CONNECTED | DISCONNECTING | RECONNECTING
  const [connectionState, setConnectionState] = useState<string>('CONNECTING');
  const [joinedUID, setJoinedUID] = useState<UID>(0);

  // Transcript + agent state — managed with AgoraVoiceAI (see effect below).
  const [rawTranscript, setRawTranscript] = useState<
    TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
  >([]);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<QuickstartAgentMetric[]>([]);
  const [connectionIssues, setConnectionIssues] = useState<ConnectionIssue[]>(
    [],
  );
  const addConnectionIssue = useCallback((issue: ConnectionIssue) => {
    setConnectionIssues((prev) => {
      const isDuplicate = prev.some(
        (x) =>
          x.agentUserId === issue.agentUserId &&
          x.code === issue.code &&
          x.message === issue.message &&
          Math.abs(x.timestamp - issue.timestamp) < 1500,
      );
      if (isDuplicate) return prev;
      return [issue, ...prev].slice(0, MAX_CONNECTION_ISSUES);
    });
  }, []);

  // Auto-open details panel as soon as a new issue is recorded.
  useEffect(() => {
    if (connectionIssues.length > 0) {
      setIsConnectionDetailsOpen(true);
    }
  }, [connectionIssues.length]);

  // StrictMode guard: delay `useJoin`'s ready flag until after the fake-unmount
  // cycle completes. React StrictMode fires cleanup synchronously before any
  // setTimeout callback, so the first (fake) mount's timeout is always cancelled.
  // Only the real second mount's timeout fires, meaning useJoin joins exactly once.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) setIsReady(true);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
      setIsReady(false);
    };
  }, []);

  const { isConnected: joinSuccess } = useJoin(
    {
      appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!,
      channel: agoraData.channel,
      token: agoraData.token,
      uid: parseInt(agoraData.uid, 10),
    },
    isReady,
  );

  // Create mic track only after the StrictMode fake-unmount cycle completes (isReady).
  // Passing `true` here creates two tracks in StrictMode — the first publishes, then
  // StrictMode cleanup closes it and the second takes over, causing a ~3s audio gap.
  // isReady uses the same setTimeout(fn,0) pattern as useJoin: StrictMode cleanup fires
  // synchronously before the timeout, so only the real second mount's timer fires.
  // Do NOT pass `isEnabled` — that ties track lifetime to mute state and breaks the Web Audio
  // graph inside MicButtonWithVisualizer. Mute uses track.setEnabled() only.
  const { localMicrophoneTrack } = useLocalMicrophoneTrack(isReady);

  // ENABLE_AUDIO_PTS is a module-level SDK parameter (not on the client instance).
  // It must be set before publishing audio for transcript timing to be accurate.
  useEffect(() => {
    if (!client) return;
    try {
      (AgoraRTC as AgoraRtcWithParameters).setParameter?.(
        'ENABLE_AUDIO_PTS',
        true,
      );
    } catch (error) {
      console.warn('Could not set ENABLE_AUDIO_PTS:', error);
    }
  }, [client]);

  // Track the auto-assigned RTC UID for token renewal and agent invite.
  useEffect(() => {
    if (joinSuccess && client) {
      const uid = client.uid;
      if (uid !== null && uid !== undefined) {
        setJoinedUID(uid);
      }
    }
  }, [joinSuccess, client]);

  // Initialize AgoraVoiceAI once the channel is joined.
  //
  // Gating on `isReady && joinSuccess` is critical for StrictMode safety:
  //   - `isReady` ensures we are past the initial fake-unmount cycle, so this
  //     effect only runs on the real mount (not the discarded fake one).
  //   - Once `isReady` is true, React does NOT double-invoke this effect for
  //     subsequent state changes (`joinSuccess` becoming true). That means
  //     AgoraVoiceAI.init() is called exactly once.
  useEffect(() => {
    if (!isReady || !joinSuccess) return;

    let cancelled = false;

    (async () => {
      try {
        const ai = await AgoraVoiceAI.init({
          rtcEngine: client,
          rtmConfig: { rtmEngine: rtmClient },
          renderMode: TranscriptHelperMode.TEXT,
          enableLog: true,
        });

        if (cancelled) {
          try {
            if (AgoraVoiceAI.getInstance() === ai) {
              // Tear down only the instance created by this effect run.
              ai.unsubscribe();
              ai.destroy();
            }
          } catch {}
          return;
        }

        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (t) => {
          setRawTranscript([...t]);
        });
        // Agent state drives the visualizer, independent of RTC audio presence.
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_, event) => {
          setAgentState(event.state);
          logEvent('AGENT_STATE_CHANGED', { state: event.state });
        });
        ai.on(AgoraVoiceAIEvents.AGENT_INTERRUPTED, (_, event) => {
          if (interruptedTurnIdsRef.current.has(event.turnID)) return;
          interruptedTurnIdsRef.current.add(event.turnID);
          logEvent('INTERRUPTED', { turnId: event.turnID });
        });
        ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (_, metrics) => {
          setAgentMetrics((prev) => [...prev, metrics].slice(-8));
          logEvent('METRICS', { metrics });
        });
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-message-error-${error.code}`,
            source: 'rtm',
            agentUserId,
            code: error.code,
            message: error.message,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
          logEvent('ERROR', { source: 'rtm', code: error.code, message: error.message });
        });
        // SAL status: capture raw RTM messages so message.sal_status surfaces even if higher-level events don't.
        ai.on(
          AgoraVoiceAIEvents.MESSAGE_SAL_STATUS,
          (agentUserId, salStatus) => {
            if (
              salStatus.status === MessageSalStatus.VP_REGISTER_FAIL ||
              salStatus.status === MessageSalStatus.VP_REGISTER_DUPLICATE
            ) {
              addConnectionIssue({
                id: `${Date.now()}-${agentUserId}-sal-${salStatus.status}`,
                source: 'rtm',
                agentUserId,
                code: salStatus.status,
                message: `SAL status: ${salStatus.status}`,
                timestamp: normalizeTimestampMs(salStatus.timestamp),
              });
            }
          },
        );
        // Agent error: capture raw RTM messages so message.error surfaces even if higher-level events don't.
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-agent-error-${error.code}`,
            source: 'agent',
            agentUserId,
            code: error.code,
            message: `${error.type}: ${error.message}`,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
          logEvent('ERROR', { source: 'agent', code: error.code, message: error.message });
        });
        // subscribeMessage binds the toolkit to both RTC stream messages and RTM payloads.
        ai.subscribeMessage(agoraData.channel);
      } catch (error) {
        if (!cancelled) {
          console.error('[AgoraVoiceAI] init failed:', error);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        const ai = AgoraVoiceAI.getInstance();
        if (ai) {
          ai.unsubscribe();
          ai.destroy();
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, joinSuccess]);

  // Raw RTM parsing is kept as a fallback for signaling-level errors and SAL status.
  useEffect(() => {
    const handleRtmMessage = (event: {
      message: string | Uint8Array;
      publisher: string;
    }) => {
      const payloadText =
        typeof event.message === 'string'
          ? event.message
          : new TextDecoder().decode(event.message);

      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        return;
      }

      if (isRtmMessageErrorPayload(parsed)) {
        const p = parsed;
        addConnectionIssue({
          id: `${Date.now()}-${event.publisher}-rtm-msg-error-${p.code ?? 'unknown'}`,
          source: 'rtm-signaling',
          agentUserId: event.publisher,
          code: p.code ?? 'unknown',
          message: `${p.module ?? 'unknown'}: ${p.message ?? 'Unknown signaling error'}`,
          timestamp: normalizeTimestampMs(p.send_ts ?? Date.now()),
        });
        return;
      }

      if (isRtmSalStatusPayload(parsed)) {
        const p = parsed;
        if (
          p.status === 'VP_REGISTER_FAIL' ||
          p.status === 'VP_REGISTER_DUPLICATE'
        ) {
          addConnectionIssue({
            id: `${Date.now()}-${event.publisher}-rtm-sal-${p.status}`,
            source: 'rtm-signaling',
            agentUserId: event.publisher,
            code: p.status,
            message: `SAL status: ${p.status}`,
            timestamp: normalizeTimestampMs(p.timestamp ?? Date.now()),
          });
        }
      }
    };

    rtmClient.addEventListener('message', handleRtmMessage);
    return () => {
      rtmClient.removeEventListener('message', handleRtmMessage);
    };
  }, [rtmClient, addConnectionIssue]);

  // The toolkit uses uid="0" for local user speech — remap to actual RTC UID
  // so the transcript panel renders user messages on the correct side.
  // Also normalize punctuation spacing for display when upstream text arrives compacted.
  const transcript = useMemo(() => {
    return normalizeTranscript(rawTranscript, String(client.uid));
  }, [rawTranscript, client.uid]);

  // Completed (END + INTERRUPTED) messages shown as history.
  // INTERRUPTED must be included — if the agent's first turn is cut off,
  // messageList stays empty and the first interrupted turn is never shown.
  const messageList = useMemo(() => getMessageList(transcript), [transcript]);

  // Agora's browser transcript is still the primary source. The server caption
  // is an STT-confirmed fallback for the short period around a role-agent swap.
  const displayedMessageList = useMemo(() => {
    const toolkitCandidateTexts = messageList
      .filter((message) => !agentUIDs.includes(String(message.uid)))
      .map((message) => normalizeSpokenText(String(message.text ?? '')));
    const fallback = serverCaptions
      .filter((caption) => {
        const normalized = normalizeSpokenText(caption.text);
        return normalized && !toolkitCandidateTexts.some((text) => text.includes(normalized) || normalized.includes(text));
      })
      .map((caption) => ({
        turn_id: `server-caption-${caption.id}`,
        uid: Number(client.uid) || 0,
        text: caption.text,
        createdAt: Date.parse(caption.createdAt),
      }));
    return [...messageList, ...fallback].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }, [agentUIDs, client.uid, messageList, serverCaptions]);

  useEffect(() => {
    if (['listening', 'idle', 'silent'].includes(agentState ?? '')) {
      for (const turn of transcript) {
        if (agentUIDs.includes(String(turn.uid)) && turn.status === TurnStatus.END) finishedAgentTurnsRef.current.add(turn.turn_id);
      }
    }
    if (!agoraData.sessionId || !pendingDemoQuestion || deliveredQuestionsRef.current.has(pendingDemoQuestion.id)) return;
    const completed = transcript.find((turn) => agentUIDs.includes(String(turn.uid))
      && turn.status === TurnStatus.END
      && finishedAgentTurnsRef.current.has(turn.turn_id)
      && normalizeSpokenText(String(turn.text)).includes(normalizeSpokenText(pendingDemoQuestion.text)));
    if (!completed) return;
    let cancelled = false;
    // Retry a lost receipt even when the transcript is no longer changing.
    const acknowledge = async () => {
      if (cancelled || deliveredQuestionsRef.current.has(pendingDemoQuestion.id)) return;
      try {
        const response = await fetch(`/api/sessions/${agoraData.sessionId}/events`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'QUESTION_DELIVERED', payload: {
            questionId: pendingDemoQuestion.id, text: String(completed.text),
          } }),
        });
        if (response.ok) deliveredQuestionsRef.current.add(pendingDemoQuestion.id);
      } catch { /* Retry while this question remains pending. */ }
    };
    void acknowledge();
    const timer = window.setInterval(() => void acknowledge(), 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [agoraData.sessionId, pendingDemoQuestion, transcript, agentState, agentUIDs]);

  const lastLoggedTurnRef = useRef<number | null>(null);

  // Watch for new completed messages to log them
  useEffect(() => {
    if (messageList.length === 0) return;
    const latestMessage = messageList[messageList.length - 1];
    
    if (latestMessage.turn_id !== lastLoggedTurnRef.current) {
      if (
        String(latestMessage.status).toLocaleLowerCase().includes('interrupt') &&
        !interruptedTurnIdsRef.current.has(latestMessage.turn_id)
      ) {
        interruptedTurnIdsRef.current.add(latestMessage.turn_id);
        logEvent('INTERRUPTED', { turnId: latestMessage.turn_id });
      }
      lastLoggedTurnRef.current = latestMessage.turn_id;
    }
  }, [messageList, logEvent]);

  const currentInProgressMessage = useMemo(() => {
    // The live partial turn renders separately from the completed history list.
    return getCurrentInProgressMessage(transcript);
  }, [transcript]);

  // Publish local mic once the track exists; usePublish waits for RTC connection.
  usePublish([localMicrophoneTrack]);

  useClientEvent(client, 'user-joined', (user) => {
    if (agentUIDs.includes(user.uid.toString())) {
      setIsAgentConnected(true);
    }
  });

  useClientEvent(client, 'user-left', (user) => {
    if (agentUIDs.includes(user.uid.toString())) setIsAgentConnected(false);
  });

  // Sync isAgentConnected with remoteUsers (covers cases where user-joined/left are missed)
  useEffect(() => {
    const isAgentInRemoteUsers = remoteUsers.some(
      (user) => agentUIDs.includes(user.uid.toString()),
    );
    setIsAgentConnected(isAgentInRemoteUsers);
  }, [remoteUsers, agentUIDs]);

  // Ensure remote audio tracks (e.g. AI agent) are played
  useEffect(() => {
    remoteUsers.forEach((user) => {
      if (user.audioTrack && !user.audioTrack.isPlaying) {
        try {
          void user.audioTrack.play();
        } catch {
          // ignore autoplay restrictions until user interacts
        }
      }
    });
  }, [remoteUsers]);

  useClientEvent(client, 'connection-state-change', (curState) => {
    setConnectionState(curState);
    logEvent('CONNECTION_STATE', { state: curState, timestamp: Date.now() });
  });

  const connectionSeverity = useMemo<'normal' | 'warning' | 'error'>(() => {
    // RTC transport problems take precedence; otherwise derive severity from captured issues.
    if (
      connectionState === 'DISCONNECTED' ||
      connectionState === 'DISCONNECTING'
    ) {
      return 'error';
    }
    if (
      connectionState === 'CONNECTING' ||
      connectionState === 'RECONNECTING'
    ) {
      return 'warning';
    }
    if (connectionIssues.length === 0) {
      return 'normal';
    }
    return connectionIssues.some(
      (issue) => getConversationIssueSeverity(issue) === 'error',
    )
      ? 'error'
      : 'warning';
  }, [connectionState, connectionIssues]);

  const visualizerState = useMemo(() => {
    const serverIsProcessing = serverCaptionProcessing
      && ['idle', 'silent', null].includes(agentState);
    return mapAgentVisualizerState(serverIsProcessing ? AgentState.THINKING : agentState, isAgentConnected, connectionState);
  }, [agentState, serverCaptionProcessing, isAgentConnected, connectionState]);
  const workspaceActive = activeModality === 'code' || activeModality === 'canvas';

  /**
   * Mute/unmute via track.setEnabled() only — usePublish owns publish state.
   * If we also unpublish in the toggle, usePublish and the button fight each other
   * and break the MicButtonWithVisualizer Web Audio graph.
   */
  const handleMicToggle = useCallback(async () => {
    const next = !isEnabled;
    const track = localMicrophoneTrack;
    if (!track) {
      setIsEnabled(next);
      return;
    }
    try {
      await track.setEnabled(next);
      setIsEnabled(next);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
    }
  }, [isEnabled, localMicrophoneTrack]);

  const handleTokenWillExpire = useCallback(async () => {
    if (!onTokenWillExpire || !joinedUID) return;
    try {
      // RTC and RTM renew independently, but the quickstart fetches both in one request.
      const { rtcToken, rtmToken } = await onTokenWillExpire(
        joinedUID.toString(),
      );
      await client?.renewToken(rtcToken);
      await rtmClient.renewToken(rtmToken);
    } catch (error) {
      console.error('Failed to renew Agora token:', error);
    }
  }, [client, onTokenWillExpire, joinedUID, rtmClient]);

  useClientEvent(client, 'token-privilege-will-expire', handleTokenWillExpire);

  const handleEndConversation = useCallback(async () => {
    onEndConversation();
  }, [onEndConversation]);

  useEffect(() => {
    // Start the session clock once the agent startup has completed, not while
    // the browser is still acquiring microphone/RTC credentials.
    const deadline = agoraData.sessionId ? serverDeadline : agoraData.interviewEndsAt;
    if (!deadline) return;
    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1_000));
      setTimeRemainingSeconds(remaining);
      if (remaining === 0 && !autoEndTriggeredRef.current) {
        autoEndTriggeredRef.current = true;
        void handleEndConversation();
      }
    };
    updateTimer();
    const timer = window.setInterval(updateTimer, 500);
    return () => window.clearInterval(timer);
  }, [agoraData.interviewEndsAt, agoraData.sessionId, serverDeadline, handleEndConversation]);

  useEffect(() => {
    if (!demoProgress?.closing || autoEndTriggeredRef.current) return;
    const closingDelivered = transcript.some((turn) => agentUIDs.includes(String(turn.uid))
      && turn.status === TurnStatus.END
      && String(turn.text).replace(/[^a-z]/gi, '').toLowerCase().includes(DEMO_CLOSING.replace(/[^a-z]/gi, '').toLowerCase()));
    if (!closingDelivered) return;
    // A role handoff creates a new Agora agent, whose state event can arrive
    // after the closing transcript. The completed closing turn is the durable
    // completion signal; leave a short buffer for audio playback, then finish.
    const timer = window.setTimeout(() => {
      if (autoEndTriggeredRef.current) return;
      autoEndTriggeredRef.current = true;
      void handleEndConversation();
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [agentUIDs, demoProgress?.closing, handleEndConversation, transcript]);

  useEffect(() => {
    if (!compactDemo || autoEndTriggeredRef.current) return;
    const endedAgentTurns = transcript.filter((turn) => agentUIDs.includes(String(turn.uid)) && turn.status === TurnStatus.END);
    const endedCandidateTurns = transcript.filter((turn) => !agentUIDs.includes(String(turn.uid)) && turn.status === TurnStatus.END);
    const complete = companionDemo
      ? endedAgentTurns.length >= 1
      : endedAgentTurns.length >= 2 && endedCandidateTurns.length >= 1;
    if (!complete || !['listening', 'idle', 'silent'].includes(agentState ?? '')) return;
    const timer = window.setTimeout(() => {
      if (autoEndTriggeredRef.current) return;
      autoEndTriggeredRef.current = true;
      void handleEndConversation();
    }, companionDemo ? 1_600 : 2_400);
    return () => window.clearTimeout(timer);
  }, [agentState, agentUIDs, compactDemo, companionDemo, handleEndConversation, transcript]);

  if (compactDemo) {
    if (companionDemo) {
      const latestAgentMessage = [...messageList].reverse().find((message) => agentUIDs.includes(String(message.uid)));
      return (
        <div className="flex min-h-[4.5rem] w-full items-center justify-center gap-3 bg-transparent text-center text-xs leading-5 text-[#898989]" aria-live="polite">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isAgentConnected ? 'bg-[#3ecf8e]' : 'bg-[#555]'}`} />
          <p>{latestAgentMessage ? String(latestAgentMessage.text) : currentInProgressMessage ? String(currentInProgressMessage.text) : 'Connecting the Agora companion...'}</p>
          <button type="button" onClick={handleEndConversation} className="shrink-0 rounded-md border border-[#353535] px-2 py-1 text-[10px] text-[#aaa] hover:bg-[#1d1d1d]">Stop</button>
          {remoteUsers.map((user) => (
            <div key={user.uid} className="hidden">
              {typeof RemoteUser === 'function' ? <RemoteUser user={user} playAudio={true} /> : null}
            </div>
          ))}
        </div>
      );
    }
    const recentMessages = messageList.slice(-2);
    return (
      <div className="flex min-h-[26rem] w-full flex-col justify-between bg-[#171717] p-6 text-[#ededed]">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2" aria-live="polite">
          {recentMessages.length === 0 ? (
            <p className="text-center text-sm text-[#777]">Connecting to the AI interviewer...</p>
          ) : recentMessages.map((message) => {
            const candidate = !agentUIDs.includes(String(message.uid));
            return (
              <div key={message.turn_id} className="text-sm leading-5">
                <span className={candidate ? 'font-semibold text-[#888]' : 'font-semibold text-[#3ecf8e]'}>
                  {candidate ? 'You' : 'RoundTable'}
                </span>
                <p className="mt-0.5">{String(message.text)}</p>
              </div>
            );
          })}
          {currentInProgressMessage && (
            <p className="text-sm leading-5 text-[#888]">{String(currentInProgressMessage.text)}</p>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[#292929] pt-3">
          <span className="flex items-center gap-2 text-[11px] font-medium text-[#888]">
            <span className={`h-2 w-2 rounded-full ${isAgentConnected ? 'bg-[#3ecf8e]' : 'bg-[#555]'}`} />
            {!isAgentConnected ? 'Joining voice' : agentState === 'speaking' ? 'AI speaking' : agentState === 'thinking' ? 'AI thinking' : !isEnabled ? 'Microphone muted' : 'Listening'}
          </span>
          <div className="flex items-center gap-2">
            <div className="conversation-mic-host flex items-center justify-center scale-75">
              <MicButtonWithVisualizer
                isEnabled={isEnabled}
                setIsEnabled={setIsEnabled}
                track={localMicrophoneTrack}
                onToggle={handleMicToggle}
                className="overflow-visible"
                aria-label={isEnabled ? 'Mute microphone' : 'Unmute microphone'}
                enabledColor="#24b47e"
                disabledColor="hsl(var(--destructive))"
                showWaveform={true}
              />
            </div>
            <button type="button" onClick={handleEndConversation} className="rounded-md border border-[#353535] bg-[#1d1d1d] px-3 py-2 text-xs font-medium text-[#d7d7d7] hover:bg-[#242424]">
              End sample
            </button>
          </div>
        </div>
        {remoteUsers.map((user) => (
          <div key={user.uid} className="hidden">
            {typeof RemoteUser === 'function' ? <RemoteUser user={user} playAudio={true} /> : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <QuickstartConversationLayout
      workspacePrompt={workspacePrompt}
      activeModality={activeModality}
      activeRole={activeRole}
      activePhase={activePhase}
      sessionId={agoraData.sessionId}
      timeRemainingSeconds={timeRemainingSeconds}
      demoProgress={demoProgress}
      statusPanel={
        <ConnectionStatusPanel
          connectionState={connectionState}
          connectionSeverity={connectionSeverity}
          connectionIssues={connectionIssues}
          isOpen={isConnectionDetailsOpen}
          onToggle={() => setIsConnectionDetailsOpen((open) => !open)}
        />
      }
      pipelineMetrics={<QuickstartPipelineMetrics metrics={agentMetrics} />}
      transcriptPanel={
        <QuickstartTranscriptPanel
          messageList={displayedMessageList}
          currentInProgressMessage={currentInProgressMessage}
          agentUIDs={agentUIDs}
        />
      }
      visualizer={
        <div
          className={`relative flex h-full w-full max-w-4xl flex-col items-center justify-center overflow-hidden ${workspaceActive ? 'min-h-[10rem] gap-1.5 py-1' : 'min-h-[20rem] gap-4'}`}
          role="region"
          aria-label="AI agent status visualization"
        >
          {!workspaceActive && <PanelAvatar role={activeRole} state={agentState} />}
          {workspaceActive && <span className="font-mono text-[10px] font-medium uppercase tracking-[.14em] text-[#8b8b8b]">{activeRole.replaceAll('_', ' ')} · live status</span>}
          <AgentVisualizer state={visualizerState} size={workspaceActive ? 'sm' : 'lg'} className={workspaceActive ? 'gap-1.5 scale-90 origin-center' : ''} />
          {remoteUsers.map((user) => (
            <div key={user.uid} className="hidden">
              {typeof RemoteUser === 'function' ? <RemoteUser user={user} playAudio={true} /> : null}
            </div>
          ))}
        </div>
      }
      controls={
        <div
          className="mx-auto flex w-fit items-center gap-3 rounded-full border border-border bg-card/80 px-4 py-2 backdrop-blur-md"
          role="group"
          aria-label="Audio controls"
        >
          <div className="conversation-mic-host flex items-center justify-center">
            <MicButtonWithVisualizer
              isEnabled={isEnabled}
              setIsEnabled={setIsEnabled}
              track={localMicrophoneTrack}
              onToggle={handleMicToggle}
              className="overflow-visible"
              aria-label={isEnabled ? 'Mute microphone' : 'Unmute microphone'}
              enabledColor="hsl(var(--primary))"
              disabledColor="hsl(var(--destructive))"
              showWaveform={true}
            />
          </div>
          <MicrophoneSelector localMicrophoneTrack={localMicrophoneTrack} />
        </div>
      }
      onEndConversation={handleEndConversation}
    />
  );
}
