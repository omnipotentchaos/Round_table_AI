# Agent Development Guide

This guide is for coding agents making changes in `agent-quickstart-nextjs`.

## How to Load

This repository uses progressive disclosure documentation. Docs live under `docs/ai/` in three levels.

1. Read [docs/ai/L0_repo_card.md](docs/ai/L0_repo_card.md) to identify the repo.
2. Load ALL 8 files in [docs/ai/L1/](docs/ai/L1/). They are small — load all upfront.
3. Follow L2 deep-dive links only when L1 isn't detailed enough. The index is at [docs/ai/L1/L2/_index.md](docs/ai/L1/L2/_index.md).

This repo declares `Recipe Role: base` in L0, so also read [docs/ai/RECIPE.md](docs/ai/RECIPE.md) when evaluating extension points, invariants, or stable contracts.

The sections below (Start Here, Patterns, Anti-Patterns, etc.) remain the canonical contributor handbook for hands-on work; the `docs/ai/` tree is the structured summary used by AI agents.

## Start Here

- Read [README.md](./README.md) for setup, commands, verification, and deployment.
- Use [docs/ai/RECIPE.md](docs/ai/RECIPE.md) for the base quickstart recipe contract.
- Use [docs/ai/L1/L2/from_scratch_bootstrap.md](docs/ai/L1/L2/from_scratch_bootstrap.md) for the baseline implementation map.
- Use [docs/ai/L1/L2/transcript_pipeline.md](docs/ai/L1/L2/transcript_pipeline.md) for transcript and RTM behavior.
- For layout and responsibilities inside `components/`, `app/api/`, and `lib/`, use [docs/ai/L1/03_code_map.md](docs/ai/L1/03_code_map.md) and [docs/ai/L1/02_architecture.md](docs/ai/L1/02_architecture.md).

## Current System Shape

- App shell: Next.js 16 App Router, React 19, and TypeScript
- Client RTC: `agora-rtc-react` hooks over `agora-rtc-sdk-ng`
- Messaging: `agora-rtm` for transcripts, agent state, metrics, and error events
- Toolkit core: `agora-agent-client-toolkit` for `AgoraVoiceAI`, transcript helpers, and turn status
- UI components: `agora-agent-uikit` for visualizer, transcript, and mic controls
- Server SDK: `agora-agents` for managed agent session startup
- Product APIs: company interviews, signed invitations, sessions, artifacts, assessment release, MCP, and Agora webhooks live in `app/api`
- Voice pipeline: Agora-managed STT with Gradium TTS and an authenticated RoundTable custom LLM/controller endpoint. One role agent speaks at a time; server-owned handoffs preserve the candidate RTC room.
- Persistence and auth: Google-only Supabase Auth for interviewers, with one idempotently provisioned private organization per authenticated user; process-local memory is development/test fallback only
- Submission auth bypass: `NEXT_PUBLIC_DISABLE_COMPANY_AUTH=true` deliberately exposes one fixed company organization while retaining Supabase persistence; it is temporary and must never be used with real candidate data.
- Workspaces: Monaco code and one Excalidraw canvas with private checkpoints; server-selected E2B execution
- Presentation: a browser-rendered role-aware AI avatar follows the server-owned active panel role and agent state; it does not create a video stream or another agent.
- Public presentation: the homepage is a three-scene Three.js/Anime.js narrative with layout-anchored artifacts, a readable one-question Agora sample, and a separate bounded Agora companion greeting. Stop at scene three and pause scene navigation during voice sessions. Never add browser TTS fallback, fabricated transcripts, or hardcoded live connection/latency claims. Perspective buttons are descriptive previews, not live role selection. Production must opt in with `ENABLE_HOMEPAGE_VOICE_DEMO=true`.
- Candidate presentation: invitation, consent, live interview, workspace, completion, and loading states share the Supabase-dark visual system. Keep server-owned progression internal rather than rendering a speculative role-answer counter.
- Resume ownership: recruiters may attach optional plain-text resume content immediately before publishing an invitation. The public candidate consent screen does not accept resume uploads. Resume claims remain untrusted question seeds and never become evidence.
- Optional camera interaction: a candidate-consented short clip is reviewed only for the prompted interaction; no raw media is persisted and it is never identity, voice-authenticity, deception, or hiring inference.

## Supported Modes

### Local Development

- Run from the repo root with `npm run dev`.
- Next.js serves the app and the route handlers at `http://localhost:3000`.
- Local credentials are read from `.env.local`, usually written by `agora project env write .env.local`.

### Vercel Deployment

- Deploy the repository as a single Next.js app.
- Set `NEXT_PUBLIC_AGORA_APP_ID` and `NEXT_AGORA_APP_CERTIFICATE` in the deployment target.
- Keep `NEXT_AGORA_APP_CERTIFICATE` server-side only.

## Routing / Ownership

- UI and RTC/RTM client lifecycle live in `components`.
- Browser-facing API routes live in `app/api`.
- Shared constants and transcript normalization live in `lib`.
- If a workflow, request contract, or ownership boundary changes, update `README.md`, `AGENTS.md`, and the relevant `docs/ai/` files in the same change.

## Key Files

- `app/api/generate-agora-token/route.ts`: issues RTC + RTM tokens for the browser user.
- `app/api/invite-agent/route.ts`: starts the managed agent session; edit here for system prompt, VAD, model, or voice changes.
- `app/api/stop-conversation/route.ts`: stops the agent session.
- `app/api/ai/chat/completions/route.ts`: per-session authenticated OpenAI-compatible adaptive controller used by Agora.
- `app/api/interviews/`: company definition, plan, version, publication, and status routes.
- `app/api/invitations/`: public invitation preview and consent-gated guest session bootstrap.
- `app/api/sessions/`: authenticated lifecycle, background agent start, event, artifact, tool, results, and release routes.
- `app/api/sessions/[id]/report`: company-only normalized report for a completed interview.
- `app/api/mcp/[grant]/route.ts`: session-scoped Streamable HTTP workspace tools.
- `app/api/webhooks/agora/route.ts`: signed lifecycle reconciliation and finalization.
- `components/LandingPage.tsx`: session bootstrap, RTM setup, provider wiring, and conversation lifecycle.
- `components/RoundTableExperience.tsx`: public pinned-scroll landing narrative, Three.js artifact, five-role transformation, compact voice sample, and cursor-aware companion.
- `components/CompanyDashboard.tsx`: Google-only company auth, interview creation, recruiter-side resume attachment, explicit invitation copy, and session pipeline.
- `components/CompanyAnalysisPage.tsx`: separately routed authenticated completed-report loader and release flow.
- `components/ConversationComponent.tsx`: RTC join, mic publication, `AgoraVoiceAI` init, transcript state, and renewals.
- `components/QuickstartConversationLayout.tsx`: in-call header, transcript rail, and controls dock.
- `components/QuickstartPipelineMetrics.tsx`: per-stage latency chips from `AGENT_METRICS`.
- `components/QuickstartTranscriptPanel.tsx`: live transcript rail.
- `lib/agora.ts`: shared agent UID defaults.
- `lib/agora-server.ts`: combined RTC/RTM token generation and managed interview-agent lifecycle.
- `lib/interview-controller.ts`: all-role evidence evaluation and deterministic next-speaker rules.
- `lib/interview-store.ts`: Supabase persistence with development/test memory fallback.
- `lib/assessment.ts`: structured evidence-only final assessment that associates accepted answers with the preceding interviewer role, excludes navigation/control speech, and combines validated transcript quotes with conservative completed-workspace artifact-version evidence.
- `lib/company-report.ts`: allow-listed company dashboard report projection.
- `lib/conversation.ts`: transcript normalization and visualizer state mapping.
- `env.local.example`: local environment template.
- `scripts/verify-api-contracts.ts`: route contract verification.

## Patterns

### StrictMode Guard (`isReady`)

Both `useJoin` and `useLocalMicrophoneTrack` are gated by `isReady` to prevent double initialization in React StrictMode dev mode. The cleanup fires synchronously before any `setTimeout`, so only the real second mount's timer fires.

```tsx
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
const { isConnected: joinSuccess } = useJoin(config, isReady);
const { localMicrophoneTrack } = useLocalMicrophoneTrack(isReady);
```

### Hook Ownership

- `useJoin` owns `client.leave()`; never call it manually.
- `useLocalMicrophoneTrack` owns track lifecycle; do not manually call `.close()`.
- `usePublish` owns publish state; mute with `track.setEnabled()` and do not manually unpublish.

### AgoraVoiceAI Init

Initialize `AgoraVoiceAI` from `agora-agent-client-toolkit` inside `ConversationComponent`, gated on `isReady && joinSuccess`.

```tsx
useEffect(() => {
  if (!isReady || !joinSuccess) return;
  // AgoraVoiceAI.init() is called here exactly once.
}, [isReady, joinSuccess]);
```

`isReady` becomes true only after the StrictMode fake-unmount cycle completes. Once `isReady` is true, React does not double invoke the effect for later dependency changes such as `joinSuccess` becoming true.

### Transcript and UI Mapping

- Manage `transcript` and `agentState` through `useState` plus `ai.on(TRANSCRIPT_UPDATED, ...)` and `ai.on(AGENT_STATE_CHANGED, ...)`.
- The toolkit uses `uid="0"` as a sentinel for the local user's speech. Remap that value to `client.uid` before passing messages into `QuickstartTranscriptPanel`, or user speech renders on the agent side.
- Include `INTERRUPTED` turns in `messageList`; filter only `IN_PROGRESS`. If the agent's first turn is interrupted and omitted, `messageList` stays empty and the transcript panel never shows that first turn.

### Tokens and Styling

- RTM token access must come from `RtcTokenBuilder.buildTokenWithRtm`; a standard RTC-only token does not grant RTM access.
- Tailwind must scan uikit classes with `./node_modules/agora-agent-uikit/dist/**/*.{js,mjs}` in `tailwind.config.ts`.

## Working Rules

- Prefer the smallest change that keeps the quickstart copyable and production-style.
- Keep RTC client creation StrictMode-safe with `useRef`, not `useMemo`.
- Keep token generation on `RtcTokenBuilder.buildTokenWithRtm`.
- Keep transcript UID remapping aligned with the toolkit sentinel behavior.
- Do not require third-party vendor API keys unless the code actually introduces a BYOK provider path.
- Keep Groq planner/evaluator/speaker/assessment models independently configurable, and cap structured completion tokens so fallback-safe demo calls do not reserve unbounded daily quota.
- Keep final narrative generation limited to a bounded verified-evidence packet; do not duplicate full transcripts, analyses, rubric, and fallback reports in its prompt. Model narratives must not replace authoritative ratings or evidence. Honor provider `Retry-After` across purposes sharing the same model/key; process-local cooldown is not a distributed quota guarantee.
- Keep README, AGENTS, and `docs/ai/` aligned with implementation changes.

## Commands

From the repo root:

```bash
npm install
npm run doctor
npm run dev
npm run verify
```

Useful narrower checks:

```bash
npm run lint
npm run typecheck
npm run verify:api
npm run build
```

## Verification Safety

- Safe without live Agora credentials:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run verify:api`
  - `npm run build`
- Requires local env setup but not a live Agora session:
  - `npm run doctor`
  - `npm run verify`
- Often blocked inside restricted sandboxes because of port binding or process spawning:
  - `npm run dev`

## Anti-Patterns / What NOT To Do

- Do not call `client.leave()` manually; it breaks `useJoin` cleanup.
- Do not call `localMicrophoneTrack.close()` manually; it breaks hook ownership.
- Do not remove the `isReady` guard.
- Do not set `reactStrictMode: false` as a workaround.
- Do not use the deprecated `turnDetection.type: 'agora_vad'` flat API; use `turnDetection.config.start_of_speech` and `turnDetection.config.end_of_speech`.
- Do not replace `RtcTokenBuilder.buildTokenWithRtm` with an RTC-only token builder.
- Do not hide SDK requirements only in `CLAUDE.md`; all agent-facing guidance belongs in `AGENTS.md`.
- Do not restore browser-owned candidate scores, role selection, or prompt updates; authoritative interview state is server-owned and versioned.
- Do not accept caller-supplied system prompts or model IDs at the custom LLM boundary.
- Do not publish transcript, answers, artifacts, scores, or assessment tables through Realtime; publish only `company_session_status`.
- Do not expose raw session events, controller cache, raw workspace source, raw media, credentials, or incomplete interview evidence through the company report; it is available only after completion and organization authorization.
- Do not use resume claims as evidence. Resume text may only seed verification questions.
- Do not emit automatic hire/reject decisions; every final assessment must keep `humanReviewRequired: true`.
- Final role views must associate each accepted candidate answer with the preceding interviewer question (the opening demo answer belongs to Hiring Manager), exclude conversation/workspace controls, and use specific evidence-linked summaries. Do not duplicate one artifact as multiple headline strengths or overstate structural workspace inspection as exhaustive correctness.
- Do not score autosaved workspace drafts merely because they exist. Only completed demo workspace tasks or deliberate checkpoints may contribute artifact evidence, and every such claim must reference an immutable `artifact_versions.id` without asserting exhaustive correctness.
- Keep introduction, background, panel, and wrap-up phase ownership on the server; pause/repeat utterances must not advance assessment state.
- Do not use the optional camera interaction result to identify a person, classify voice authenticity, infer deception or personal traits, affect evidence/score, or make an employment decision. Store no raw camera media.
- Demo progression requires a matching completed-question transport receipt. Group answer fragments by server-owned pending question; incomplete phrases and introduction-only replies must not advance coverage. Reserve one accepted answer per question atomically, including in the local memory store. Keep the demo silence window at 1500 ms and preserve the fast start-of-speech interruption threshold.
- Workspace modality is selected from server-owned questions/scenarios. Keep the editor/canvas mounted when minimized, preserve audio controls, and respect reduced motion. Canvas is one embedded Excalidraw surface stored in a private canvas artifact. Candidate workspace review inspects only the requested saved artifact without executing it or claiming live screen access; an empty canvas is stated plainly. A complete Client/API Server/Database demo diagram with at least two arrows advances automatically. Evaluators use deliberate checkpoints, while candidate-requested workspace review may inspect the latest autosave.
- New showcases use explicit `demoMode`, frozen with the published definition, with all five roles and a ten-minute maximum for new dashboard interviews. Combine introduction/background in the Hiring Manager greeting, then Technical, Product Manager, Customer, and Behavioural. Finish after five substantive answers and the spoken closing; pause/repeat/readiness controls must not count. Candidate progress counts answered roles, not generated questions. Existing invitations retain their duration and sequence; normal interviews retain adaptive priorities. Demos with at least ten minutes assign code to Technical and canvas to Product. Default to intern tasks accepting coursework. Save selected Python/JavaScript/TypeScript language in checkpoints. Workspace acknowledgements describe only saved artifacts; E2B reports selected test-case outcomes, not a blanket correctness claim.

## Done Criteria

Before finishing a change:

1. Run the narrowest relevant verification command.
2. For shipped app/runtime changes, ensure `npm run verify` passes. When live credentials are unavailable, run every offline subcommand and record the blocked doctor/live gates explicitly.
3. If you changed files in `components/` or `app/api/`, verify that `README.md`, this file, and the relevant `docs/ai/` files still match the implementation.
4. Update root README and affected docs when workflow, request contracts, architecture, or environment guidance changes.
5. If the change touches workflows, interfaces, gotchas, or security details, update the matching file under [docs/ai/L1/](docs/ai/L1/) and bump `Last Reviewed` in [docs/ai/L0_repo_card.md](docs/ai/L0_repo_card.md).

## Git Conventions

### Commit messages — conventional commits

- **Format:** `type: description` or `type(scope): description`
- **Types:** `feat:` (new feature), `fix:` (bug fix), `chore:` (maintenance, version bumps), `test:` (test additions/changes), `docs:` (documentation)
- **Scoped variant:** `feat(scope):`, `fix(scope):` — e.g. `feat(api): add stop-conversation status flag`
- **Lowercase after prefix** — `feat: add feature`, not `feat: Add feature`
- **Present tense** — "add feature", not "added feature"
- **PR number appended** — `feat: add feature (#123)`

### Branch names

- **Format:** `type/short-description` — lowercase, hyphen-separated
- **Types match commit types:** `feat/`, `fix/`, `chore/`, `test/`, `docs/`
- **Examples:** `feat/agent-metrics`, `fix/transcript-uid`, `docs/progressive-disclosure`

### General rules

- **No AI tool names** — never mention claude, cursor, copilot, cody, aider, gemini, codex, chatgpt, or gpt-3/4 in commit messages or PR descriptions.
- **No Co-Authored-By trailers** — omit AI attribution lines.
- **No `--no-verify`** — let git hooks run normally.
- **No git config changes** — do not modify `user.name` or `user.email`.

## Doc Commands

| Command         | When to use                                                  |
| --------------- | ------------------------------------------------------------ |
| generate docs   | No `docs/ai/` directory exists yet                           |
| update docs     | Code changed since the `Last Reviewed` date in L0            |
| test docs       | Verify docs give agents the right context (writes `docs/ai/test-results.md`) |
| fix docs        | Close findings from a docs review or test run                |

The generator and tester live in the [AgoraIO-Community/ai-devkit](https://github.com/AgoraIO-Community/ai-devkit) skill set. See the [progressive disclosure standard](https://github.com/AgoraIO-Community/ai-devkit/blob/main/docs/progressive-disclosure-standard.md) for the full specification.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
