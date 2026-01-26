import React from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Phone,
  ScreenShare,
  MessageSquare,
  Users,
  Settings,
  MoreHorizontal
} from 'lucide-react';

interface MeetingControlsProps {
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
  participantCount: number;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onLeaveMeeting: () => void;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
}

export const MeetingControls: React.FC<MeetingControlsProps> = ({
  isAudioMuted,
  isVideoMuted,
  isScreenSharing,
  participantCount,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onLeaveMeeting,
  onToggleChat,
  onToggleParticipants
}) => {
  return (
    <div className="bg-gray-900 border-t border-gray-700 p-4">
      <div className="flex items-center justify-center space-x-4">
        {/* Audio Control */}
        <button
          onClick={onToggleAudio}
          className={`p-3 rounded-full transition-colors duration-200 ${
            isAudioMuted
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-white'
          }`}
          title={isAudioMuted ? 'Unmute' : 'Mute'}
        >
          {isAudioMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>

        {/* Video Control */}
        <button
          onClick={onToggleVideo}
          className={`p-3 rounded-full transition-colors duration-200 ${
            isVideoMuted
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-white'
          }`}
          title={isVideoMuted ? 'Start Video' : 'Stop Video'}
        >
          {isVideoMuted ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>

        {/* Screen Share Control */}
        <button
          onClick={onToggleScreenShare}
          className={`p-3 rounded-full transition-colors duration-200 ${
            isScreenSharing
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-white'
          }`}
          title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
        >
          <ScreenShare className="w-6 h-6" />
        </button>

        {/* Chat */}
        <button
          onClick={onToggleChat}
          className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 text-white transition-colors duration-200"
          title="Chat"
        >
          <MessageSquare className="w-6 h-6" />
        </button>

        {/* Participants */}
        <button
          onClick={onToggleParticipants}
          className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 text-white transition-colors duration-200 relative"
          title="Participants"
        >
          <Users className="w-6 h-6" />
          {participantCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-blue-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
              {participantCount}
            </span>
          )}
        </button>

        {/* More Options */}
        <button
          className="p-3 rounded-full bg-gray-700 hover:bg-gray-600 text-white transition-colors duration-200"
          title="More"
        >
          <MoreHorizontal className="w-6 h-6" />
        </button>

        {/* Leave Meeting */}
        <button
          onClick={onLeaveMeeting}
          className="p-3 rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors duration-200 ml-4"
          title="Leave Meeting"
        >
          <Phone className="w-6 h-6 transform rotate-135" />
        </button>
      </div>
    </div>
  );
};