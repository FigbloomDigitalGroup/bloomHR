import React, { useState } from 'react';
import { Video, Users, Settings } from 'lucide-react';

interface MeetingJoinProps {
  onJoinMeeting: (config: {
    topic: string;
    userName: string;
    userEmail: string;
  }) => void;
  isConnecting: boolean;
}

export const MeetingJoin: React.FC<MeetingJoinProps> = ({ onJoinMeeting, isConnecting }) => {
  const [topic, setTopic] = useState('');
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (topic.trim() && userName.trim()) {
      onJoinMeeting({ topic: topic.trim(), userName: userName.trim(), userEmail: userEmail.trim() });
    }
  };

  return (
    <div className="min-h-screen  flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="bg-green-600 rounded-full p-3 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <Video className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Join Meeting</h1>
          <p className="text-gray-600">Enter your details to join the video conference</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="topic" className="block text-xs font-semibold text-gray-700 mb-2">
              Meeting Topic / ID
            </label>
            <div className="relative">
              <Users className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type="text"
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Enter meeting topic or ID"
                className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                disabled={isConnecting}
              />
            </div>
          </div>

          <div>
            <label htmlFor="userName" className="block text-xs font-semibold text-gray-700 mb-2">
              Your Name
            </label>
            <input
              type="text"
              id="userName"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your display name"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              disabled={isConnecting}
            />
          </div>

          <div>
            <label htmlFor="userEmail" className="block text-xs font-semibold text-gray-700 mb-2">
              Email (Optional)
            </label>
            <input
              type="email"
              id="userEmail"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="Enter your email"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isConnecting}
            />
          </div>

          <button
            type="submit"
            disabled={isConnecting || !topic.trim() || !userName.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 flex items-center justify-center space-x-2"
          >
            {isConnecting ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Connecting...</span>
              </>
            ) : (
              <>
                <Video className="w-5 h-5" />
                <span>Join Meeting</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 pt-6 border-t border-gray-200 text-center">
          <div className="flex items-center justify-center space-x-2 text-xs text-gray-500">
            <Settings className="w-4 h-4" />
            <span>Make sure your camera and microphone are working</span>
          </div>
        </div>
      </div>
    </div>
  );
};