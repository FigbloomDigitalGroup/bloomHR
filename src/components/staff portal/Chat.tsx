// ChatComponent.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { v4 as uuidv4 } from '@lukeed/uuid';

// Matches the real `messages` table (see master_schema.sql / chatServices.ts,
// the admin Teams chat's data layer) - this component previously used
// entirely fictional column names (sender_id/sender_email/channel/type)
// that don't exist on the table, so every fetch/insert/realtime filter
// silently errored (FIG-577).
interface Message {
  id: string;
  content: string;
  author_id: string;
  author_name?: string;
  author_initials?: string;
  author_avatar?: string;
  channel_id: string;
  created_at: string;
  reply_to?: string;
}

interface User {
  id: string;
  email: string;
  user_metadata?: {
    name?: string;
    avatar_url?: string;
  };
}

interface Channel {
  id: string;
  name: string;
  description: string;
  is_private: boolean;
}

interface ChatComponentProps {
  // Called after marking a channel read, so a parent-level badge (the
  // "Communication" nav item's unread count in StaffPortal.tsx) can refresh
  // immediately instead of waiting for the next realtime event or reload.
  onMessagesRead?: () => void;
}

const ChatComponent = ({ onMessagesRead }: ChatComponentProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  // Was hardcoded to the string 'general' - not a real channels.id (uuid),
  // so every query against it would fail. Starts empty until real channels
  // load below, then defaults to the first one.
  const [currentChannel, setCurrentChannel] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Real channels from the `channels` table (see master_schema.sql) -
  // previously a hardcoded fictional list with slug ids like 'general'
  // that never corresponded to any real row (FIG-577).
  const [channels, setChannels] = useState<Channel[]>([]);
  // Per-channel unread counts for the sidebar list below, persisted via
  // `user_channel_states.last_read_at`. The old `getUnreadCount` filtered
  // the `messages` state array, but that only ever holds the *currently
  // active* channel's messages (see fetchMessages's query) - so it could
  // structurally never return anything but 0 for every other channel in
  // the list, which is why no channel ever showed a badge (FIG-578).
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const subscriptionRef = useRef<any>(null);

  const fetchChannels = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('channels')
        .select('id, name, description, is_private')
        .order('name');

      if (error) throw error;

      setChannels(data || []);
      setCurrentChannel(prev => prev || data?.[0]?.id || '');
    } catch (err) {
      console.error('Error fetching channels:', err);
      setError('Failed to load channels');
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Memoized functions
  const getCurrentUser = useCallback(async () => {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error) throw error;
      setCurrentUser(user);
      return user;
    } catch (error) {
      console.error('Error getting current user:', error);
      setError('Failed to load user session');
      return null;
    }
  }, []);

  // Persists to `user_channel_states` (the same table the admin chat
  // service writes to - see chatServices.ts) so both the "Communication"
  // nav badge in StaffPortal.tsx and the per-channel counts below reflect
  // reality across sessions, not client-only state that resets on refresh.
  const markChannelRead = useCallback(async (channelId: string, userId: string) => {
    try {
      const { error } = await supabase
        .from('user_channel_states')
        .upsert(
          { user_id: userId, channel_id: channelId, last_read_at: new Date().toISOString() },
          { onConflict: 'user_id,channel_id' }
        );
      if (error) throw error;
      setUnreadByChannel(prev => ({ ...prev, [channelId]: 0 }));
      onMessagesRead?.();
    } catch (err) {
      console.error('Error marking channel read:', err);
    }
  }, [onMessagesRead]);

  // Real per-channel unread counts for the sidebar list, replacing the
  // structurally-broken client-side getUnreadCount below.
  const fetchUnreadCounts = useCallback(async (userId: string) => {
    if (channels.length === 0) return;
    try {
      const { data: readStates } = await supabase
        .from('user_channel_states')
        .select('channel_id, last_read_at')
        .eq('user_id', userId);

      const lastReadMap = new Map((readStates || []).map((r: any) => [r.channel_id, r.last_read_at]));

      const entries = await Promise.all(channels.map(async (ch) => {
        const lastRead = lastReadMap.get(ch.id);
        let query = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('channel_id', ch.id);
        if (lastRead) query = query.gt('created_at', lastRead);
        const { count } = await query;
        return [ch.id, count || 0] as const;
      }));

      setUnreadByChannel(Object.fromEntries(entries));
    } catch (err) {
      console.error('Error fetching per-channel unread counts:', err);
    }
  }, [channels]);

  const fetchMessages = useCallback(async () => {
    if (!currentChannel) return;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', currentChannel)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) throw error;
      
      setMessages(data || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
      setError('Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [currentChannel]);

  const setupRealtimeSubscription = useCallback(() => {
    // Clean up existing subscription
    if (subscriptionRef.current) {
      supabase.removeChannel(subscriptionRef.current);
    }

    subscriptionRef.current = supabase
      .channel(`messages:${currentChannel}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${currentChannel}`
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages(prev => [...prev, newMessage]);

          // Persist read-state: this arrived for the channel currently
          // being viewed, so it shouldn't count toward the unread badge.
          if (currentUser) {
            markChannelRead(currentChannel, currentUser.id);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `channel_id=eq.${currentChannel}`
        },
        (payload) => {
          setMessages(prev => prev.filter(msg => msg.id !== payload.old.id));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Subscribed to channel: ${currentChannel}`);
        }
      });

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [currentChannel, currentUser, markChannelRead]);

  // Effects
  useEffect(() => {
    getCurrentUser();
  }, [getCurrentUser]);

  useEffect(() => {
    if (currentUser && currentChannel) {
      fetchMessages();
      markChannelRead(currentChannel, currentUser.id);
      const cleanup = setupRealtimeSubscription();
      return cleanup;
    }
  }, [currentChannel, currentUser, fetchMessages, markChannelRead, setupRealtimeSubscription]);

  // Per-channel sidebar badges: initial load once channels + user are ready,
  // then live updates via an unfiltered subscription (a message landing in
  // any channel, not just the active one, can change another channel's
  // count).
  useEffect(() => {
    if (!currentUser || channels.length === 0) return;
    fetchUnreadCounts(currentUser.id);

    const subscription = supabase
      .channel('staffchat_unread_counts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        fetchUnreadCounts(currentUser.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [currentUser, channels, fetchUnreadCounts]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Event handlers
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim() || !currentUser || isSending) return;

    const messageContent = newMessage.trim();
    const tempId = uuidv4();
    
    setIsSending(true);
    setError(null);

    const authorName = currentUser.user_metadata?.name || currentUser.email;
    const authorInitials = getInitials(currentUser.email);

    // Optimistic update
    const optimisticMessage: Message = {
      id: tempId,
      content: messageContent,
      author_id: currentUser.id,
      author_name: authorName,
      author_initials: authorInitials,
      channel_id: currentChannel,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, optimisticMessage]);
    setNewMessage('');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const { error } = await supabase
        .from('messages')
        .insert([{
          content: messageContent,
          author_id: currentUser.id,
          author_name: authorName,
          author_initials: authorInitials,
          channel_id: currentChannel,
          created_at: new Date().toISOString()
        }]);

      if (error) throw error;

      // Replace optimistic message with real one
      setMessages(prev => prev.filter(msg => msg.id !== tempId));

    } catch (error) {
      console.error('Error sending message:', error);
      setError('Failed to send message');
      
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== tempId));
      setNewMessage(messageContent); // Restore message
    } finally {
      setIsSending(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewMessage(e.target.value);
    
    // Auto-resize
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }

    // Typing indicators (simplified)
    clearTimeout(typingTimeoutRef.current);
    // In a real app, you'd send typing events to other users here
    typingTimeoutRef.current = setTimeout(() => {
      // Clear typing indicator
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  const formatMessageTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffInMinutes < 1) return 'Now';
    if (diffInMinutes < 60) return `${diffInMinutes}m`;
    if (diffInMinutes < 1440) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getInitials = (email: string) => {
    return email?.charAt(0).toUpperCase() || 'U';
  };

  const getAvatarColor = (email: string) => {
    const colors = [
      'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-red-500',
      'bg-yellow-500', 'bg-indigo-500', 'bg-pink-500', 'bg-teal-500'
    ];
    const index = email?.length % colors.length || 0;
    return colors[index];
  };

  const currentChannelData = channels.find(ch => ch.id === currentChannel);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - Teams Style */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        {/* Team Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-brand to-brand-dark rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg">T</span>
            </div>
            <div>
              <h1 className="font-semibold text-gray-900">Tech Team</h1>
              <p className="text-sm text-gray-500">Staff Chat</p>
            </div>
          </div>
        </div>

        {/* Channels */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="px-3 py-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Channels
            </h3>
            {channels.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-500">
                No channels yet. An administrator or manager creates them in Teams, and they will appear here.
              </p>
            )}
            <div className="space-y-1">
              {channels.map((channel) => {
                const unreadCount = unreadByChannel[channel.id] || 0;
                return (
                  <button
                    key={channel.id}
                    onClick={() => setCurrentChannel(channel.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                      currentChannel === channel.id
                        ? 'bg-green-tint text-brand'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">#</span>
                      <span className="font-medium">{channel.name}</span>
                    </div>
                    {unreadCount > 0 && (
                      <span className="bg-orange text-white text-xs px-2 py-1 rounded-full min-w-5 flex items-center justify-center">
                        {unreadCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* User Profile */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center space-x-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${getAvatarColor(currentUser?.email || '')}`}>
              {getInitials(currentUser?.email || '')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {currentUser?.user_metadata?.name || currentUser?.email}
              </p>
              <p className="text-xs text-gray-500 truncate">Online</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <span className="text-2xl text-gray-400">#</span>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {currentChannelData?.name}
                </h2>
                <p className="text-sm text-gray-500">
                  {currentChannelData?.description}
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>
              <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div 
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto bg-gray-50 p-6"
        >
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : error ? (
            <div className="flex justify-center items-center h-32">
              <div className="text-status-danger text-center">
                <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p>{error}</p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-lg font-medium text-gray-900">No messages yet</p>
              <p className="text-sm">Be the first to start the conversation!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => {
                const isCurrentUser = message.author_id === currentUser?.id;
                const showAvatar = index === 0 || messages[index - 1]?.author_id !== message.author_id;
                const showTimestamp = index === 0 || 
                  new Date(message.created_at).getTime() - new Date(messages[index - 1].created_at).getTime() > 300000; // 5 minutes

                return (
                  <div key={message.id}>
                    {/* Timestamp separator */}
                    {showTimestamp && (
                      <div className="flex justify-center my-6">
                        <span className="bg-gray-200 text-gray-600 text-xs px-3 py-1 rounded-full">
                          {new Date(message.created_at).toLocaleDateString([], { 
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </span>
                      </div>
                    )}

                    <div className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'} group`}>
                      <div className={`flex max-w-[70%] ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'}`}>
                        
                        {/* Avatar */}
                        {showAvatar && (
                          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${getAvatarColor(message.author_id)} ${
                            isCurrentUser ? 'ml-3' : 'mr-3'
                          }`}>
                            {message.author_initials || getInitials(message.author_name || '')}
                          </div>
                        )}
                        
                        {/* Spacer for consecutive messages from same user */}
                        {!showAvatar && (
                          <div className={`w-8 ${isCurrentUser ? 'ml-3' : 'mr-3'}`} />
                        )}

                        {/* Message Content */}
                        <div className={`flex-1 ${isCurrentUser ? 'text-right' : 'text-left'}`}>
                          {showAvatar && !isCurrentUser && (
                            <div className="flex items-center space-x-2 mb-1">
                              <span className="text-sm font-semibold text-gray-900">
                                {message.author_name || 'Unknown'}
                              </span>
                              <span className="text-xs text-gray-500">
                                {formatMessageTime(message.created_at)}
                              </span>
                            </div>
                          )}
                          
                          <div className={`relative rounded-2xl px-4 py-2 ${
                            isCurrentUser
                              ? 'bg-primary text-white rounded-br-md'
                              : 'bg-white text-gray-900 rounded-bl-md border border-gray-200'
                          }`}>
                            <div className="text-sm whitespace-pre-wrap break-words">
                              {message.content}
                            </div>
                          </div>

                          {isCurrentUser && (
                            <div className="text-xs text-gray-500 mt-1">
                              {formatMessageTime(message.created_at)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Message Input */}
        <div className="bg-white border-t border-gray-200 p-4">
          <form onSubmit={handleSendMessage} className="flex space-x-4">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={newMessage}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder={currentChannelData ? `Message #${currentChannelData.name}` : 'Select a channel to start chatting'}
                rows={1}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none bg-white placeholder-gray-500"
                style={{ minHeight: '44px', maxHeight: '120px' }}
                disabled={isSending}
              />
              <div className="absolute right-2 bottom-2 flex space-x-1">
                <button
                  type="button"
                  className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                  title="Add emoji"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                  title="Attach file"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={!newMessage.trim() || isSending}
              className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center min-w-[80px]"
            >
              {isSending ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatComponent;