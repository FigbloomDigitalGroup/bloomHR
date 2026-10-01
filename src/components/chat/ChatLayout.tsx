import { useState, useEffect } from "react";
import { SidebarProvider } from "./ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ChatArea } from "./ChatArea";
import { chatService } from "./services/chatServices";
import { supabase } from "../../lib/supabase";
import type { Employee, User, Channel, DirectMessage, Message } from "../chat/types/types";

export function ChatLayout() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | DirectMessage | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const initializeApp = async () => {
      try {
        console.log("🔐 ChatLayout: Initializing application...");
        
        // Initialize database first
        await chatService.initialize();
        
        // Get current user
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        if (userError || !user) {
          console.warn('User not authenticated');
          setAuthLoading(false);
          setLoading(false);
          setError('Please sign in to access the chat');
          return;
        }

        console.log("✅ User authenticated:", user.email);

        // Load employees data first and get the returned data
        const employeesData = await loadEmployeesData();
        
        // Find current user in employees using the returned data
        const employeeData = employeesData.find(emp => 
          emp.workEmail?.toLowerCase() === user.email?.toLowerCase()
        );

        if (!employeeData) {
          console.warn('Current user not found in employees table');
        }

        const userData: User = {
          id: user.id,
          name: employeeData ? 
            `${employeeData.firstName} ${employeeData.lastName}`.trim() : 
            user.user_metadata?.name || user.email?.split('@')[0] || 'User',
          avatar: employeeData?.profileImage || 
            user.user_metadata?.avatar || 
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`,
          initials: employeeData ? 
            `${employeeData.firstName?.[0] || ''}${employeeData.lastName?.[0] || ''}`.toUpperCase() :
            user.user_metadata?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || 'U',
          email: user.email || '',
          status: 'online',
          employeeData: employeeData || undefined
        };

        setCurrentUser(userData);
        console.log("✅ Current user set:", userData.name);
        
        // Load user channels and messages
        await loadUserChannels(user.id);

      } catch (error: any) {
        console.error('❌ ChatLayout: Error initializing app:', error);
        setError(error.message || 'Failed to initialize chat');
        setLoading(false);
        setAuthLoading(false);
      }
    };

    initializeApp();
  }, []);

  const loadEmployeesData = async (): Promise<Employee[]> => {
    try {
      console.log("👥 Loading employees data...");
      const employeesData = await chatService.getEmployees();
      console.log("✅ Employees loaded:", employeesData.length);
      setEmployees(employeesData);
      return employeesData;
    } catch (error: any) {
      console.error('❌ Error loading employees:', error);
      setError('Failed to load employee data');
      return [];
    }
  };

  const loadUserChannels = async (userId: string) => {
    try {
      console.log("📡 Loading user channels...");
      setError(null);
      const userChannels = await chatService.getUserChannels(userId);
      console.log("✅ Loaded channels:", userChannels.length);
      const dmChannels = userChannels.filter(ch => ch.id.startsWith('dm-')) as Channel[];
      
      setChannels(userChannels);
      
      // Convert DM channels to DirectMessage objects for sidebar
      const dmMessages: DirectMessage[] = await Promise.all(
        dmChannels.map(async (channel) => {
          // Extract the other user's ID from DM channel ID (format: dm-user1-user2)
          const userIds = channel.id.split('-').slice(1);
          const otherUserId = userIds.find(id => id !== userId) || '';
          
          // Find the employee data for the DM partner
          const dmPartner = employees.find(emp => emp.id === otherUserId);
          
          // Get last message for this DM to show activity
          const lastMessage = await getLastMessageForChannel(channel.id);
          
          return {
            id: channel.id,
            name: dmPartner?.fullName || channel.name.replace('DM with ', ''),
            type: 'direct_message',
            avatar: dmPartner?.profileImage || '',
            initials: dmPartner?.initials || channel.name.split(' ').map(n => n[0]).join('').slice(0, 2),
            status: dmPartner?.status || 'online',
            userId: otherUserId,
            unread_count: channel.unread_count,
            lastMessage: lastMessage?.content,
            lastMessageTime: lastMessage?.timestamp,
            hasMessages: !!lastMessage // Flag to indicate this is an active conversation
          };
        })
      );

      // Sort DMs: ones with messages first, then by last message time
      const sortedDMs = dmMessages.sort((a, b) => {
        if (a.hasMessages && !b.hasMessages) return -1;
        if (!a.hasMessages && b.hasMessages) return 1;
        if (a.lastMessageTime && b.lastMessageTime) {
          return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
        }
        return a.name.localeCompare(b.name);
      });

      setDirectMessages(sortedDMs);
      
      if (userChannels.length > 0) {
        setActiveChannel(userChannels[0]);
        await loadMessages(userChannels[0].id);
      } else {
        console.log("ℹ️ No channels found for user");
      }
    } catch (error: any) {
      console.error('❌ Error loading channels:', error);
      setError(error.message || 'Failed to load channels');
    } finally {
      setLoading(false);
      setAuthLoading(false);
    }
  };

  // Helper function to get last message for a channel
  const getLastMessageForChannel = async (channelId: string): Promise<Message | null> => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        content: data.content,
        author: {
          id: data.author_id,
          name: data.author_name || 'Unknown User',
          avatar: data.author_avatar || '',
          initials: data.author_initials || 'UU',
          email: '',
          status: 'online',
          town: data.author_town || 'Unknown'
        },
        timestamp: data.created_at,
        reactions: data.reactions || []
      };
    } catch (error) {
      console.error('Error getting last message:', error);
      return null;
    }
  };

  const loadMessages = async (channelId: string) => {
    try {
      console.log("📨 Loading messages for channel:", channelId);
      const channelMessages = await chatService.getChannelMessages(channelId);
      console.log("✅ Loaded messages:", channelMessages.length);
      setMessages(channelMessages);

      // Update DM activity status when messages are loaded
      if (channelId.startsWith('dm-')) {
        setDirectMessages(prev => 
          prev.map(dm => 
            dm.id === channelId 
              ? { 
                  ...dm, 
                  hasMessages: channelMessages.length > 1, // More than just welcome message
                  lastMessage: channelMessages[channelMessages.length - 1]?.content,
                  lastMessageTime: channelMessages[channelMessages.length - 1]?.timestamp
                }
              : dm
          )
        );
      }
    } catch (error: any) {
      console.error('❌ Error loading messages:', error);
      setError(error.message || 'Failed to load messages');
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!activeChannel || !content.trim() || !currentUser) {
      console.log("❌ Cannot send message - missing requirements");
      return;
    }
    
    try {
      console.log("💬 Sending message...");
      const newMessage = await chatService.sendMessage(activeChannel.id, currentUser.id, content);

      if (newMessage) {
        // Now that realtime is actually enabled (see chat_realtime.sql),
        // the subscription below also delivers this same row back to its
        // own sender - dedupe by id in both places so it doesn't appear
        // twice, which is exactly what surfaced this once realtime started
        // working.
        setMessages(prev => prev.some(m => m.id === newMessage.id) ? prev : [...prev, newMessage]);

        // Sending a message doesn't count as "unread" for the sender, but
        // last_read_at only otherwise updates on channel *switch*
        // (handleChannelSelect) - without this, the broader unread-count
        // subscription below would immediately flag your own just-sent
        // message as unread in the channel you're actively looking at.
        if (!activeChannel.id.startsWith('dm-')) {
          chatService.markMessagesAsRead(activeChannel.id, currentUser.id).catch(err =>
            console.error('Error marking own message as read:', err)
          );
        }

        // Update DM activity status when a message is sent
        if (activeChannel.id.startsWith('dm-')) {
          setDirectMessages(prev => 
            prev.map(dm => 
              dm.id === activeChannel.id 
                ? { 
                    ...dm, 
                    hasMessages: true,
                    lastMessage: newMessage.content,
                    lastMessageTime: newMessage.timestamp
                  }
                : dm
            )
          );
        }
        
        console.log("✅ Message sent successfully");
      }
    } catch (error: any) {
      console.error('❌ Error sending message:', error);
      setError(error.message || 'Failed to send message');
    }
  };

  const handleChannelCreate = async (name: string, isPrivate: boolean = false, jobTitle?: string) => {
    if (!currentUser) {
      setError('You must be logged in to create a channel');
      throw new Error('You must be logged in to create a channel');
    }

    try {
      console.log("🆕 Creating channel:", name, "isPrivate:", isPrivate, "jobTitle:", jobTitle);
      const newChannel = await chatService.createChannel(name, currentUser.id, isPrivate, jobTitle);
      
      // Add the new channel to state immediately
      setChannels(prev => [...prev, newChannel]);
      
      // Select the new channel
      setActiveChannel(newChannel);
      await loadMessages(newChannel.id);
      
      console.log("✅ Channel created successfully:", newChannel.id);
    } catch (error: any) {
      console.error('❌ Error creating channel:', error);
      setError(error.message || 'Failed to create channel');
      throw error;
    }
  };

  const handleChannelSelect = async (channel: Channel | DirectMessage) => {
    console.log("🎯 Channel selected:", channel.name);
    setActiveChannel(channel);
    await loadMessages(channel.id);
    
    if (currentUser) {
      try {
        await chatService.markMessagesAsRead(channel.id, currentUser.id);
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    }
  };

  // In ChatLayout.tsx - Update the handleDMCreate function
// In ChatLayout.tsx - Replace the handleDMCreate function
const handleDMCreate = async (userId: string) => {
  if (!currentUser) return;

  try {
    console.log("💬 Creating DM with user:", userId);
    
    // Find the target employee
    const targetEmployee = employees.find(emp => emp.id === userId);
    if (!targetEmployee) {
      console.error('❌ Target employee not found');
      return;
    }

    // Create simple DM object
    const newDM: DirectMessage = {
      id: `dm-${currentUser.id}-${userId}`,
      name: targetEmployee.fullName,
      type: 'direct_message',
      avatar: targetEmployee.profileImage || '',
      initials: targetEmployee.initials,
      status: targetEmployee.status,
      userId: userId,
      unread_count: 0
    };

    // Add to directMessages list
    setDirectMessages(prev => {
      const existingDM = prev.find(dm => dm.id === newDM.id);
      if (!existingDM) {
        return [...prev, newDM];
      }
      return prev;
    });

    // Select the DM channel
    setActiveChannel(newDM);
    
    // Load welcome message for DM
    setMessages([
      {
        id: 'welcome-' + newDM.id,
        content: `You started a conversation with ${targetEmployee.fullName}. Send a message to begin chatting! 👋`,
        author: {
          id: 'system',
          name: 'Figbloom Teams',
          avatar: '',
          initials: 'FT',
          email: 'system@figbloomteams.com',
          status: 'online'
        },
        timestamp: new Date().toISOString(),
        reactions: []
      }
    ]);

    console.log("✅ DM created successfully");

  } catch (error: any) {
    console.error('❌ Error creating DM:', error);
  }
};

// Also update the getUsersForSidebar function
// const getUsersForSidebar = (): User[] => {
//   return employees
//     .filter(emp => {
//       // Exclude current user
//       if (!currentUser?.employeeData) return true;
//       return emp.id !== currentUser.employeeData.id;
//     })
//     .map(emp => ({
//       id: emp.id,
//       name: emp.fullName,
//       avatar: emp.profileImage || `https://api.dicebear.com/7.x/avataaars/svg?seed=${emp.employeeNumber}`,
//       initials: emp.initials,
//       email: emp.workEmail,
//       status: emp.status,
//       employeeData: emp
//     }));
// };

  const getSafeUserData = (): User => {
    if (!currentUser) {
      return {
        id: 'unknown',
        name: 'User',
        avatar: '',
        initials: 'U',
        email: '',
        status: 'offline'
      };
    }
    return currentUser;
  };

  const getUsersForSidebar = (): User[] => {
    return employees
      .filter(emp => {
        // Exclude current user
        if (!currentUser?.employeeData) return true;
        return emp.id !== currentUser.id;
      })
      .map(emp => ({
        id: emp.id,
        name: emp.fullName,
        avatar: emp.profileImage || `https://api.dicebear.com/7.x/avataaars/svg?seed=${emp.employeeNumber}`,
        initials: emp.initials,
        email: emp.workEmail,
        status: emp.status,
        employeeData: emp
      }));
  };

  // Real-time messages subscription
  useEffect(() => {
    if (!activeChannel) return;

    console.log("🔔 Setting up real-time subscription for:", activeChannel.name);
    const subscription = chatService.subscribeToMessages(activeChannel.id, (newMessage) => {
      console.log("📨 New real-time message received");
      setMessages(prev => prev.some(m => m.id === newMessage.id) ? prev : [...prev, newMessage]);

      // Someone else's message arriving while this channel is already open
      // shouldn't show as unread either - the channel is actively being
      // viewed, same reasoning as the sender's own case in handleSendMessage.
      if (currentUser && !activeChannel.id.startsWith('dm-')) {
        chatService.markMessagesAsRead(activeChannel.id, currentUser.id).catch(err =>
          console.error('Error marking incoming message as read:', err)
        );
      }

      // Update DM activity status for real-time messages
      if (activeChannel.id.startsWith('dm-')) {
        setDirectMessages(prev => 
          prev.map(dm => 
            dm.id === activeChannel.id 
              ? { 
                  ...dm, 
                  hasMessages: true,
                  lastMessage: newMessage.content,
                  lastMessageTime: newMessage.timestamp
                }
              : dm
          )
        );
      }
    });

    return () => {
      console.log("🧹 Cleaning up subscription");
      if (subscription) {
        chatService.unsubscribe(subscription);
      }
    };
  }, [activeChannel?.id, currentUser]);

  // Refresh channels when employees are loaded (for DM partner data)
  useEffect(() => {
    if (currentUser && employees.length > 0 && channels.length > 0) {
      loadUserChannels(currentUser.id);
    }
  }, [employees.length]);

  // Live per-channel unread badge updates (see getUnreadCountsByChannel in
  // chatServices.ts - unread_count was always hardcoded to 0 until now).
  // A message arriving in a channel other than the active one only shows up
  // here, not in the per-active-channel subscription above, so this needs
  // its own unscoped listener.
  useEffect(() => {
    if (!currentUser) return;

    const subscription = supabase
      .channel('chatlayout_unread_counts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async () => {
        try {
          const fresh = await chatService.getUserChannels(currentUser.id);
          const regular = fresh.filter(ch => !ch.id.startsWith('dm-')) as Channel[];
          setChannels(regular);
        } catch (err) {
          console.error('Error refreshing channel unread counts:', err);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [currentUser]);

  // Loading states
  if (authLoading) {
    return <LoadingScreen message="Checking authentication..." />;
  }

  if (loading) {
    return <LoadingScreen message="Loading chat..." />;
  }

  if (!currentUser) {
    return <SignInScreen />;
  }

  if (error) {
    return <ErrorScreen error={error} onRetry={() => loadUserChannels(currentUser.id)} />;
  }

  return (
    <SidebarProvider className="h-full">
      <div className="flex h-full w-full bg-background">
        <AppSidebar 
          channels={channels.filter(ch => !ch.id.startsWith('dm-'))}
          directMessages={directMessages}
          activeChannel={activeChannel}
          onChannelSelect={handleChannelSelect}
          onChannelCreate={handleChannelCreate}
          onDMCreate={handleDMCreate}
          currentUser={getSafeUserData()}
          users={getUsersForSidebar()}
        />
        {activeChannel ? (
          <ChatArea 
            channel={activeChannel}
            messages={messages}
            onSendMessage={handleSendMessage}
            onToggleMute={(channelId) => {
              console.log("🔇 Toggle mute for channel:", channelId);
            }}
            employees={employees}
          />
        ) : (
          <WelcomeScreen 
            currentUser={currentUser}
            onCreateChannel={handleChannelCreate}
          />
        )}
      </div>
    </SidebarProvider>
  );
}

// Supporting Components (same as before)
function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full bg-background items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
        <p className="mt-4 text-gray-600">{message}</p>
      </div>
    </div>
  );
}

function SignInScreen() {
  return (
    <div className="flex h-full w-full bg-background items-center justify-center">
      <div className="text-center max-w-md mx-auto p-8">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-brand flex items-center justify-center">
          <span className="text-2xl font-bold text-white">F</span>
        </div>
        <h2 className="text-3xl font-bold text-brand mb-4">
          Welcome to Figbloom Teams
        </h2>
        <p className="text-gray-600 mb-6">Please sign in to access the team chat</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-brand text-white rounded-lg font-semibold hover:bg-brand-dark transition-all shadow-lg"
        >
          Sign In
        </button>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onRetry }: { error: string, onRetry: () => void }) {
  return (
    <div className="flex h-full w-full bg-background items-center justify-center">
      <div className="text-center max-w-md mx-auto p-6">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <span className="text-2xl text-red-600">⚠️</span>
        </div>
        <h3 className="text-lg font-semibold text-red-600 mb-2">Error</h3>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function WelcomeScreen({ currentUser, onCreateChannel }: { currentUser: User, onCreateChannel: (name: string, isPrivate?: boolean) => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-2xl mx-auto p-8">
        <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-brand flex items-center justify-center shadow-lg">
          <span className="text-2xl font-bold text-white">
            {currentUser.initials}
          </span>
        </div>
        <h1 className="text-4xl font-bold text-brand mb-4">
          Welcome to Figbloom Teams
        </h1>
        <p className="text-xl text-gray-600 mb-2">
          Hello, <strong>{currentUser.name}</strong>!
        </p>
        {currentUser.employeeData && (
          <div className="inline-flex items-center gap-2 bg-green-tint text-brand px-4 py-2 rounded-full text-sm font-medium mb-6 shadow-sm">
            <span>{currentUser.employeeData.jobTitle}</span>
            <span>•</span>
            <span>{currentUser.employeeData.department}</span>
          </div>
        )}
        <p className="text-gray-500 mb-8 leading-relaxed text-lg">
          Connect with your colleagues, share ideas, and collaborate seamlessly. 
          Start by creating a channel or sending a direct message.
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={() => onCreateChannel('general', false)}
            className="px-6 py-3 bg-brand text-white rounded-lg font-semibold hover:bg-brand-dark transition-all shadow-lg hover:shadow-xl"
          >
            Create General Channel
          </button>
          <button className="px-6 py-3 border border-brand text-brand rounded-lg font-semibold hover:bg-green-tint transition-all shadow-sm">
            Explore Teams
          </button>
        </div>
      </div>
    </div>
  );
}