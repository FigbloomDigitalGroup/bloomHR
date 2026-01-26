import React from 'react';
import { Mic, MicOff, Video, VideoOff, Crown, User } from 'lucide-react';
import { ZoomUser } from '../../types/zoom';

interface ParticipantVideoProps {
  participant: ZoomUser;
  isLarge?: boolean;
}

export const ParticipantVideo: React.FC<ParticipantVideoProps> = ({ 
  participant, 
  isLarge = false 
}) => {
  // Safely access nested properties with defaults
  const displayName = participant.displayName || 'Unknown';
  const isVideoMuted = participant.video?.muted ?? true;
  const isAudioMuted = participant.audio?.muted ?? true;
  const isHost = participant.isHost ?? false;

  return (
    <div className={`relative bg-gray-800 rounded-lg overflow-hidden ${isLarge ? 'aspect-video' : 'aspect-square'}`}>
      {/* Video placeholder */}
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-700 to-gray-900">
        {isVideoMuted ? (
          <div className="text-center">
            <div className="bg-gray-600 rounded-full p-4 mb-2 mx-auto w-16 h-16 flex items-center justify-center">
              <User className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-white text-xs font-medium">{displayName}</p>
          </div>
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <div className="text-white text-4xl font-bold opacity-20">
              {displayName.charAt(0).toUpperCase()}
            </div>
          </div>
        )}
      </div>

      {/* Participant info overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-white text-xs font-medium truncate">
              {displayName}
            </span>
            {isHost && (
              <Crown className="w-4 h-4 text-yellow-400 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center space-x-1">
            {isAudioMuted ? (
              <div className="bg-red-500 rounded-full p-1">
                <MicOff className="w-3 h-3 text-white" />
              </div>
            ) : (
              <div className="bg-green-500 rounded-full p-1">
                <Mic className="w-3 h-3 text-white" />
              </div>
            )}
            {isVideoMuted && (
              <div className="bg-red-500 rounded-full p-1">
                <VideoOff className="w-3 h-3 text-white" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Speaking indicator */}
      {!isAudioMuted && (
        <div className="absolute top-2 left-2">
          <div className="bg-green-500 rounded-full p-1 animate-pulse">
            <div className="w-2 h-2 bg-white rounded-full"></div>
          </div>
        </div>
      )}
    </div>
  );
};