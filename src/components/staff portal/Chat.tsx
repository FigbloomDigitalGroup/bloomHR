// ChatComponent.tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { v4 as uuidv4 } from '@lukeed/uuid';

interface Message {
  id: string;
  content: string;
  sender_id: string;
  sender_email: string;
  sender_name?: string;
  channel: string;
  created_at: string;
  type: 'text' | 'system';
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

const ChatComponent = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentChannel, setCurrentChannel] = useState('general');
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [lastReadMessages, setLastReadMessages] = useState<{[channel: string]: string}>({});
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout>();
  const subscriptionRef = useRef<any>(null);

  // Channels configuration
  const channels: Channel[] = [
    { id: 'general', name: 'General', description: 'Company-wide announcements and chat', is_private: false },
    { id: 'support', name: 'Support', description: 'Customer support discussions', is_private: false },
    { id: 'engineering', name: 'Engineering', description: 'Engineering team chat', is_private: false },
    { id: 'random', name: 'Random', description: 'Non-work banter and fun', is_private: false }
  ];

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

  const fetchMessages = useCallback(async () => {
    if (!currentChannel) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('channel', currentChannel)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) throw error;
      
      setMessages(data || []);
      
      // Mark messages as read
      if (data && data.length > 0) {
        setLastReadMessages(prev => ({
          ...prev,
          [currentChannel]: data[data.length - 1].id
        }));
      }
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
          filter: `channel=eq.${currentChannel}`
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages(prev => [...prev, newMessage]);
          
          // Auto-mark as read if user is active
          setLastReadMessages(prev => ({
            ...prev,
            [currentChannel]: newMessage.id
          }));
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `channel=eq.${currentChannel}`
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
  }, [currentChannel]);

  // Effects
  useEffect(() => {
    getCurrentUser();
  }, [getCurrentUser]);

  useEffect(() => {
    if (currentUser) {
      fetchMessages();
      const cleanup = setupRealtimeSubscription();
      return cleanup;
    }
  }, [currentChannel, currentUser, fetchMessages, setupRealtimeSubscription]);

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

    // Optimistic update
    const optimisticMessage: Message = {
      id: tempId,
      content: messageContent,
      sender_id: currentUser.id,
      sender_email: currentUser.email,
      sender_name: currentUser.user_metadata?.name,
      channel: currentChannel,
      created_at: new Date().toISOString(),
      type: 'text'
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
          sender_id: currentUser.id,
          sender_email: currentUser.email,
          channel: currentChannel,
          type: 'text',
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

  const getUnreadCount = (channelId: string) => {
    const lastReadId = lastReadMessages[channelId];
    if (!lastReadId) return messages.filter(m => m.channel === channelId).length;
    
    const lastReadIndex = messages.findIndex(m => m.id === lastReadId);
    return messages.length - lastReadIndex - 1;
  };

  const currentChannelData = channels.find(ch => ch.id === currentChannel);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - Teams Style */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        {/* Team Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
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
            <div className="space-y-1">
              {channels.map((channel) => {
                const unreadCount = getUnreadCount(channel.id);
                return (
                  <button
                    key={channel.id}
                    onClick={() => setCurrentChannel(channel.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                      currentChannel === channel.id
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">#</span>
                      <span className="font-medium">{channel.name}</span>
                    </div>
                    {unreadCount > 0 && (
                      <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full min-w-5 flex items-center justify-center">
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : error ? (
            <div className="flex justify-center items-center h-32">
              <div className="text-red-500 text-center">
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
                const isCurrentUser = message.sender_id === currentUser?.id;
                const showAvatar = index === 0 || messages[index - 1]?.sender_id !== message.sender_id;
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
                          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${getAvatarColor(message.sender_email)} ${
                            isCurrentUser ? 'ml-3' : 'mr-3'
                          }`}>
                            {getInitials(message.sender_email)}
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
                                {message.sender_name || message.sender_email}
                              </span>
                              <span className="text-xs text-gray-500">
                                {formatMessageTime(message.created_at)}
                              </span>
                            </div>
                          )}
                          
                          <div className={`relative rounded-2xl px-4 py-2 ${
                            isCurrentUser 
                              ? 'bg-blue-500 text-white rounded-br-md' 
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
                placeholder={`Message #${currentChannelData?.name}`}
                rows={1}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-white placeholder-gray-500"
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
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center min-w-[80px]"
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