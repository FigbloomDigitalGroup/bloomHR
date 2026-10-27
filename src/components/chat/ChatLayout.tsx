import { useState, useEffect, useRef } from "react";
import { SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { ChatArea } from "./ChatArea";
import { chatService } from "./services/chatServices";
import { supabase } from "../../lib/supabase";
import toast from "react-hot-toast";
import { initialsOf, realChannelId } from "./lib/names";
import { countsAsUnread, findChat, sortDirectMessages, withIncomingChannelMessage, withIncomingDirectMessage, type IncomingMessage } from "./lib/unread";
import { canCreateChannels } from "./lib/permissions";
import { usePermissions } from "../../hooks/usePermissions";
import { isOnline, useOnlinePeople } from "./lib/presence";
import { ChatPeopleContext } from "./lib/chatPeople";
import { myReaction, withReaction } from "./lib/reactions";
import { messagePreview } from "./lib/attachments";
import type { Employee, User, Channel, DirectMessage, Message, ReactionRow } from "../chat/types/types";
import FigbloomLoader from "../UI/FigbloomLoader";
import { loadMutedChats, setChatMuted } from "../../lib/notificationPreferences";

/** `onMessagesRead` tells the staff portal a conversation was read (opened, or a message arrived in it while open). */
export function ChatLayout({ onMessagesRead }: { onMessagesRead?: (channelId: string) => void } = {}) {
  const { hasPermission } = usePermissions();
  const onlinePeople = useOnlinePeople();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [directMessages, setDirectMessages] = useState<DirectMessage[]>([]);
  const [activeChannel, setActiveChannel] = useState<Channel | DirectMessage | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  // the reactions on the open chat's messages, one row per person and emoji (live: see the reactions listener below)
  const [reactionRows, setReactionRows] = useState<ReactionRow[]>([]);
  // login id -> name, to say who reacted
  const [peopleNames, setPeopleNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  // chats muted for email (FIG-890): the bell at the top of a chat; the chat itself is unaffected
  const [mutedChats, setMutedChats] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadMutedChats().then(setMutedChats, () => undefined);
  }, []);

  const toggleMute = async (chatId: string) => {
    const id = realChannelId(chatId);
    const muted = !mutedChats.has(id);
    try {
      await setChatMuted(id, muted);
      setMutedChats((prev) => {
        const next = new Set(prev);
        if (muted) next.add(id);
        else next.delete(id);
        return next;
      });
      toast.success(muted ? "You won't get emails about this chat" : 'Emails about this chat are back on');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Not saved');
    }
  };

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
      chatService.getPeopleNames(employeesData).then(setPeopleNames, () => undefined);
      return employeesData;
    } catch (error: any) {
      console.error('❌ Error loading employees:', error);
      setError('Failed to load employee data');
      return [];
    }
  };

  // My direct messages as sidebar entries. Each chat entry "dm-<conversation id>" remembers the other person's email;
  // the name, picture and status come from that person's employee record when there is one.
  const buildDirectMessages = async (
    userChannels: (Channel | DirectMessage)[],
    people: Employee[] = employees
  ): Promise<DirectMessage[]> => {
    const dmChannels = userChannels.filter(ch => ch.id.startsWith('dm-')) as Channel[];
    const built: DirectMessage[] = await Promise.all(
      dmChannels.map(async (channel) => {
        const partnerEmail = (channel.partnerEmail || '').toLowerCase();
        const partner = people.find(emp => (emp.workEmail || '').toLowerCase() === partnerEmail);
        const lastMessage = await getLastMessageForChannel(channel.id);
        const name = partner?.fullName || channel.partnerName || partnerEmail.split('@')[0] || 'Colleague';
        return {
          id: channel.id,
          name,
          type: 'direct_message',
          avatar: partner?.profileImage || channel.partnerAvatar || '',
          initials: partner?.initials || initialsOf(name),
          status: 'offline',
          userId: partner?.id || partnerEmail,
          email: partnerEmail,
          unread_count: channel.unread_count,
          lastMessage: lastMessage ? messagePreview(lastMessage) : undefined,
          lastMessageTime: lastMessage?.timestamp,
          hasMessages: !!lastMessage
        } as DirectMessage;
      })
    );

    // conversations with messages first, then by last message time
    return sortDirectMessages(built);
  };

  const loadUserChannels = async (userId: string) => {
    try {
      console.log("📡 Loading user channels...");
      setError(null);
      const userChannels = await chatService.getUserChannels(userId);
      console.log("✅ Loaded channels:", userChannels.length);
      setChannels(userChannels as Channel[]);
      setDirectMessages(await buildDirectMessages(userChannels));

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
        .eq('channel_id', channelId.replace(/^dm-/, ''))
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
        reactions: [],
        attachments: data.attachments || []
      };
    } catch (error) {
      console.error('Error getting last message:', error);
      return null;
    }
  };

  // the chat whose messages are on screen, so a slow load for a chat I already left doesn't replace them
  const loadingChatRef = useRef<string | null>(null);

  const loadMessages = async (channelId: string) => {
    try {
      console.log("📨 Loading messages for channel:", channelId);
      loadingChatRef.current = channelId;
      const channelMessages = await chatService.getChannelMessages(channelId);
      if (loadingChatRef.current !== channelId) return;
      console.log("✅ Loaded messages:", channelMessages.length);
      setMessages(channelMessages);
      setReactionRows([]);
      chatService.getReactions(channelMessages.map(m => m.id)).then(rows => {
        if (loadingChatRef.current === channelId) setReactionRows(rows);
      });

      // Update DM activity status when messages are loaded
      if (channelId.startsWith('dm-')) {
        setDirectMessages(prev =>
          prev.map(dm =>
            dm.id === channelId
              ? {
                  ...dm,
                  hasMessages: channelMessages.length > 1, // More than just welcome message
                  lastMessage: channelMessages.length ? messagePreview(channelMessages[channelMessages.length - 1]) : undefined,
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

  // Sends the text with any files (uploaded first, into the chat's own folder) and the message it replies to.
  // Returns whether it was sent, so the box keeps the draft when it wasn't.
  const handleSendMessage = async (content: string, files: File[] = [], replyTo?: Message | null): Promise<boolean> => {
    if (!activeChannel || (!content.trim() && files.length === 0) || !currentUser) {
      console.log("❌ Cannot send message - missing requirements");
      return false;
    }

    let attachments: Awaited<ReturnType<typeof chatService.uploadAttachments>> = [];
    try {
      console.log("💬 Sending message...");
      if (files.length > 0) attachments = await chatService.uploadAttachments(activeChannel.id, files);
      const newMessage = await chatService.sendMessage(activeChannel.id, currentUser.id, content, {
        replyTo: replyTo?.id,
        attachments,
      });

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
        chatService.markMessagesAsRead(activeChannel.id, currentUser.id).catch(err =>
          console.error('Error marking own message as read:', err)
        );

        // Update DM activity status when a message is sent
        if (activeChannel.id.startsWith('dm-')) {
          setDirectMessages(prev =>
            prev.map(dm =>
              dm.id === activeChannel.id
                ? {
                    ...dm,
                    hasMessages: true,
                    lastMessage: messagePreview(newMessage),
                    lastMessageTime: newMessage.timestamp
                  }
                : dm
            )
          );
        }

        console.log("✅ Message sent successfully");
      }
      return true;
    } catch (error: any) {
      console.error('❌ Error sending message:', error);
      // the files went up but the message didn't: take them away again rather than leave files nobody can see
      if (attachments.length) void chatService.removeFiles(attachments);
      // a message that didn't go is said where it happened; the draft stays in the box to try again
      toast.error(error?.message || 'The message could not be sent');
      return false;
    }
  };

  // Adds my reaction, or takes it back when I already chose that emoji. Shown at once; the realtime echo is ignored.
  const handleReact = async (messageId: string, emoji: string) => {
    if (!currentUser) return;
    const existing = myReaction(reactionRows, messageId, emoji, currentUser.id);
    try {
      const { added, removedId } = await chatService.toggleReaction(messageId, emoji, currentUser.id, existing);
      if (added) setReactionRows(prev => withReaction(prev, added));
      if (removedId) setReactionRows(prev => prev.filter(r => r.id !== removedId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not react to the message');
    }
  };

  const handleEditMessage = async (messageId: string, content: string): Promise<boolean> => {
    try {
      const updated = await chatService.editMessage(messageId, content);
      setMessages(prev => prev.map(m => (m.id === messageId ? { ...m, content: updated.content, isEdited: true } : m)));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The message could not be changed');
      return false;
    }
  };

  const handleDeleteMessage = async (message: Message) => {
    try {
      await chatService.deleteMessage(message);
      // a reply to it keeps its place, without the quote (the database empties reply_to)
      setMessages(prev => prev.filter(m => m.id !== message.id).map(m => (m.replyTo === message.id ? { ...m, replyTo: null } : m)));
      setReactionRows(prev => prev.filter(r => r.messageId !== message.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The message could not be deleted');
    }
  };

  const handleChannelCreate = async (name: string, isPrivate: boolean = false, jobTitle?: string, inviteeIds: string[] = []) => {
    if (!currentUser) {
      setError('You must be logged in to create a channel');
      throw new Error('You must be logged in to create a channel');
    }

    try {
      console.log("🆕 Creating channel:", name, "isPrivate:", isPrivate, "jobTitle:", jobTitle);
      const newChannel = await chatService.createChannel(name, currentUser.id, isPrivate, jobTitle);

      // the people chosen in the dialog; the channel exists either way, so a failure here is a message, not an undo
      if (inviteeIds.length > 0) {
        try {
          const added = await chatService.addChannelMembers(newChannel.id, inviteeIds);
          toast.success(added === 1 ? 'Added 1 person to the channel' : `Added ${added} people to the channel`);
        } catch (inviteError: any) {
          toast.error(`The channel was created, but people could not be added: ${inviteError?.message || 'unknown error'}`);
        }
      }

      // Add the new channel to state immediately
      setChannels(prev => [...prev, newChannel]);

      // Select the new channel
      setActiveChannel(newChannel);
      await loadMessages(newChannel.id);

      console.log("✅ Channel created successfully:", newChannel.id);
    } catch (error: any) {
      console.error('❌ Error creating channel:', error);
      toast.error(
        /row-level security/i.test(error?.message || '')
          ? 'Your role cannot create channels.'
          : error?.message || 'Failed to create channel'
      );
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
        onMessagesRead?.(channel.id);
      } catch (error) {
        console.error('Error marking messages as read:', error);
      }
    }
  };

  // Starts (or reopens) the private conversation with a colleague. It is stored, so the other person receives it.
const handleDMCreate = async (userId: string) => {
  if (!currentUser) return;

  const target = employees.find(emp => emp.id === userId);
  if (!target) {
    console.error('❌ Target employee not found');
    return;
  }

  try {
    const conversationId = await chatService.startDirectMessage(target.workEmail);

    const dm: DirectMessage = {
      id: conversationId,
      name: target.fullName,
      type: 'direct_message',
      avatar: target.profileImage || '',
      initials: target.initials,
      status: target.status,
      userId: userId,
      email: target.workEmail,
      unread_count: 0
    };

    setDirectMessages(prev => (prev.some(existing => existing.id === dm.id) ? prev : [...prev, dm]));
    setActiveChannel(dm);
    await loadMessages(dm.id);
  } catch (error: any) {
    console.error('❌ Error creating DM:', error);
    toast.error(error?.message || 'Could not start the conversation');
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

  // online = has the app open right now (see lib/presence)
  const statusOf = (email?: string | null): 'online' | 'offline' => (isOnline(onlinePeople, email) ? 'online' : 'offline');
  const liveEmployees = employees.map(emp => ({ ...emp, status: statusOf(emp.workEmail) }));
  const liveDirectMessages = directMessages.map(dm => ({ ...dm, status: statusOf(dm.email) }));
  const liveActiveChannel = activeChannel?.type === 'direct_message'
    ? { ...activeChannel, status: statusOf(activeChannel.email) }
    : activeChannel;

  const getUsersForSidebar = (): User[] => {
    return liveEmployees
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
      if (currentUser) {
        chatService.markMessagesAsRead(activeChannel.id, currentUser.id)
          .then(() => onMessagesRead?.(activeChannel.id))
          .catch(err => console.error('Error marking incoming message as read:', err));
      }

      // Update DM activity status for real-time messages
      if (activeChannel.id.startsWith('dm-')) {
        setDirectMessages(prev =>
          prev.map(dm =>
            dm.id === activeChannel.id
              ? {
                  ...dm,
                  hasMessages: true,
                  lastMessage: messagePreview(newMessage),
                  lastMessageTime: newMessage.timestamp
                }
              : dm
          )
        );
      }
    }, {
      // someone edited their message: new text, same place (the author, files and reply don't change)
      onUpdate: (updated) => {
        setMessages(prev => prev.map(m => (m.id === updated.id ? { ...m, content: updated.content, isEdited: updated.isEdited } : m)));
      },
      // someone deleted theirs: it goes, and replies to it lose their quote
      onDelete: (messageId) => {
        setMessages(prev =>
          prev.some(m => m.id === messageId)
            ? prev.filter(m => m.id !== messageId).map(m => (m.replyTo === messageId ? { ...m, replyTo: null } : m))
            : prev
        );
        setReactionRows(prev => prev.filter(r => r.messageId !== messageId));
      },
    });

    return () => {
      console.log("🧹 Cleaning up subscription");
      if (subscription) {
        chatService.unsubscribe(subscription);
      }
    };
  }, [activeChannel?.id, currentUser]);

  // Reactions, live: anyone in the open chat reacting (or taking a reaction back) shows for everyone at once. Only the
  // open chat's messages are kept; the policies make sure I only hear about chats I can read.
  const messageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    messageIdsRef.current = new Set(messages.map(m => m.id));
  }, [messages]);
  useEffect(() => {
    if (!currentUser) return;
    const subscription = chatService.subscribeToReactions(
      (row) => {
        if (messageIdsRef.current.has(row.messageId)) setReactionRows(prev => withReaction(prev, row));
      },
      (reactionId) => setReactionRows(prev => prev.filter(r => r.id !== reactionId))
    );
    return () => {
      chatService.unsubscribe(subscription);
    };
  }, [currentUser]);

  // Refresh channels when employees are loaded (for DM partner data)
  useEffect(() => {
    if (currentUser && employees.length > 0 && channels.length > 0) {
      loadUserChannels(currentUser.id);
    }
  }, [employees.length]);

  // What the unread listener below needs to know without resubscribing: the chat that is open, and the chats listed.
  const activeChatIdRef = useRef<string | null>(null);
  const listedRef = useRef<{ channels: Channel[]; directMessages: DirectMessage[] }>({ channels: [], directMessages: [] });
  useEffect(() => {
    activeChatIdRef.current = activeChannel?.id ?? null;
  }, [activeChannel?.id]);
  useEffect(() => {
    listedRef.current = { channels, directMessages };
  }, [channels, directMessages]);

  // Live unread badges and latest direct message (FIG-817). Every company's general channel reaches everyone, so a
  // message must not make every open chat re-count every channel: the new row says which channel it is in, and that
  // channel's badge goes up by one here. Realtime only delivers messages I can read. A message in a chat that is not
  // listed (a colleague just started a conversation with me, a new channel) reloads the list, once per chat: some
  // channels I can see are not listed (e.g. an administrator sees private channels), and must not reload on every message.
  const unlistedChatsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!currentUser) return;

    const reloadSidebar = async () => {
      try {
        const fresh = await chatService.getUserChannels(currentUser.id);
        const regular = fresh.filter(ch => !ch.id.startsWith('dm-')) as Channel[];
        setChannels(regular);
        setDirectMessages(await buildDirectMessages(fresh));
      } catch (err) {
        console.error('Error refreshing channel unread counts:', err);
      }
    };

    const subscription = supabase
      .channel('chatlayout_unread_counts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const message = payload.new as IncomingMessage;
        if (!message?.channel_id) return;
        const { channels: listedChannels, directMessages: listedDms } = listedRef.current;
        if (!findChat(listedChannels, message) && !findChat(listedDms, message)) {
          if (unlistedChatsRef.current.has(message.channel_id)) return;
          unlistedChatsRef.current.add(message.channel_id);
          void reloadSidebar();
          return;
        }
        const unread = countsAsUnread(message, currentUser.id, activeChatIdRef.current);
        setChannels(prev => withIncomingChannelMessage(prev, message, unread));
        setDirectMessages(prev => withIncomingDirectMessage(prev, message, unread));
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

  const people = {
    employees: liveEmployees,
    currentEmail: currentUser.email,
    onMessage: handleDMCreate,
    // opening someone's employee record is the Employees module (every role but Staff by default)
    canViewRecords: hasPermission('employees'),
  };

  return (
    <ChatPeopleContext.Provider value={people}>
    <SidebarProvider className="h-full">
      <div className="flex h-full w-full bg-background">
        <AppSidebar
          channels={channels.filter(ch => !ch.id.startsWith('dm-'))}
          directMessages={liveDirectMessages}
          activeChannel={liveActiveChannel}
          onChannelSelect={handleChannelSelect}
          onChannelCreate={handleChannelCreate}
          canCreateChannels={canCreateChannels(hasPermission)}
          onDMCreate={handleDMCreate}
          currentUser={getSafeUserData()}
          users={getUsersForSidebar()}
        />
        {liveActiveChannel ? (
          <ChatArea
            channel={liveActiveChannel}
            messages={messages}
            currentUserId={currentUser.id}
            onSendMessage={handleSendMessage}
            onToggleMute={(channelId) => void toggleMute(channelId)}
            isMuted={mutedChats.has(realChannelId(liveActiveChannel.id))}
            employees={liveEmployees}
            reactionRows={reactionRows}
            peopleNames={peopleNames}
            onReact={(messageId, emoji) => void handleReact(messageId, emoji)}
            onEditMessage={handleEditMessage}
            onDeleteMessage={(message) => void handleDeleteMessage(message)}
          />
        ) : (
          <WelcomeScreen
            currentUser={currentUser}
            onCreateChannel={handleChannelCreate}
          />
        )}
      </div>
    </SidebarProvider>
    </ChatPeopleContext.Provider>
  );
}

// Supporting Components (same as before)
function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full bg-background items-center justify-center">
      <FigbloomLoader label={message.replace(/\.+$/, "")} />
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

export function WelcomeScreen({ currentUser, onCreateChannel }: { currentUser: User, onCreateChannel: (name: string, isPrivate?: boolean) => void }) {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* On phones the channel list is a slide-in sheet, so it needs a button to open it */}
      <div className="md:hidden h-14 flex items-center px-3 border-b border-gray-200">
        <SidebarTrigger />
      </div>
      <div className="flex-1 flex items-center justify-center overflow-y-auto">
      <div className="text-center max-w-2xl mx-auto p-5 sm:p-8">
        <div className="w-16 h-16 sm:w-24 sm:h-24 mx-auto mb-6 rounded-full bg-brand flex items-center justify-center shadow-lg">
          <span className="text-xl sm:text-2xl font-bold text-white">
            {currentUser.initials}
          </span>
        </div>
        <h1 className="text-2xl sm:text-4xl font-bold text-brand mb-4">
          Welcome to Figbloom Teams
        </h1>
        <p className="text-lg sm:text-xl text-gray-600 mb-2">
          Hello, <strong>{currentUser.name}</strong>!
        </p>
        {currentUser.employeeData && (
          <div className="inline-flex flex-wrap justify-center items-center gap-2 bg-green-tint text-brand px-4 py-2 rounded-full text-sm font-medium mb-6 shadow-sm">
            <span>{currentUser.employeeData.jobTitle}</span>
            <span>•</span>
            <span>{currentUser.employeeData.department}</span>
          </div>
        )}
        <p className="text-gray-500 mb-8 leading-relaxed text-base sm:text-lg">
          Connect with your colleagues, share ideas, and collaborate seamlessly.
          Start by creating a channel or sending a direct message.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center">
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
    </div>
  );
}