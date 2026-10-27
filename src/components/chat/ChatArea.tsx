// ChatArea.tsx
import { Hash, MoreVertical, Search, Users, Bell, BellOff, Home } from "lucide-react";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { useEffect, useState } from "react";
import { SearchDialog } from "./SearchDialog";
import { MembersDialog } from "./MembersDialog";
import { EmployeeProfile } from "./EmployeeProfile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import type { Channel, DirectMessage, Employee, Message, ReactionRow } from "../chat/types/types";

interface ChatAreaProps {
  channel: Channel | DirectMessage;
  messages: Message[];
  currentUserId: string;
  employees: Employee[];
  /** resolves false when nothing was sent, so the draft stays */
  onSendMessage: (content: string, files: File[], replyTo?: Message | null) => Promise<boolean> | boolean | void;
  onToggleMute: (channelId: string) => void;
  isMuted?: boolean;
  reactionRows?: ReactionRow[];
  peopleNames?: Record<string, string>;
  onReact?: (messageId: string, emoji: string) => void;
  onEditMessage?: (messageId: string, content: string) => Promise<boolean>;
  onDeleteMessage?: (message: Message) => void;
}

export function ChatArea({
  channel,
  messages,
  currentUserId,
  onSendMessage,
  onToggleMute,
  employees = [],
  isMuted = false,
  reactionRows = [],
  peopleNames = {},
  onReact,
  onEditMessage,
  onDeleteMessage,
}: ChatAreaProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  // the message being answered; a reply belongs to its chat, so switching chats drops it
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  useEffect(() => setReplyingTo(null), [channel.id]);
  // ...and to a message that is still there
  useEffect(() => {
    if (replyingTo && !messages.some((m) => m.id === replyingTo.id)) setReplyingTo(null);
  }, [messages, replyingTo]);

  const handleSearch = () => {
    setShowSearch(true);
  };

  const handleShowUsers = () => {
    setShowMembers(true);
  };

  const handleToggleMute = () => {
    onToggleMute(channel.id);
  };

  const handleNavigateHome = () => {
    window.location.href = "/";
  };

  return (
    <>
      <div className="flex-1 flex flex-col bg-white">
        {/* Enhanced Header */}
        <header className="h-16 border-b border-gray-200 flex items-center justify-between gap-2 px-3 sm:px-6 bg-white/80 backdrop-blur-sm">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            <SidebarTrigger />
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {channel.type === 'channel' ? (
                <div className="w-10 h-10 shrink-0 rounded-lg bg-brand flex items-center justify-center">
                  <Hash className="h-5 w-5 text-white" />
                </div>
              ) : (
                <EmployeeProfile employee={channel as any}>
                  <div className="relative shrink-0 cursor-pointer">
                    {channel.avatar ? (
                      <img src={channel.avatar} alt="" className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow-sm" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center ring-2 ring-white shadow-sm">
                        <span className="text-sm font-semibold text-white">
                          {channel.initials}
                        </span>
                      </div>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${
                      channel.status === 'online' ? 'bg-green-500' :
                      channel.status === 'away' ? 'bg-yellow-500' :
                      'bg-gray-400'
                    }`}></span>
                  </div>
                </EmployeeProfile>
              )}
              <div className="min-w-0">
                <h1 className="font-semibold text-gray-900 text-base sm:text-lg truncate">
                  {channel.type === 'channel' ? `# ${channel.name}` : channel.name}
                </h1>
                {channel.type === 'channel' ? (
                  <p className="text-xs sm:text-sm text-gray-500 truncate">
                    {employees.length} members • {channel.isPrivate ? 'Private channel' : 'Public channel'}
                  </p>
                ) : (
                  <p className="text-xs sm:text-sm text-gray-500 capitalize truncate">
                    {channel.status} • Direct message
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* On phones only mute and the menu stay in the header; search and members move into the menu.
                The person's card (their picture, left) has their phone number and email. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleToggleMute}
              title={isMuted ? 'Emails for this chat are muted: unmute' : 'Mute emails about this chat'}
              aria-label={isMuted ? 'Unmute emails for this chat' : 'Mute emails for this chat'}
              aria-pressed={isMuted}
              className="text-gray-500 hover:text-orange-600 hover:bg-orange-50"
            >
              {isMuted ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSearch} aria-label="Search this chat" className="hidden sm:inline-flex text-gray-500 hover:text-green-600 hover:bg-green-50">
              <Search className="h-5 w-5" />
            </Button>
            {channel.type === 'channel' && (
              <Button variant="ghost" size="icon" onClick={handleShowUsers} aria-label="Members" className="hidden sm:inline-flex text-gray-500 hover:text-brand hover:bg-green-tint">
                <Users className="h-5 w-5" />
              </Button>
            )}

            {/* Three Dots Dropdown Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More" className="text-gray-500 hover:text-gray-700 hover:bg-gray-100">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleSearch} className="sm:hidden">
                  <Search className="h-4 w-4 mr-2" />
                  Search
                </DropdownMenuItem>
                {channel.type === 'channel' && (
                  <DropdownMenuItem onClick={handleShowUsers} className="sm:hidden">
                    <Users className="h-4 w-4 mr-2" />
                    Members
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleNavigateHome}>
                  <Home className="h-4 w-4 mr-2" />
                  Go to Home
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Messages */}
        <MessageList
          messages={messages}
          channel={channel}
          currentUserId={currentUserId}
          reactionRows={reactionRows}
          peopleNames={peopleNames}
          onReact={onReact}
          onReply={setReplyingTo}
          onEdit={onEditMessage}
          onDelete={onDeleteMessage}
        />

        {/* Input */}
        <MessageInput
          channelName={channel.name}
          onSendMessage={onSendMessage}
          disabled={isMuted}
          employees={employees}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          currentUserId={currentUserId}
        />
      </div>

      <SearchDialog
        open={showSearch}
        onOpenChange={setShowSearch}
        channel={channel}
        messages={messages}
      />

      {channel.type === 'channel' && (
        <MembersDialog
          open={showMembers}
          onOpenChange={setShowMembers}
          channel={channel}
          employees={employees} // Pass employees to MembersDialog
        />
      )}
    </>
  );
}
