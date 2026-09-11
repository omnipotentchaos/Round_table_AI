'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { InterviewWorkspace } from './InterviewWorkspace';
import { LivenessCheck } from './LivenessCheck';

type QuickstartConversationLayoutProps = {
  statusPanel: ReactNode;
  pipelineMetrics: ReactNode;
  transcriptPanel: ReactNode;
  visualizer: ReactNode;
  controls: ReactNode;
  onEndConversation: () => void;
  activeModality?: 'voice' | 'code' | 'canvas' | 'scenario';
  sessionId?: string;
  timeRemainingSeconds?: number | null;
  activeRole?: string;
  activePhase?: string;
  demoProgress?: { roles: string[]; answeredRoles: string[]; closing: boolean } | null;
  workspacePrompt?: string | null;
};

export function QuickstartConversationLayout({
  statusPanel,
  pipelineMetrics,
  transcriptPanel,
  visualizer,
  controls,
  onEndConversation,
  activeModality = 'voice',
  sessionId,
  timeRemainingSeconds,
  activeRole = 'technical',
  activePhase = 'introduction',
  workspacePrompt,
}: QuickstartConversationLayoutProps) {
  const requestedWorkspace = activeModality === 'code' || activeModality === 'canvas';
  const [minimized, setMinimized] = useState(false);
  const [workspaceVisited, setWorkspaceVisited] = useState(requestedWorkspace);
  useEffect(() => {
    setMinimized(false);
    if (requestedWorkspace) setWorkspaceVisited(true);
  }, [activeModality, workspacePrompt, requestedWorkspace]);
  const focused = Boolean(sessionId && requestedWorkspace && !minimized);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#0d0d0d] text-left text-[#ededed] before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] before:bg-[size:48px_48px]">
      <header className="relative z-10 flex shrink-0 flex-col gap-4 border-b border-[#272727] bg-[#0d0d0de8] px-4 py-4 backdrop-blur-xl md:min-h-[82px] md:flex-row md:items-center md:justify-between md:px-7 md:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#315142] bg-[#3ecf8e12] text-sm font-bold text-[#3ecf8e]">RT</div>
          <div className="flex min-w-0 flex-col justify-center gap-1">
            <span className="truncate text-base font-semibold leading-none tracking-[-0.025em] text-[#f1f1f1]">RoundTable AI</span>
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[.14em] text-[#3ecf8e]">Live interview room</span>
          </div>
          <span className="ml-2 hidden rounded-full border border-[#303030] bg-[#171717] px-3 py-1.5 text-[10px] capitalize text-[#8b8b8b] sm:inline-flex">{activePhase.replaceAll('_', ' ')} / {activeRole.replaceAll('_', ' ')}</span>
        </div>

        <div className="flex items-center gap-2 md:pr-1">
          {sessionId && <LivenessCheck sessionId={sessionId} />}
          {requestedWorkspace && <Button variant="outline" size="sm" onClick={() => setMinimized((value) => !value)}>
            {minimized ? 'Open workspace' : 'Minimize workspace'}
          </Button>}
          {timeRemainingSeconds !== null && timeRemainingSeconds !== undefined && (
            <span className="rounded-full border border-[#303030] bg-[#171717] px-3 py-1.5 font-mono text-[10px] tabular-nums text-[#9a9a9a]">
              {Math.floor(timeRemainingSeconds / 60)}:{String(timeRemainingSeconds % 60).padStart(2, '0')} remaining
            </span>
          )}
          {statusPanel}
          <Button
            variant="destructive"
            size="sm"
            className="h-8 rounded-md border border-[#512929] bg-[#2a1515] px-3 text-xs font-medium text-[#ff8b8b] hover:bg-[#351919]"
            onClick={onEndConversation}
            aria-label="End conversation with AI agent"
            title="End conversation"
          >
            End Conversation
          </Button>
        </div>
      </header>

      <div data-workspace-focused={focused} className={`relative z-[1] grid min-h-0 w-full flex-1 gap-4 p-4 transition-[grid-template-columns] duration-500 ease-in-out motion-reduce:transition-none md:p-5 ${focused ? 'lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]'}`}>
        {/* Transcript Rail */}
        <aside className={`min-h-0 min-w-0 ${focused ? 'order-2 lg:order-1' : 'order-2 lg:order-1 lg:row-span-2'}`}>
          {focused && <div className="mb-3 rounded-xl border border-border bg-card p-3 text-sm">
            <div className="mb-2 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" />Voice interview continues</div>
            <p className="text-xs text-muted-foreground">Take your time. Your work autosaves; ask the panel to review it when you are ready.</p>
          </div>}
          <div className={`overflow-hidden transition-[max-height,opacity] duration-500 motion-reduce:transition-none ${focused ? 'h-64 max-h-[42vh] opacity-100 lg:h-full' : 'h-64 max-h-[70vh] opacity-100 lg:h-full'}`}>
            {transcriptPanel}
          </div>
        </aside>

        {/* Visualizer (and potentially small controls) */}
        <main className={`flex min-h-0 min-w-0 flex-col ${focused ? 'order-3 lg:col-start-1 lg:row-start-2' : 'order-1 lg:col-start-2 lg:row-span-2'}`}>
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#272727] bg-[radial-gradient(circle_at_50%_45%,rgba(62,207,142,.055),transparent_34%),#111] px-4 pb-4 shadow-[0_24px_80px_rgba(0,0,0,.25)]">
            <div className={`flex items-center justify-center overflow-hidden transition-[max-height,opacity] duration-500 motion-reduce:transition-none ${focused ? 'min-h-[11rem] max-h-[12rem] shrink-0 opacity-100' : 'min-h-0 max-h-[70vh] flex-1 opacity-100'}`}>
              {visualizer}
            </div>
            <div className={`mx-auto mb-1 opacity-70 ${focused ? 'block scale-90 origin-center' : 'hidden xl:block'}`}>{pipelineMetrics}</div>
            <div className="shrink-0 pt-3">{controls}</div>
          </div>
        </main>

        {/* Code Workspace */}
        {(workspaceVisited || requestedWorkspace) && sessionId && (
          <section aria-label="Interview workspace" inert={!focused} className={`order-1 min-h-0 min-w-0 overflow-hidden transition-[opacity,transform,max-height] duration-500 ease-out motion-reduce:transition-none lg:col-start-2 lg:row-start-1 lg:row-span-2 ${focused ? 'max-h-[85vh] translate-y-0 opacity-100 animate-in fade-in slide-in-from-bottom-4 motion-reduce:animate-none' : 'pointer-events-none absolute h-0 w-0 max-h-0 translate-y-4 opacity-0'}`}>
            <div className="flex h-full min-h-[32rem] w-full flex-col">
              <p aria-live="polite" className="mb-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">{workspacePrompt ?? 'Your workspace is ready. It autosaves; say “check now” when you want the panel to review it.'}</p>
              <InterviewWorkspace sessionId={sessionId} activeModality={activeModality} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
