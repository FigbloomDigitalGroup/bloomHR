// AppSidebar.tsx
import { MessageSquare, Plus, Settings, Building2, Users, Search, Clock } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "./ui/sidebar";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { useState } from "react";
import { CreateChannelDialog } from "./CreateDialogChannel";
import { CreateDMDialog } from "./CreateDialog";
import { SettingsDialog } from "./SettingsDialog";
import { EmployeeProfile } from "./EmployeeProfile";
import type { Channel, User, DirectMessage, Employee } from "../chat/types/types";

interface AppSidebarProps {
  channels: Channel[];
  directMessages: DirectMessage[];
  activeChannel: Channel | DirectMessage | null;
  onChannelSelect: (channel: Channel | DirectMessage) => void;
  onChannelCreate: (name: string, isPrivate?: boolean) => void;
  onDMCreate: (userId: string) => void;
  currentUser: User | null;
  users: User[];
}

export function AppSidebar({ 
  channels = [], 
  directMessages = [], 
  activeChannel, 
  onChannelSelect, 
  onChannelCreate,
  onDMCreate,
  currentUser,
  users = [] 
}: AppSidebarProps) {
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateDM, setShowCreateDM] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [channelSearch, setChannelSearch] = useState("");
  const [dmSearch, setDmSearch] = useState("");

  // Safe user data with fallbacks
  const safeCurrentUser = currentUser || {
    id: 'unknown',
    name: 'User',
    avatar: '',
    initials: 'U',
    email: '',
    status: 'offline' as const
  };

  const handleAddChannel = () => {
    setShowCreateChannel(true);
  };

  const handleAddDM = () => {
    setShowCreateDM(true);
  };

  const handleSettings = () => {
    setShowSettings(true);
  };

  const handleChannelCreate = (name: string, isPrivate: boolean = false) => {
    onChannelCreate(name, isPrivate);
    setShowCreateChannel(false);
  };

  const handleDMCreate = (userId: string) => {
    onDMCreate(userId);
    setShowCreateDM(false);
  };

  // Filter channels and DMs based on search
  const filteredChannels = channels.filter(channel =>
    channel.name.toLowerCase().includes(channelSearch.toLowerCase())
  );

  // Separate DMs into active conversations and potential contacts
  const activeConversations = directMessages.filter(dm => dm.hasMessages);
  const potentialContacts = directMessages.filter(dm => !dm.hasMessages);
  
  const filteredActiveConversations = activeConversations.filter(dm =>
    dm.name.toLowerCase().includes(dmSearch.toLowerCase())
  );
  
  const filteredPotentialContacts = potentialContacts.filter(dm =>
    dm.name.toLowerCase().includes(dmSearch.toLowerCase())
  );

  // Check if channel is active safely
  const isChannelActive = (channel: Channel | DirectMessage) => {
    return activeChannel?.id === channel.id;
  };

  // Format time for last message
  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '';
    
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 168) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Generate avatar for channels
  const getChannelAvatar = (channel: Channel) => {
    const avatarUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${channel.id}&size=40`;
    
    return (
      <Avatar className="h-6 w-6 ring-2 ring-white flex-shrink-0">
        <AvatarImage src={avatarUrl} />
        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs">
          {channel.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  };

  return (
    <>
      <Sidebar className="border-r border-gray-200 bg-white/80 backdrop-blur-sm">
        <SidebarHeader className="border-b border-gray-200 p-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm">
                <img src="/solo.png" alt="ZiraTeams" className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-bold text-white text-lg">ZiraTeams</h2>
                <p className="text-xs text-blue-100">Collaboration starts here</p>
              </div>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent className="bg-transparent">
          {/* Channels Section */}
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2 text-gray-700 font-semibold">
                <Building2 className="h-4 w-4" />
                <span className="text-xs">Channels</span>
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {channels.length}
                </Badge>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 text-gray-500 hover:text-gray-700 hover:bg-gray-100" 
                onClick={handleAddChannel}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </SidebarGroupLabel>
            
            {/* Channel Search */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="Search channels..."
                  value={channelSearch}
                  onChange={(e) => setChannelSearch(e.target.value)}
                  className="pl-9 h-8 text-sm bg-gray-50 border-gray-200"
                />
              </div>
            </div>

            <SidebarGroupContent>
              <SidebarMenu>
                {filteredChannels.length > 0 ? (
                  filteredChannels.map((channel) => (
                    <SidebarMenuItem key={channel.id}>
                      <SidebarMenuButton
                        onClick={() => onChannelSelect(channel)}
                        isActive={isChannelActive(channel)}
                        className="group mx-2 rounded-lg transition-all hover:bg-blue-50 hover:border-blue-200"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Channel Avatar */}
                          {getChannelAvatar(channel)}
                          
                          <span className="flex-1 truncate font-medium text-xs">{channel.name}</span>
                          {channel.unread_count && channel.unread_count > 0 && (
                            <Badge variant="default" className="h-5 min-w-5 px-1.5 text-xs bg-blue-600">
                              {channel.unread_count > 99 ? '99+' : channel.unread_count}
                            </Badge>
                          )}
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                ) : (
                  <div className="px-4 py-3 text-center">
                    <Building2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs text-gray-500">No channels found</p>
                    {channelSearch && (
                      <p className="text-xs text-gray-400 mt-1">Try a different search</p>
                    )}
                  </div>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Direct Messages Section */}
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2 text-gray-700 font-semibold">
                <Users className="h-4 w-4" />
                <span className="text-xs">Direct Messages</span>
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {directMessages.length}
                </Badge>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-6 w-6 text-gray-500 hover:text-gray-700 hover:bg-gray-100" 
                onClick={handleAddDM}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </SidebarGroupLabel>
            
            {/* DM Search */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="Search people..."
                  value={dmSearch}
                  onChange={(e) => setDmSearch(e.target.value)}
                  className="pl-9 h-8 text-sm bg-gray-50 border-gray-200"
                />
              </div>
            </div>

            <SidebarGroupContent>
              <SidebarMenu>
                {/* Active Conversations */}
                {filteredActiveConversations.length > 0 && (
                  <>
                    <div className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500">Active Conversations</span>
                        <Badge variant="outline" className="h-4 px-1.5 text-xs">
                          {filteredActiveConversations.length}
                        </Badge>
                      </div>
                    </div>
                    {filteredActiveConversations.map((dm) => (
                      <SidebarMenuItem key={dm.id}>
                        <EmployeeProfile 
                          employee={{
                            id: dm.userId,
                            fullName: dm.name,
                            profileImage: dm.avatar,
                            initials: dm.initials,
                            status: dm.status,
                            workEmail: '',
                            jobTitle: '',
                            department: ''
                          } as any} 
                        >
                          <SidebarMenuButton
                            onClick={() => onChannelSelect(dm)}
                            isActive={isChannelActive(dm)}
                            className="group mx-2 rounded-lg transition-all hover:bg-blue-50 hover:border-blue-200"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="relative flex-shrink-0">
                                <Avatar className="h-6 w-6 ring-2 ring-white">
                                  <AvatarImage src={dm.avatar || ''} />
                                  <AvatarFallback className="bg-gradient-to-br from-green-500 to-green-600 text-white text-xs">
                                    {dm.initials || 'U'}
                                  </AvatarFallback>
                                </Avatar>
                                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 border-2 border-white rounded-full ${
                                  dm.status === 'online' ? 'bg-green-500' :
                                  dm.status === 'away' ? 'bg-yellow-500' :
                                  'bg-gray-400'
                                }`}></span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-xs text-gray-900">{dm.name}</span>
                                  {dm.lastMessageTime && (
                                    <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                                      {formatTime(dm.lastMessageTime)}
                                    </span>
                                  )}
                                </div>
                                {dm.lastMessage && (
                                  <p className="text-xs text-gray-500 truncate mt-0.5">
                                    {dm.lastMessage}
                                  </p>
                                )}
                              </div>
                              {dm.unread_count && dm.unread_count > 0 && (
                                <Badge variant="default" className="h-5 min-w-5 px-1.5 text-xs bg-green-600">
                                  {dm.unread_count > 99 ? '99+' : dm.unread_count}
                                </Badge>
                              )}
                            </div>
                          </SidebarMenuButton>
                        </EmployeeProfile>
                      </SidebarMenuItem>
                    ))}
                  </>
                )}

                {/* Potential Contacts */}
                {filteredPotentialContacts.length > 0 && (
                  <>
                    <div className="px-4 py-2 mt-2">
                      <div className="flex items-center gap-2">
                        <Users className="h-3 w-3 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500">All Contacts</span>
                        <Badge variant="outline" className="h-4 px-1.5 text-xs">
                          {filteredPotentialContacts.length}
                        </Badge>
                      </div>
                    </div>
                    {filteredPotentialContacts.map((dm) => (
                      <SidebarMenuItem key={dm.id}>
                        <EmployeeProfile 
                          employee={{
                            id: dm.userId,
                            fullName: dm.name,
                            profileImage: dm.avatar,
                            initials: dm.initials,
                            status: dm.status,
                            workEmail: '',
                            jobTitle: '',
                            department: ''
                          } as any} 
                        >
                          <SidebarMenuButton
                            onClick={() => onChannelSelect(dm)}
                            isActive={isChannelActive(dm)}
                            className="group mx-2 rounded-lg transition-all hover:bg-blue-50 hover:border-blue-200"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className="relative flex-shrink-0">
                                <Avatar className="h-6 w-6 ring-2 ring-white">
                                  <AvatarImage src={dm.avatar || ''} />
                                  <AvatarFallback className="bg-gradient-to-br from-green-500 to-green-600 text-white text-xs">
                                    {dm.initials || 'U'}
                                  </AvatarFallback>
                                </Avatar>
                                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 border-2 border-white rounded-full ${
                                  dm.status === 'online' ? 'bg-green-500' :
                                  dm.status === 'away' ? 'bg-yellow-500' :
                                  'bg-gray-400'
                                }`}></span>
                              </div>
                              <span className="flex-1 truncate font-medium text-xs">{dm.name || 'Unknown User'}</span>
                              {dm.unread_count && dm.unread_count > 0 && (
                                <Badge variant="default" className="h-5 min-w-5 px-1.5 text-xs bg-green-600">
                                  {dm.unread_count > 99 ? '99+' : dm.unread_count}
                                </Badge>
                              )}
                            </div>
                          </SidebarMenuButton>
                        </EmployeeProfile>
                      </SidebarMenuItem>
                    ))}
                  </>
                )}

                {/* No DMs Found */}
                {filteredActiveConversations.length === 0 && filteredPotentialContacts.length === 0 && (
                  <div className="px-4 py-3 text-center">
                    <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-xs text-gray-500">No direct messages</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {dmSearch ? 'Try a different search' : 'Start a conversation'}
                    </p>
                  </div>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Enhanced User Footer */}
        <SidebarFooter className="border-t border-gray-200 p-4 bg-white/50 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <EmployeeProfile employee={safeCurrentUser as any}>
                <div className="relative cursor-pointer">
                  <Avatar className="h-10 w-10 ring-2 ring-white shadow-sm">
                    <AvatarImage src={safeCurrentUser.avatar || ''} />
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white">
                      {safeCurrentUser.initials || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${
                    safeCurrentUser.status === 'online' ? 'bg-green-500' :
                    safeCurrentUser.status === 'away' ? 'bg-yellow-500' :
                    'bg-gray-400'
                  }`}></span>
                </div>
              </EmployeeProfile>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 truncate">
                  {safeCurrentUser.name || 'User'}
                </p>
                {safeCurrentUser.employeeData && (
                  <div className="flex items-center gap-1 text-xs text-gray-500 truncate">
                    <Building2 className="h-3 w-3" />
                    <span>{safeCurrentUser.employeeData.department}</span>
                    <span>•</span>
                    <span>{safeCurrentUser.employeeData.jobTitle}</span>
                  </div>
                )}
                <p className="text-xs text-gray-400 truncate">
                  {safeCurrentUser.status === 'online' ? 'Online' : 
                   safeCurrentUser.status === 'away' ? 'Away' : 'Offline'}
                </p>
              </div>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-gray-500 hover:text-gray-700 hover:bg-gray-100" 
              onClick={handleSettings}
              disabled={!currentUser}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <CreateChannelDialog
        open={showCreateChannel}
        onOpenChange={setShowCreateChannel}
        onCreateChannel={handleChannelCreate}
      />

      <CreateDMDialog
        open={showCreateDM}
        onOpenChange={setShowCreateDM}
        users={users}
        onCreateDM={handleDMCreate}
      />

      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        user={safeCurrentUser}
      />
    </>
  );
}