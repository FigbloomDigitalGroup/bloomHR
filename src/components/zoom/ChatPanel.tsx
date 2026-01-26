import React, { useState } from 'react';
import { Send, X } from 'lucide-react';
import { ChatMessage } from '../../types/zoom';

interface ChatPanelProps {
  isOpen: boolean;
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  onClose: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  isOpen,
  messages,
  onSendMessage,
  onClose
}) => {
  const [newMessage, setNewMessage] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newMessage.trim()) {
      onSendMessage(newMessage.trim());
      setNewMessage('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="bg-gray-800 border-l border-gray-700 w-80 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-white font-semibold">Chat</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-400 mt-8">
            <p>No messages yet</p>
            <p className="text-xs">Start a conversation with the participants</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="bg-gray-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-blue-400 text-xs font-medium">{message.sender}</span>
                <span className="text-gray-500 text-xs">
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
              <p className="text-white text-xs">{message.message}</p>
            </div>
          ))
        )}
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-gray-700">
        <form onSubmit={handleSubmit} className="flex space-x-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!newMessage.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
};