# RoundTable AI

RoundTable is a backend-first, voice-native adaptive interview panel. A deterministic controller chooses exactly one role and one objective per candidate turn; each role uses its own short-lived Agora agent with a configured Gradium voice while the candidate remains in one RTC room.

The MVP supports Technical, Product, Hiring Manager, Behavioural, and Customer perspectives; signed single-use invitations; shared durable context; dynamic follow-ups; difficulty adjustment; vague-answer and contradiction checks; Monaco and Excalidraw workspaces; session-scoped MCP tools; isolated E2B tests; and evidence-linked final assessments. It never emits an automatic hire/reject decision.

## Current verification status

The code is derived from Agora's official `agent-quickstart-nextjs`, and the source mapping has been checked. Offline tests, lint, type checking, API contract checks, and a production build are the required local gates. A real Agora voice round trip, RTM transcript delivery, token renewal, 20-attempt barge-in test, and impaired-network test still require project credentials and must not be reported as verified until they are run.

## Architecture

```text
Candidate browser <-- Agora RTC/RTM --> one active role voice agent
                                           |
                                 /api/ai/chat/completions
                                           |
                           panel evaluator + controller
                              |                    |
                         Supabase            MCP / E2B

Company dashboard <-- status-only Realtime projection while live
Company results   <-- transcript + assessment after completion
```

The browser never owns scores, role selection, or candidate state. Each finalized answer is reserved with a hash, evaluated once for all configured roles, checked against literal transcript evidence, and committed with compare-and-swap session state. Duplicate LLM calls reuse the stored response.

The company dashboard creates an explicit `demoMode: true` showcase: one project explored by Hiring Manager, Technical Interviewer, Product Manager, Customer, then Behavioural Interviewer. The hiring manager's greeting combines introduction and background into the first question. Five substantive answers complete the panel; the agent gives a short closing statement, then the browser finalizes after the closing transcript and end of agent speech. Allow 7–9 minutes for new ten-minute dashboard demos including coding and design; older invitations retain their duration. The demo waits 1.5 seconds of silence before responding. Candidate speech fragments are grouped under the pending question, and an introduction alone does not complete the project question. A completed question transcript plus end-of-speech state produces a candidate transport receipt; an unheard/interrupted question is repeated before that role can advance. Explicit “skip”, “I don't know”, or “that's my answer” allows a short answer to finish. Normal interviews retain their adaptive policies, and old two-minute invitations retain their original configuration.

## Setup

### Interview workspaces

Technical demo questions now select the IDE or system-design canvas from required questions and the published plan's scenarios. Normal interview questions also select a workspace when they request implementation or design. The workspace opens automatically, with a reduced-motion-aware transition, while the transcript and visualizer compact; microphone and end-call controls remain available. Minimize/reopen controls preserve the mounted workspace and its drafts.

The workspace has one **Canvas**: an embedded Excalidraw surface with selection, shapes, arrows, lines, drawing, erase, and text tools. It autosaves into the private session artifact; **Share checkpoint** remains optional for durable assessment evidence. Say “open the editor”, “open the canvas”, “review my diagram”, “check now”, or simply “updated.” Ask “can I use Python?” or “give me a hint” for a concise, task-specific, non-scoring response. The interviewer checks expected code logic and saved canvas labels/arrows without running candidate code or claiming live screen access. A complete code task or Client/API Server/Database canvas diagram with at least two arrows gives grounded feedback and hands off automatically to the next panel role.

To rehearse the IDE, add a required question such as “Write a TypeScript function to deduplicate request IDs” before publishing. A system-design scenario opens the canvas instead. New ten-minute demos assign code to Technical and canvas to Product, keeping all five roles. Create and publish a new interview for this sequence. No new credentials or migration are required.

Requirements: Node.js 22+, npm, an Agora project with Conversational AI and RTM enabled, a Supabase project, Groq API access, and E2B.

```bash
npm install
copy env.local.example .env.local
npm run doctor
npm run dev
```

Apply every migration in [supabase/migrations](supabase/migrations) in filename order before using company or candidate flows. Configure these values in `.env.local` and in Vercel:

- `NEXT_PUBLIC_AGORA_APP_ID`, `NEXT_AGORA_APP_CERTIFICATE`
- `APP_BASE_URL`
- `GRADIUM_API_KEY` plus `GRADIUM_HIRING_MANAGER_VOICE_ID`, `GRADIUM_TECHNICAL_VOICE_ID`, `GRADIUM_PRODUCT_VOICE_ID`, `GRADIUM_CUSTOMER_VOICE_ID`, and `GRADIUM_BEHAVIORAL_VOICE_ID`
- `GROQ_API_KEY`, with optional `GROQ_EVALUATOR_MODEL`, `GROQ_SPEAKER_MODEL`, `GROQ_PLANNER_MODEL`, and `GROQ_ASSESSMENT_MODEL`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_DEMO_MODE=true` (optional local testing mode; disables company email authentication and must not be enabled in production)
- `NEXT_PUBLIC_DISABLE_COMPANY_AUTH=true` (submission/demo-only public company dashboard; keeps Supabase persistence enabled and must be removed after judging)
- `PUBLIC_DEMO_ORGANIZATION_ID` (optional fixed organization UUID for that public dashboard)
- `DEMO_COMPANY_NAME` (optional label when using the process-local demo store)
- `SESSION_SIGNING_SECRET`
- `E2B_API_KEY`
- `GOOGLE_API_KEY` (optional, server-only, for the candidate-consented camera interaction check)
- `GEMINI_VIDEO_MODEL=gemini-3.7-flash` (optional override for that check)
- `AGORA_WEBHOOK_SECRET`
- `CRON_SECRET`

Secrets without the `NEXT_PUBLIC_` prefix must never reach the browser.

## Product flow

1. An interviewer signs in at `/company` with Google. The server idempotently provisions a private workspace keyed to that Supabase user, so definitions, invitations, resumes, sessions, and reports stay scoped to that interviewer.
2. `POST /api/interviews/:id/plan` creates a Zod-validated editable rubric. Employer text is treated as untrusted input.
3. Publishing freezes an immutable version and returns a seven-day, single-use candidate URL. The dashboard displays it and copies it only after the interviewer presses **Copy link**. Candidate details and the optional plain-text resume are attached here, never on the candidate consent page.
4. The candidate sees the fixed AI/retention/human-review disclosure and must consent before the server creates the Agora session. The browser receives credentials immediately; agent startup continues while the candidate room connects.
5. The agent introduces the role, company, and panel. Demo mode combines introduction/background and prioritizes one answer per role. Product asks about missing customer impact or verifies an impact already claimed; Customer runs a spoken role-play. Pause, repeat, and brief readiness requests do not advance or score the interview. Candidate progress reports answered roles, not merely generated questions. The deadline starts after agent startup completes.
6. Agora calls the authenticated OpenAI-compatible endpoint. It ignores caller model and system instructions, stores transcript evidence, evaluates all roles, applies controller rules, and streams the chosen interviewer question.
7. Code/canvas drafts autosave; deliberate checkpoints are retained as assessment evidence. Candidate interview reviews inspect saved work without executing it. The server-scoped E2B tool remains available for an explicitly enabled future exercise, with no app secrets and fixed limits.
8. Finalization creates an idempotent evidence-linked assessment. The completed session opens on `/company/analysis/:sessionId`; candidate feedback remains hidden until explicitly released. The Workspace tab confirms autosaved code/canvas versions and factual structure without exposing raw source.

## Main APIs

- `POST /api/interviews`, `POST /api/interviews/:id/plan`, `POST /api/interviews/:id/publish`
- `GET /api/invitations/:token`, `POST /api/invitations/:token/session`
- `POST /api/sessions/:id/start|renew|stop|finalize|release`
- `GET /api/sessions/:id/report` (company-only normalized completed-interview report)
- `GET|PUT /api/sessions/:id/artifacts/:type`
- `POST /api/ai/chat/completions`
- `POST /api/mcp/:grant`
- `POST /api/webhooks/agora`

Company endpoints normally require a Supabase access token. When the explicit submission-only `NEXT_PUBLIC_DISABLE_COMPANY_AUTH=true` escape hatch is enabled, they instead use a fixed public demo organization while retaining Supabase persistence. Candidate session endpoints require the HttpOnly signed guest cookie. The LLM endpoint uses a random per-session bearer credential known only to Agora and the server.

After finalization, the company report endpoint returns a stable dashboard projection: session and candidate metadata, competency evidence, role views, coverage, an evidence-linked transcript, and factual workspace metadata. The candidate enters the report name before consenting and joining unless the invitation already supplies it. Each accepted spoken answer is associated with the panel member whose question preceded it; the first demo answer belongs to Hiring Manager. Control utterances such as “continue” and “check now” are excluded. Completed code and canvas tasks contribute conservative, specific competency signals backed by immutable `artifact_versions`; they do not claim exhaustive correctness. Transcript citations open the cited turn, while workspace citations open the Workspace section. The endpoint never exposes internal controller cache, live private events, raw media, raw source, or an automated hire/reject decision.

For the new demo, apply `202609050001_coverage_demo.sql`, restart the app, then create and publish a new invitation. `POST /api/interviews` accepts optional `demoMode` (requires all five roles); the immutable version preserves it. Candidate session polling returns `session.demo` with role progress, closing state, and `pendingQuestion: {id, text}` plus the server deadline. `QUESTION_DELIVERED` events must match that server-owned question. Receipts, answer fragments, and response cache entries use the existing private session events table; no additional migration is needed. Company live responses still contain only status and health.

The public homepage contains a bounded one-question Agora voice sample. It reuses the StrictMode-safe RTC/RTM quickstart boundary with a fixed RoundTable prompt, one response, and a 20-second idle timeout. It is available automatically in development; set `ENABLE_HOMEPAGE_VOICE_DEMO=true` deliberately on Vercel to enable it in production. `ENABLE_LEGACY_QUICKSTART_DEMO=true` remains a backwards-compatible diagnostic switch.

The homepage uses near-black surfaces, `#171717` cards, subtle borders, and `#3ecf8e` accents. A Three.js core sits in a dedicated slot beneath the headline, then becomes a compact left-hand constellation beside the readable Agora sample. Artifact positions and role labels follow measured layout slots. Narrow screens stack content with vertical scrolling within each scene. All three content sections crossfade on one shared stage while the same artifact interpolates between them, using frame-rate-independent easing and normalized wheel input. Navigation stops at scene three, with an explicit Back to start action, and scene navigation pauses during voice sessions. Reduced-motion preferences disable continuous decorative movement. Both voice experiences reuse Agora exclusively: there is no browser TTS fallback, fabricated transcript, or hardcoded connection/latency claim. Failures remain visible in the voice surface. Role buttons explore perspective descriptions only; the server still owns live interview roles.

The candidate invitation and live interview room use the same visual system. The pre-call view emphasizes reassurance, consent, duration, panel context, and human review. Candidate resumes are attached by the recruiter to a ready interview before publishing, not uploaded through the public invitation. The live room keeps transcript, current panel perspective, workspace, audio controls, connection health, and remaining time readable without exposing an unreliable role counter. Route transitions, invitation bootstrap, Agora room setup, lazy conversation loading, and finalization use a consistent branded loading screen. The company report presents a verdict-neutral evidence score, coverage, competency cards, panel views, transcript citations, workspace facts, and recruiter follow-ups.

## Deploy to Vercel

Import the GitHub repository into Vercel as a Next.js project and paste the values from `.env.local` into Project Settings → Environment Variables. Keep `NEXT_PUBLIC_DEMO_MODE=false` and `NEXT_PUBLIC_DISABLE_COMPANY_AUTH=false`. In Supabase Authentication, enable Google, add the Google OAuth client credentials, and allow `https://<your-project>.vercel.app/company` plus `https://<your-project>.vercel.app/company/analysis/**` as redirect URLs. Vercel's automatically provided production URL is used for Agora's custom-LLM callback and generated invitations, so an expired local ngrok `APP_BASE_URL` cannot override production. Apply every migration before the first production interview.

## Verification

```bash
npm test
npm run lint
npm run typecheck
npm run verify:api
npm run build
```

`npm run verify` begins with `doctor`, so it requires a complete `.env.local`. Supabase RLS assertions are in [supabase/tests/rls.sql](supabase/tests/rls.sql).

Groq assessment requests send a deduplicated packet of verified candidate quotes (up to 4,000 UTF-8 bytes), not the full transcript, rubric, analyses, and report repeated together. The complete system/schema/input has a 6,000-byte preflight limit and output is capped at 1,500 tokens. The model only adds short evidence-linked narratives; stored ratings, full evidence, unobserved competencies, and contradictions remain intact. Demo evaluation uses shorter context and a 1,536-token output cap. GPT-OSS requests use low reasoning effort. A 429 activates a per-key/model process-local cooldown honoring `Retry-After`; calls in that window use existing fallbacks immediately. This reduces request size and repeat failures but does not increase the provider's organization quota or coordinate separate server instances.

Optional live provider check: `node --import tsx scripts/verify-assessment-provider.ts`. This consumes one small Groq request using synthetic evidence and verifies the assessment response passes validation. It is not part of offline verification. Current-version assessments are idempotently retained; an older completed assessment is upgraded once when its company report is opened.

## Privacy and scope

No raw audio or video is recorded. Transcript, resume, events, artifacts, tool results, assessments, and claimed invitation metadata are purged 30 days after completion by `purge_expired_interview_data()`; `vercel.json` invokes it daily through an authenticated cron route. Live company views receive only session ID, status, health, and timestamps.

Candidates may voluntarily run a short camera interaction check: after explicit consent, the app gives a random head-movement and phrase prompt, sends one temporary clip directly to Gemini for review, then discards the clip. Only `completed`, `inconclusive`, or `unavailable` is retained for human review. It does not establish identity, detect TTS or deception, infer personal characteristics, affect a score, or make an employment decision. This is separate from the interview assessment and is not available to a company while the session is live. Video identity/lip-sync analysis, candidate accounts, ATS integrations, multilingual support, and automatic employment decisions remain outside this MVP.

New dashboard defaults target a Software Engineer Intern with zero experience. Choose Python, JavaScript, or TypeScript in the editor; selected language is autosaved while you work. Say “review my code,” “review my diagram,” “now see it,” “check now,” or “can you see it?” The interviewer reads the latest autosaved snapshot without requiring a checkpoint click. Say “please continue” or “next question” to skip the remaining workspace explanation and move to the next role.

The candidate-facing demo does not execute code or mention E2B. It reviews the saved code structure and expected requirements, then automatically moves to the next role when the workspace task is complete. “Check now” and “continue” are navigation controls: they are stored as workspace events, never as candidate transcript evidence or assessment findings. E2B remains a server-scoped, capped tool for a future explicitly enabled exercise; it has no application secrets.
