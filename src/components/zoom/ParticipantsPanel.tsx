import React from 'react';
import { X, Mic, MicOff, Video, VideoOff, Crown, MoreVertical } from 'lucide-react';
import { ZoomUser } from '../../types/zoom';

interface ParticipantsPanelProps {
  isOpen: boolean;
  participants: ZoomUser[];
  onClose: () => void;
}

export const ParticipantsPanel: React.FC<ParticipantsPanelProps> = ({
  isOpen,
  participants,
  onClose
}) => {
  if (!isOpen) return null;

  return (
    <div className="bg-gray-800 border-l border-gray-700 w-80 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-white font-semibold">
          Participants ({participants.length})
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Participants List */}
      <div className="flex-1 overflow-y-auto">
        {participants.map((participant) => (
          <div
            key={participant.userId}
            className="p-4 border-b border-gray-700 hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="bg-blue-600 rounded-full w-8 h-8 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">
                    {participant.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-white text-xs font-medium">
                      {participant.displayName}
                    </span>
                    {participant.isHost && (
                      <Crown className="w-4 h-4 text-yellow-400" />
                    )}
                  </div>
                  {participant.isHost && (
                    <span className="text-xs text-gray-400">Host</span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {/* Audio Status */}
                {participant.audio?.muted ? (
                  <div className="text-red-500" title="Muted">
                    <MicOff className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="text-green-500" title="Unmuted">
                    <Mic className="w-4 h-4" />
                  </div>
                )}

                {/* Video Status */}
                {participant.video?.muted ? (
                  <div className="text-red-500" title="Camera Off">
                    <VideoOff className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="text-green-500" title="Camera On">
                    <Video className="w-4 h-4" />
                  </div>
                )}

                {/* More Options */}
                <button className="text-gray-400 hover:text-white p-1">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};