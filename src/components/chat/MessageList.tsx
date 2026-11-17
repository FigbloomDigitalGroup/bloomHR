// MessageList.tsx
import toast from 'react-hot-toast';
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { MoreHorizontal, Smile, Reply, MessageSquare, Copy, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReactionPicker } from "./ReactionPicker";
import { EmployeeProfile } from "./EmployeeProfile";
import { MessageAttachments } from "./MessageAttachments";
import { reactorNames, summarizeReactions } from "./lib/reactions";
import { messagePreview } from "./lib/attachments";
import { isLocalOnlyMessage } from "./lib/names";
import { confirmDialog } from "../../lib/confirmDialog";
import type { Message, Channel, DirectMessage, ReactionRow } from "../chat/types/types";

interface MessageListProps {
  messages: Message[];
  channel: Channel | DirectMessage;
  currentUserId: string;
  /** every reaction on these messages, one row per person and emoji */
  reactionRows?: ReactionRow[];
  /** login id -> name, to say who reacted */
  peopleNames?: Record<string, string>;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: Message) => void;
  /** resolves true when the change was saved */
  onEdit?: (messageId: string, content: string) => Promise<boolean>;
  onDelete?: (message: Message) => void;
}

/** The element a message is drawn in, so a quote can scroll to it. */
const messageElementId = (id: string) => `chat-message-${id}`;

export function MessageList({
  messages,
  channel,
  currentUserId,
  reactionRows = [],
  peopleNames = {},
  onReact,
  onReply,
  onEdit,
  onDelete,
}: MessageListProps) {
  const [activeReactionPicker, setActiveReactionPicker] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // names of whoever wrote a message here, for reactors who have no employee record
  const names = useMemo(() => {
    const fromMessages: Record<string, string> = {};
    for (const m of messages) fromMessages[m.author.id] = m.author.name;
    return { ...fromMessages, ...peopleNames };
  }, [messages, peopleNames]);

  const handleReaction = (messageId: string, emoji: string) => {
    onReact?.(messageId, emoji);
    setActiveReactionPicker(null);
  };

  const handleCopy = async (message: Message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.success('Copied');
    } catch {
      toast.error('Your browser did not allow copying');
    }
  };

  const handleDelete = async (message: Message) => {
    const ok = await confirmDialog({
      title: 'Delete this message?',
      message: 'It is removed for everyone in the chat, with any files sent with it.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (ok) onDelete?.(message);
  };

  const saveEdit = async () => {
    if (!editing || !onEdit || saving) return;
    const original = byId.get(editing.id);
    const text = editing.text.trim();
    if (!original || text === original.content.trim()) {
      setEditing(null);
      return;
    }
    // a message with no files needs its text: clearing it all would leave an empty bubble (delete it instead)
    if (!text && !(original.attachments?.length)) {
      toast.error('A message needs some text. To remove it, delete it.');
      return;
    }
    setSaving(true);
    const saved = await onEdit(editing.id, text);
    setSaving(false);
    if (saved) setEditing(null);
  };

  // Scrolls to the quoted message and flashes it, so it is clear which one it was.
  const jumpTo = (id: string) => {
    const element = document.getElementById(messageElementId(id));
    if (!element) {
      toast('That message is too far back to show here.');
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlighted(id);
    clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlighted(null), 1600);
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
      });
    }
  };

  // Group messages by date
  const groupedMessages = messages.reduce((groups, message) => {
    const date = formatDate(message.timestamp);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
    return groups;
  }, {} as Record<string, Message[]>);

  return (
    <ScrollArea className="flex-1 bg-gray-50/50">
      <div className="py-4">
        {Object.entries(groupedMessages).map(([date, dateMessages]) => (
          <div key={date}>
            {/* Date separator */}
            <div className="flex items-center justify-center my-6">
              <div className="bg-white px-4 py-2 rounded-full text-sm text-gray-500 border border-gray-200 shadow-sm">
                {date}
              </div>
            </div>

            {/* Messages for this date: mine on the right in the theme colour, others on the left (as in WhatsApp) */}
            {dateMessages.map((message, index) => {
              const mine = message.author.id === currentUserId;
              const firstOfRun = index === 0 ||
                dateMessages[index - 1].author.id !== message.author.id ||
                new Date(message.timestamp).getTime() - new Date(dateMessages[index - 1].timestamp).getTime() > 300000; // 5 minutes
              // a name over the bubble only where it helps: others' messages in a channel
              const showName = firstOfRun && !mine && channel.type === 'channel';
              const showAvatar = firstOfRun && !mine;
              // the welcome line and unsaved placeholders are not real messages: nothing to react to or reply to
              const actionable = !isLocalOnlyMessage(message.id);
              const reactions = summarizeReactions(reactionRows, message.id, currentUserId);
              const quoted = message.replyTo ? byId.get(message.replyTo) : undefined;
              const isEditing = editing?.id === message.id;

              return (
                <div
                  key={message.id}
                  id={messageElementId(message.id)}
                  className={`group flex items-end gap-2 px-4 sm:px-6 transition-colors ${firstOfRun ? 'mt-3' : 'mt-0.5'} ${mine ? 'justify-end' : 'justify-start'} ${
                    highlighted === message.id ? 'bg-yellow-100/70' : ''
                  }`}
                >
                  {!mine && (
                    <div className="flex-shrink-0 w-8">
                      {showAvatar && (
                        <EmployeeProfile employee={message.author as any}>
                          <Avatar className="h-8 w-8 ring-2 ring-white shadow-sm cursor-pointer">
                            <AvatarImage src={message.author.avatar} />
                            <AvatarFallback className="bg-brand text-white text-xs">
                              {message.author.initials}
                            </AvatarFallback>
                          </Avatar>
                        </EmployeeProfile>
                      )}
                    </div>
                  )}

                  <div className={`flex flex-col max-w-[75%] sm:max-w-[65%] ${mine ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`relative px-3 py-2 shadow-sm ${
                        mine
                          ? 'bg-brand text-white rounded-2xl rounded-br-md'
                          : 'bg-white text-gray-900 border border-gray-200 rounded-2xl rounded-bl-md'
                      } ${isEditing ? 'w-[min(32rem,100%)]' : ''}`}
                    >
                      {showName && (
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-xs font-semibold text-brand">{message.author.name}</span>
                          {message.author.town && message.author.town !== 'Unknown' && (
                            <span className="text-[10px] text-gray-500">📍 {message.author.town}</span>
                          )}
                        </div>
                      )}

                      {/* The message this one answers: click to go to it */}
                      {message.replyTo && (
                        <button
                          type="button"
                          onClick={() => jumpTo(message.replyTo as string)}
                          className={`block w-full text-left mb-1.5 rounded-md border-l-4 px-2 py-1 text-xs ${
                            mine ? 'bg-white/15 border-white/70 hover:bg-white/25' : 'bg-gray-100 border-brand hover:bg-gray-200'
                          }`}
                          aria-label={quoted ? `Replying to ${quoted.author.name}: go to their message` : 'Replying to an earlier message'}
                        >
                          {quoted ? (
                            <>
                              <span className={`block font-semibold ${mine ? 'text-white' : 'text-brand'}`}>
                                {quoted.author.id === currentUserId ? 'You' : quoted.author.name}
                              </span>
                              <span className={`block truncate ${mine ? 'text-white/85' : 'text-gray-600'}`}>{messagePreview(quoted)}</span>
                            </>
                          ) : (
                            <span className={mine ? 'text-white/85' : 'text-gray-600'}>An earlier message</span>
                          )}
                        </button>
                      )}

                      <MessageAttachments attachments={message.attachments || []} mine={mine} />

                      {isEditing ? (
                        <div className="space-y-2">
                          <Textarea
                            autoFocus
                            value={editing.text}
                            onChange={(e) => setEditing({ id: message.id, text: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void saveEdit();
                              } else if (e.key === 'Escape') {
                                setEditing(null);
                              }
                            }}
                            aria-label="Edit message"
                            className="min-h-[60px] resize-none bg-white text-gray-900"
                          />
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
                              Cancel
                            </Button>
                            <Button type="button" size="sm" onClick={() => void saveEdit()} disabled={saving}>
                              {saving ? 'Saving…' : 'Save'}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        (message.content || !message.attachments?.length) && (
                          <p className="leading-relaxed whitespace-pre-wrap break-words text-[15px]">
                            {message.content}
                            {/* room for the time, so it never sits on top of the last word */}
                            <span className={`inline-block ${message.isEdited ? 'w-24' : 'w-14'}`} aria-hidden="true" />
                          </p>
                        )
                      )}
                      {!isEditing && (
                        <span className={`absolute bottom-1 right-2.5 text-[10px] ${mine ? 'text-white/75' : 'text-gray-400'}`}>
                          {message.isEdited && 'edited · '}
                          {formatTime(message.timestamp)}
                        </span>
                      )}
                      {/* a message that is only files still needs room for its time */}
                      {!isEditing && !message.content && !!message.attachments?.length && <div className="h-3" aria-hidden="true" />}
                    </div>

                    {/* Reactions: click one to add yours or take it back; hover to see who */}
                    {reactions.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {reactions.map((reaction) => (
                          <Button
                            key={reaction.emoji}
                            variant="outline"
                            size="sm"
                            onClick={() => handleReaction(message.id, reaction.emoji)}
                            title={reactorNames(reaction.users, currentUserId, names)}
                            aria-pressed={!!reaction.mine}
                            aria-label={`${reaction.emoji} ${reaction.count}: ${reactorNames(reaction.users, currentUserId, names)}`}
                            className={`h-6 px-2 text-xs rounded-full ${
                              reaction.mine ? 'bg-green-tint border-brand text-brand' : 'bg-white border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <span className="mr-1">{reaction.emoji}</span>
                            {reaction.count}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action buttons, on the inner side of the bubble */}
                  {actionable && !isEditing && (
                    <div className={`flex items-center gap-0.5 self-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${mine ? 'order-first' : ''}`}>
                      <ReactionPicker
                        onReactionSelect={(emoji) => handleReaction(message.id, emoji)}
                        open={activeReactionPicker === message.id}
                        onOpenChange={(open) => setActiveReactionPicker(open ? message.id : null)}
                      >
                        <Button variant="ghost" size="sm" className="h-7 px-1.5 text-gray-500 hover:text-gray-700" aria-label="React">
                          <Smile className="h-4 w-4" />
                        </Button>
                      </ReactionPicker>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-1.5 text-gray-500 hover:text-gray-700"
                        onClick={() => onReply?.(message)}
                        aria-label="Reply"
                      >
                        <Reply className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 px-1.5 text-gray-500 hover:text-gray-700" aria-label="More">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align={mine ? 'end' : 'start'} className="w-44">
                          <DropdownMenuItem onClick={() => onReply?.(message)}>
                            <Reply className="h-4 w-4 mr-2" />
                            Reply
                          </DropdownMenuItem>
                          {message.content && (
                            <DropdownMenuItem onClick={() => void handleCopy(message)}>
                              <Copy className="h-4 w-4 mr-2" />
                              Copy text
                            </DropdownMenuItem>
                          )}
                          {mine && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setEditing({ id: message.id, text: message.content })}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => void handleDelete(message)} className="text-red-600 focus:text-red-600">
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <div className="w-16 h-16 rounded-full bg-green-tint flex items-center justify-center mb-4">
              <MessageSquare className="h-8 w-8 text-gray-400" />
            </div>
            <div className="text-lg font-semibold mb-2">No messages yet</div>
            <div className="text-sm text-center max-w-md">
              Be the first to start the conversation in {channel.type === 'channel' ? `#${channel.name}` : `your chat with ${channel.name}`}!
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
