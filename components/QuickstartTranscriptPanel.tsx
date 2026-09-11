'use client';

import { useEffect, useMemo, useRef } from 'react';

type TranscriptMessage = {
  turn_id?: string | number;
  uid: number;
  text?: string;
  createdAt?: number;
};

type QuickstartTranscriptPanelProps = {
  messageList: TranscriptMessage[];
  currentInProgressMessage: TranscriptMessage | null;
  agentUIDs: string[];
};

function formatMessageTime(createdAt?: number) {
  if (!createdAt) return null;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(createdAt));
}

export function QuickstartTranscriptPanel({
  messageList,
  currentInProgressMessage,
  agentUIDs,
}: QuickstartTranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(
    () =>
      currentInProgressMessage
        ? [...messageList, currentInProgressMessage]
        : messageList,
    [currentInProgressMessage, messageList],
  );

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-[#292929] bg-[#121212e8] shadow-[0_20px_60px_rgba(0,0,0,.2)]"
      aria-label="Transcription panel"
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#292929] px-4">
        <div>
          <h2 className="text-sm font-semibold text-[#ededed]">Conversation</h2>
          <p className="mt-1 text-[10px] text-[#707070]">Live transcript</p>
        </div>
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider text-[#777]"><i className="h-1.5 w-1.5 rounded-full bg-[#3ecf8e]"/>Live</span>
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center text-xs leading-5 text-[#686868]">
            <span className="mb-3 h-8 w-px bg-gradient-to-b from-transparent via-[#3ecf8e] to-transparent" />
            Your conversation will appear here.
          </div>
        ) : (
          messages.map((message, index) => {
            const isAgent = agentUIDs.includes(String(message.uid));
            const label = isAgent ? 'Agent' : 'You';
            const text = message.text?.trim();
            const time = formatMessageTime(message.createdAt);

            return (
              <article
                key={`${message.turn_id ?? message.uid}-${index}`}
                className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
              >
                <div className="mb-1 flex items-center gap-2 px-1 text-xs font-semibold text-muted-foreground">
                  <span>{label}</span>
                  {time && <span className="font-normal">{time}</span>}
                </div>
                <div
                  className={`max-w-full whitespace-pre-wrap rounded-xl border px-3 py-2 text-sm leading-6 ${
                    isAgent
                      ? 'border-[#2f2f2f] bg-[#1c1c1c] text-[#dedede]'
                      : 'border-[#315142] bg-[#163326] text-[#dff8eb]'
                  }`}
                >
                  {text || '...'}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
