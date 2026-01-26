// MessageList.tsx
import { ScrollArea } from "./ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Button } from "./ui/button";
import { MoreHorizontal, Smile, Reply, Heart, ThumbsUp, MessageSquare } from "lucide-react";
import { useState } from "react";
import { ReactionPicker } from "./ReactionPicker";
import { EmployeeProfile } from "./EmployeeProfile";
import type { Message, Channel, DirectMessage, Reaction } from "../chat/types/types";

interface MessageListProps {
  messages: Message[];
  channel: Channel | DirectMessage;
}

export function MessageList({ messages, channel }: MessageListProps) {
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
            
            {/* Messages for this date */}
            {dateMessages.map((message, index) => {
              const showAvatar = index === 0 || 
                dateMessages[index - 1].author.id !== message.author.id ||
                new Date(message.timestamp).getTime() - new Date(dateMessages[index - 1].timestamp).getTime() > 300000; // 5 minutes
              
              return (
                <div
                  key={message.id}
                  className="group hover:bg-white/50 px-6 py-2 rounded-lg transition-colors mx-2"
                >
                  <div className="flex gap-4">
                    {/* Avatar - only show if needed */}
                    <div className="flex-shrink-0 w-12">
                      {showAvatar ? (
                        <EmployeeProfile employee={message.author as any}>
                          <Avatar className="h-10 w-10 ring-2 ring-white shadow-sm cursor-pointer">
                            <AvatarImage src={message.author.avatar} />
                            <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white">
                              {message.author.initials}
                            </AvatarFallback>
                          </Avatar>
                        </EmployeeProfile>
                      ) : (
                        <div className="h-10 w-10 flex items-center justify-center">
                          <span className="text-xs text-gray-400">
                            {formatTime(message.timestamp)}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      {/* Author and timestamp - only show if needed */}
                      {showAvatar && (
                        <div className="flex items-baseline gap-3 mb-1">
                          <span className="font-semibold text-gray-900">
                            {message.author.name}
                          </span>
                          {/* Town Display - Added Here */}
                          {message.author.town && message.author.town !== 'Unknown' && (
                            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                              📍 {message.author.town}
                            </span>
                          )}
                          {message.author.employeeData && (
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                              {message.author.employeeData.jobTitle}
                            </span>
                          )}
                          <span className="text-xs text-gray-400">
                            {formatTime(message.timestamp)}
                          </span>
                        </div>
                      )}
                      
                      {/* Message content */}
                      <p className="text-gray-900 leading-relaxed whitespace-pre-wrap text-[15px]">
                        {message.content}
                      </p>
                      
                      {/* Reactions */}
                      {message.reactions && message.reactions.length > 0 && (
                        <div className="flex items-center gap-1 mt-2 flex-wrap">
                          {message.reactions.map((reaction, idx) => (
                            <Button
                              key={idx}
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs rounded-full bg-white/80 border-gray-200 hover:bg-gray-50"
                            >
                              <span className="mr-1">{reaction.emoji}</span>
                              {reaction.count}
                            </Button>
                          ))}
                        </div>
                      )}
                      
                      {/* Action buttons */}
                      <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ReactionPicker
                          onReactionSelect={(emoji) => handleReaction(message.id, emoji)}
                          open={activeReactionPicker === message.id}
                          onOpenChange={(open) => setActiveReactionPicker(open ? message.id : null)}
                        >
                          <Button variant="ghost" size="sm" className="h-7 px-2 text-gray-500 hover:text-gray-700">
                            <Smile className="h-4 w-4" />
                          </Button>
                        </ReactionPicker>
                        
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 px-2 text-gray-500 hover:text-gray-700" 
                          onClick={() => handleReply(message.id)}
                        >
                          <Reply className="h-4 w-4" />
                        </Button>
                        
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 px-2 text-gray-500 hover:text-gray-700" 
                          onClick={() => handleMoreOptions(message.id)}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-500">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center mb-4">
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