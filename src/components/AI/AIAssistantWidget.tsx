import { useState } from 'react';
import { MessageCircle, Wand2, X } from 'lucide-react';
import { AIAssistantPage } from './AIAssistantPage';
import { usePermissions } from '../../hooks/usePermissions';
import type { TownProps } from '../../types/supabase';

// The HR AI assistant as a chat in the bottom-right corner of every page, for people with the AI Assistant
// permission. The chat stays mounted once opened, so closing and reopening it keeps the conversation.

export default function AIAssistantWidget(props: TownProps) {
  const { hasPermission, loading } = usePermissions();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);

  if (loading || !hasPermission('ai-assistant')) return null;

  const toggle = () => {
    setOpened(true);
    setOpen((o) => !o);
  };

  return (
    <>
      {opened && (
        <div
          role="dialog"
          aria-label="HR AI Assistant"
          aria-hidden={!open}
          className={`${open ? 'flex' : 'hidden'} fixed bottom-20 right-4 sm:bottom-24 sm:right-6 z-50 h-[560px] max-h-[calc(100vh-7rem)] sm:max-h-[calc(100vh-8rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl`}
        >
          <div className="flex items-center gap-2.5 bg-brand px-4 py-3 text-white">
            <Wand2 className="h-4 w-4" />
            <span className="flex-1 text-sm font-semibold">HR AI Assistant</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the assistant" className="rounded-full p-1 hover:bg-white/15">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <AIAssistantPage {...props} widget />
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? 'Close the AI assistant' : 'Open the AI assistant'}
        aria-expanded={open}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex h-11 w-11 sm:h-14 sm:w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-transform hover:scale-105 hover:bg-brand-dark"
      >
        {open ? <X className="h-5 w-5 sm:h-6 sm:w-6" /> : <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6" />}
      </button>
    </>
  );
}
