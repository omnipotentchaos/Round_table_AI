import { randomInt } from 'crypto';
import { RtcRole, RtcTokenBuilder } from 'agora-token';
import {
  AgoraClient,
  type AgoraArea,
  Agent,
  Area,
  CustomLLM,
  DeepgramSTT,
  ExpiresIn,
  GradiumTTS,
} from 'agora-agents';
import { agentUidForRole } from '@/lib/agora';
import type { PanelRole } from '@/types/interview';
import { DEMO_OPENING_QUESTION } from '@/lib/interview-demo';

const TOKEN_TTL_SECONDS = 3_600;

function requireAgoraEnv(name: 'NEXT_PUBLIC_AGORA_APP_ID' | 'NEXT_AGORA_APP_CERTIFICATE'): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requireGradiumEnv(name: 'GRADIUM_API_KEY' | `GRADIUM_${string}_VOICE_ID`): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function gradiumVoiceForRole(role: PanelRole): string {
  const variableByRole: Record<PanelRole, `GRADIUM_${string}_VOICE_ID`> = {
    hiring_manager: 'GRADIUM_HIRING_MANAGER_VOICE_ID',
    technical: 'GRADIUM_TECHNICAL_VOICE_ID',
    product: 'GRADIUM_PRODUCT_VOICE_ID',
    customer: 'GRADIUM_CUSTOMER_VOICE_ID',
    behavioral: 'GRADIUM_BEHAVIORAL_VOICE_ID',
  };
  return requireGradiumEnv(variableByRole[role]);
}

export function createAgoraChannel(sessionId: string): string {
  return `roundtable-${sessionId.replaceAll('-', '').slice(0, 20)}`;
}

export function createAgoraRtcUid(): string {
  return String(randomInt(1_000, 2_000_000_000));
}

export function createAgoraToken(channel: string, uid: string): { token: string; expiresAt: string } {
  const appId = requireAgoraEnv('NEXT_PUBLIC_AGORA_APP_ID');
  const certificate = requireAgoraEnv('NEXT_AGORA_APP_CERTIFICATE');
  const expires = Math.floor(Date.now() / 1_000) + TOKEN_TTL_SECONDS;
  return {
    token: RtcTokenBuilder.buildTokenWithRtm(
      appId,
      certificate,
      channel,
      uid,
      RtcRole.PUBLISHER,
      expires,
      expires,
    ),
    expiresAt: new Date(expires * 1_000).toISOString(),
  };
}

function baseUrl(): string {
  const envUrl = process.env.APP_BASE_URL?.trim();
  if (envUrl) {
    return envUrl.startsWith('http') ? envUrl.replace(/\/$/, '') : `https://${envUrl.replace(/\/$/, '')}`;
  }
  const vercelUrl =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL;
  if (vercelUrl) {
    const clean = vercelUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `https://${clean}`;
  }
  return process.env.NODE_ENV === 'production' ? 'https://round-ai.vercel.app' : 'http://localhost:3000';
}

function resolveAgoraArea(): AgoraArea {
  const envArea = process.env.AGORA_AREA?.toUpperCase();
  if (envArea === 'US') return Area.US;
  if (envArea === 'EU') return Area.EU;
  if (envArea === 'CN') return Area.CN;
  if (envArea === 'AP') return Area.AP;
  return Area.US;
}

export async function startInterviewAgent({
  sessionId,
  channel,
  rtcUid,
  llmToken,
  roleTitle = 'Software Engineer',
  companyName = 'the hiring company',
  panelRoles = ['technical'],
  durationMinutes = 30,
  demoMode = false,
  activeRole = 'technical',
  openingText,
  agentUid = agentUidForRole(activeRole),
}: {
  sessionId: string;
  channel: string;
  rtcUid: string;
  llmToken: string;
  roleTitle?: string;
  companyName?: string;
  panelRoles?: PanelRole[];
  durationMinutes?: number;
  demoMode?: boolean;
  activeRole?: PanelRole;
  openingText?: string;
  agentUid?: string;
}): Promise<string> {
  const client = new AgoraClient({
    area: resolveAgoraArea(),
    appId: requireAgoraEnv('NEXT_PUBLIC_AGORA_APP_ID'),
    appCertificate: requireAgoraEnv('NEXT_AGORA_APP_CERTIFICATE'),
  });
  const roleNames: Record<PanelRole, string> = {
    technical: 'technical interviewer',
    product: 'product manager',
    hiring_manager: 'hiring manager',
    behavioral: 'behavioural interviewer',
    customer: 'customer',
  };
  const formattedRoles = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' })
    .format(panelRoles.map((role) => roleNames[role]));
  const paceGuidance = durationMinutes <= 2
    ? 'Please keep each answer to about ten seconds so every panel member can speak.'
    : 'Take the time you need to answer clearly.';
  const defaultGreeting = demoMode
    ? `Hi! This is an AI interview for ${roleTitle} at ${companyName}, with ${formattedRoles}. One project, five perspectives. Take your time with each answer. A human reviews the summary. ${DEMO_OPENING_QUESTION}`
    : `Hi. This is a technical interview for the role of ${roleTitle} at ${companyName}. You are speaking with an AI interview panel: ${formattedRoles}. We will start with a brief introduction and background, then each interviewer will ask one focused question. This ${durationMinutes}-minute interview is reviewed by a human. ${paceGuidance} Please introduce yourself and share the experience most relevant to this role.`;
  const greeting = openingText ?? defaultGreeting;
  const instructions = `You are the ${roleNames[activeRole]} voice executor for RoundTable's AI interview panel. The application-controlled custom LLM selects exactly one panel role and one question per turn. Speak its text faithfully, warmly, and concisely. Never claim to be human. Never make a hire or reject decision. Allow the candidate to interrupt naturally. When the candidate asks for a moment to think, acknowledge it calmly and do not advance the interview. Linear actions are controlled by the application: a comment is posted only after the application reads a preview and receives explicit candidate confirmation. Never invent a Linear result.`;

  const agent = new Agent({
    client,
    instructions,
    greeting,
    failureMessage: 'I had trouble evaluating that answer. Could you give one concrete example with your own action and result?',
    maxHistory: 50,
    turnDetection: {
      config: {
        speech_threshold: 0.5,
        start_of_speech: {
          mode: 'vad',
          vad_config: { interrupt_duration_ms: 160, prefix_padding_ms: 300 },
        },
        end_of_speech: {
          mode: 'vad',
          vad_config: { silence_duration_ms: demoMode ? 1500 : 480 },
        },
      },
    },
    advancedFeatures: { enable_rtm: true, enable_tools: true },
    parameters: {
      audio_scenario: 'chorus',
      data_channel: 'rtm',
      enable_error_message: true,
      enable_metrics: true,
    },
  })
    .withStt(new DeepgramSTT({ model: 'nova-3', language: 'en' }))
    .withLlm(new CustomLLM({
      apiKey: llmToken,
      url: `${baseUrl()}/api/ai/chat/completions`,
      model: 'roundtable-controller',
      systemMessages: [{ role: 'system', content: instructions }],
    }))
    .withTts(new GradiumTTS({
      apiKey: requireGradiumEnv('GRADIUM_API_KEY'),
      modelName: 'default',
      voiceId: gradiumVoiceForRole(activeRole),
      sampleRate: 24_000,
    }));

  const session = agent.createSession({
    channel,
    agentUid,
    remoteUids: [rtcUid],
    idleTimeout: Math.max(60, durationMinutes * 60 + 30),
    expiresIn: ExpiresIn.hours(1),
    debug: false,
  });
  const agentId = await session.start();
  console.info('[agora] interview agent started', { sessionId, agentId });
  return agentId;
}

export async function stopInterviewAgent(agentId: string): Promise<void> {
  const client = new AgoraClient({
    area: resolveAgoraArea(),
    appId: requireAgoraEnv('NEXT_PUBLIC_AGORA_APP_ID'),
    appCertificate: requireAgoraEnv('NEXT_AGORA_APP_CERTIFICATE'),
  });
  try {
    await client.stopAgent(agentId);
  } catch (error) {
    const item = error as { statusCode?: number; body?: { detail?: string } };
    const detail = item.body?.detail?.toLocaleLowerCase() ?? '';
    if (item.statusCode === 404 || detail.includes('already in the process of shutting down')) return;
    throw error;
  }
}
