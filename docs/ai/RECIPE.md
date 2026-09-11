# Base Recipe Contract

RoundTable extends Agora's official Next.js conversational-agent quickstart. Preserve these invariants:

- `useJoin` and `useLocalMicrophoneTrack` remain gated by the StrictMode `isReady` guard.
- Hooks own RTC leave, microphone close, and publication lifecycle.
- Browser credentials use `RtcTokenBuilder.buildTokenWithRtm`; RTC/RTM identity and channel must match the minted token.
- `AgoraVoiceAI` starts only after the RTC join and maps transcript UID `0` to the local UID.
- Interrupted turns remain visible and are not counted as completed coverage.
- Candidate pause/repeat requests do not advance the interview phase or produce assessment evidence.
- Exactly one Agora role agent speaks at a time. On a server-owned role handoff, stop the prior role agent and start the next configured role agent in the same candidate channel; the browser and controller never select roles or voices.
- No company live channel may expose transcript, answer, score, canvas, code, or assessment content.
- Every assessment claim needs a transcript-turn or artifact-version reference and `humanReviewRequired: true`.
