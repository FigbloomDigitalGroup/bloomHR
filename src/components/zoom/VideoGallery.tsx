import React from 'react';
import { ParticipantVideo } from './ParticipantVideo';
import { ZoomUser } from '../../types/zoom';

interface VideoGalleryProps {
  participants: ZoomUser[];
}

export const VideoGallery: React.FC<VideoGalleryProps> = ({ participants }) => {
  if (participants.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-900 rounded-lg">
        <div className="text-center text-gray-400">
          <p className="text-xl">No participants in the meeting</p>
        </div>
      </div>
    );
  }

  if (participants.length === 1) {
    return (
      <div className="flex-1 p-4">
        <ParticipantVideo participant={participants[0]} isLarge />
      </div>
    );
  }

  const getGridCols = (count: number) => {
    if (count <= 4) return 'grid-cols-2';
    if (count <= 9) return 'grid-cols-3';
    return 'grid-cols-4';
  };

  return (
    <div className="flex-1 p-4">
      <div className={`grid ${getGridCols(participants.length)} gap-4 h-full`}>
        {participants.map((participant) => (
          <ParticipantVideo key={participant.userId} participant={participant} />
        ))}
      </div>
    </div>
  );
};