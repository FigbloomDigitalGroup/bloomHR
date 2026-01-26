// ChatArea.tsx
import { Hash, MoreVertical, Search, Users, Pin, Bell, BellOff, Video, Phone, Home, User, Settings } from "lucide-react";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { useState } from "react";
import { SearchDialog } from "./SearchDialog";
import { MembersDialog } from "./MembersDialog";
import { EmployeeProfile } from "./EmployeeProfile";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import type { Channel, DirectMessage, Employee, Message } from "../chat/types/types";

interface ChatAreaProps {
  channel: Channel | DirectMessage;
  messages: Message[];
  employees: Employee[];
  onSendMessage: (content: string) => void;
  onToggleMute: (channelId: string) => void;
  isMuted?: boolean;
}

export function ChatArea({ channel, messages, onSendMessage, onToggleMute, employees = [], isMuted = false }: ChatAreaProps) {
  const [showSearch, setShowSearch] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const handleSearch = () => {
    setShowSearch(true);
  };

  const handleShowUsers = () => {
    setShowMembers(true);
  };

  const handleToggleMute = () => {
    onToggleMute(channel.id);
  };

  const handleVideoCall = () => {
    alert('Start video call functionality');
  };

  const handleVoiceCall = () => {
    alert('Start voice call functionality');
  };

  const handleNavigateHome = () => {
    window.location.href = "/";
  };

  const handleViewProfile = () => {
    alert('View profile functionality');
  };

  const handleSettings = () => {
    alert('Settings functionality');
  };

  return (
    <>
      <div className="flex-1 flex flex-col bg-white">
        {/* Enhanced Header */}
        <header className="h-16 border-b border-gray-200 flex items-center justify-between px-6 bg-white/80 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <SidebarTrigger />
            <div className="flex items-center gap-3">
              {channel.type === 'channel' ? (
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <Hash className="h-5 w-5 text-white" />
                </div>
              ) : (
                <EmployeeProfile employee={channel as any}>
                  <div className="relative cursor-pointer">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center ring-2 ring-white shadow-sm">
                      <span className="text-sm font-semibold text-white">
                        {channel.initials}
                      </span>
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${
                      channel.status === 'online' ? 'bg-green-500' :
                      channel.status === 'away' ? 'bg-yellow-500' :
                      'bg-gray-400'
                    }`}></span>
                  </div>
                </EmployeeProfile>
              )}
              <div>
                <h1 className="font-semibold text-gray-900 text-lg">
                  {channel.type === 'channel' ? `# ${channel.name}` : channel.name}
                </h1>
                {channel.type === 'channel' ? (
                  <p className="text-sm text-gray-500">
                    {employees.length} members • {channel.isPrivate ? 'Private channel' : 'Public channel'}
                  </p>
                ) : (
                  <p className="text-sm text-gray-500 capitalize">
                    {channel.status} • Direct message
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {channel.type === 'direct_message' && (
              <>
                <Button variant="ghost" size="icon" onClick={handleVoiceCall} className="text-gray-500 hover:text-blue-600 hover:bg-blue-50">
                  <Phone className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={handleVideoCall} className="text-gray-500 hover:text-blue-600 hover:bg-blue-50">
                  <Video className="h-5 w-5" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={handleToggleMute} className="text-gray-500 hover:text-orange-600 hover:bg-orange-50">
              {isMuted ? <BellOff className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSearch} className="text-gray-500 hover:text-green-600 hover:bg-green-50">
              <Search className="h-5 w-5" />
            </Button>
            {channel.type === 'channel' && (
              <Button variant="ghost" size="icon" onClick={handleShowUsers} className="text-gray-500 hover:text-purple-600 hover:bg-purple-50">
                <Users className="h-5 w-5" />
              </Button>
            )}
            
            {/* Three Dots Dropdown Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-gray-500 hover:text-gray-700 hover:bg-gray-100">
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={handleNavigateHome}>
                  <Home className="h-4 w-4 mr-2" />
                  Go to Home
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleViewProfile}>
                  <User className="h-4 w-4 mr-2" />
                  View Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSettings}>
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Messages */}
        <MessageList messages={messages} channel={channel} />

        {/* Input */}
        <MessageInput 
          channelName={channel.name}
          onSendMessage={onSendMessage}
          disabled={isMuted} 
          employees={employees}
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