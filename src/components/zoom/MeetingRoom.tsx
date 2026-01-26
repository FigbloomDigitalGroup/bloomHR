import React, { useState } from 'react';
import { VideoGallery } from './VideoGallery';
import { MeetingControls } from './MeetingControls';
import { ChatPanel } from './ChatPanel';
import { ParticipantsPanel } from './ParticipantsPanel';
import { ZoomUser, ChatMessage } from '../../types/zoom';

interface MeetingRoomProps {
  participants: ZoomUser[];
  chatMessages: ChatMessage[];
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onLeaveMeeting: () => void;
  onSendMessage: (message: string) => void;
}

export const MeetingRoom: React.FC<MeetingRoomProps> = ({
  participants,
  chatMessages,
  isAudioMuted,
  isVideoMuted,
  isScreenSharing,
  onToggleAudio,
  onToggleVideo,
  onToggleScreenShare,
  onLeaveMeeting,
  onSendMessage
}) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);

  return (
    <div className="h-screen bg-gray-900 flex flex-col">
      <div className="flex-1 flex">
        {/* Main Video Area */}
        <div className="flex-1 flex flex-col">
          <VideoGallery participants={participants} />
          
          <MeetingControls
            isAudioMuted={isAudioMuted}
            isVideoMuted={isVideoMuted}
            isScreenSharing={isScreenSharing}
            participantCount={participants.length}
            onToggleAudio={onToggleAudio}
            onToggleVideo={onToggleVideo}
            onToggleScreenShare={onToggleScreenShare}
            onLeaveMeeting={onLeaveMeeting}
            onToggleChat={() => setIsChatOpen(!isChatOpen)}
            onToggleParticipants={() => setIsParticipantsOpen(!isParticipantsOpen)}
          />
        </div>

        {/* Chat Panel */}
        <ChatPanel
          isOpen={isChatOpen}
          messages={chatMessages}
          onSendMessage={onSendMessage}
          onClose={() => setIsChatOpen(false)}
        />

        {/* Participants Panel */}
        <ParticipantsPanel
          isOpen={isParticipantsOpen}
          participants={participants}
          onClose={() => setIsParticipantsOpen(false)}
        />
      </div>
    </div>
  );
};