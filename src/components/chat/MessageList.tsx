// MessageList.tsx
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import { MoreHorizontal, Smile, Reply, MessageSquare } from "lucide-react";
import { useState } from "react";
import { ReactionPicker } from "./ReactionPicker";
import { EmployeeProfile } from "./EmployeeProfile";
import type { Message, Channel, DirectMessage } from "../chat/types/types";

interface MessageListProps {
  messages: Message[];
  channel: Channel | DirectMessage;
  currentUserId: string;
}

export function MessageList({ messages, channel, currentUserId }: MessageListProps) {
  const [activeReactionPicker, setActiveReactionPicker] = useState<string | null>(null);

  const handleReaction = (messageId: string, emoji: string) => {
    // In real app, this would update the message in the backend
    console.log(`Adding reaction ${emoji} to message ${messageId}`);
    setActiveReactionPicker(null);
  };

  const handleReply = (messageId: string) => {
    // Implement reply functionality
    alert(`Reply to message ${messageId}`);
  };

  const handleMoreOptions = (messageId: string) => {
    // Implement more options (edit, delete, pin, etc.)
    alert(`More options for message ${messageId}`);
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

              return (
                <div
                  key={message.id}
                  className={`group flex items-end gap-2 px-4 sm:px-6 ${firstOfRun ? 'mt-3' : 'mt-0.5'} ${mine ? 'justify-end' : 'justify-start'}`}
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
                      }`}
                    >
                      {showName && (
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-xs font-semibold text-brand">{message.author.name}</span>
                          {message.author.town && message.author.town !== 'Unknown' && (
                            <span className="text-[10px] text-gray-500">📍 {message.author.town}</span>
                          )}
                        </div>
                      )}
                      <p className="leading-relaxed whitespace-pre-wrap break-words text-[15px]">
                        {message.content}
                        {/* room for the time, so it never sits on top of the last word */}
                        <span className="inline-block w-14" aria-hidden="true" />
                      </p>
                      <span className={`absolute bottom-1 right-2.5 text-[10px] ${mine ? 'text-white/75' : 'text-gray-400'}`}>
                        {formatTime(message.timestamp)}
                      </span>
                    </div>

                    {/* Reactions */}
                    {message.reactions && message.reactions.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {message.reactions.map((reaction, idx) => (
                          <Button
                            key={idx}
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs rounded-full bg-white border-gray-200 hover:bg-gray-50"
                          >
                            <span className="mr-1">{reaction.emoji}</span>
                            {reaction.count}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action buttons, on the inner side of the bubble */}
                  <div className={`flex items-center gap-0.5 self-center opacity-0 group-hover:opacity-100 transition-opacity ${mine ? 'order-first' : ''}`}>
                    <ReactionPicker
                      onReactionSelect={(emoji) => handleReaction(message.id, emoji)}
                      open={activeReactionPicker === message.id}
                      onOpenChange={(open) => setActiveReactionPicker(open ? message.id : null)}
                    >
                      <Button variant="ghost" size="sm" className="h-7 px-1.5 text-gray-500 hover:text-gray-700">
                        <Smile className="h-4 w-4" />
                      </Button>
                    </ReactionPicker>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 text-gray-500 hover:text-gray-700"
                      onClick={() => handleReply(message.id)}
                    >
                      <Reply className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 text-gray-500 hover:text-gray-700"
                      onClick={() => handleMoreOptions(message.id)}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
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