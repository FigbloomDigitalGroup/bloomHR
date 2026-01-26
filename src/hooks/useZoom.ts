import { useState, useCallback, useRef, useEffect } from 'react';
import { ZoomUser, ChatMessage } from '../types/zoom';

// Mock implementation - replace with actual Zoom SDK
export const useZoomSDK = () => {
  const [isInMeeting, setIsInMeeting] = useState(false);
  const [participants, setParticipants] = useState<ZoomUser[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  const clientRef = useRef<any>(null);

  const joinMeeting = useCallback(async (config: any) => {
    try {
      setConnectionStatus('connecting');
      
      // Mock joining logic - replace with actual Zoom SDK
      setTimeout(() => {
        setIsInMeeting(true);
        setConnectionStatus('connected');
        
        // Add mock participants
        setParticipants([
          {
            userId: 1,
            displayName: config.userName,
            isHost: true,
            audio: { muted: false },
            video: { muted: false }
          },
          {
            userId: 2,
            displayName: 'John Doe',
            audio: { muted: true },
            video: { muted: false }
          },
          {
            userId: 3,
            displayName: 'Jane Smith',
            audio: { muted: false },
            video: { muted: true }
          }
        ]);
      }, 2000);
    } catch (error) {
      console.error('Failed to join meeting:', error);
      setConnectionStatus('disconnected');
    }
  }, []);

  const leaveMeeting = useCallback(async () => {
    try {
      setIsInMeeting(false);
      setParticipants([]);
      setChatMessages([]);
      setConnectionStatus('disconnected');
      setIsAudioMuted(false);
      setIsVideoMuted(false);
      setIsScreenSharing(false);
    } catch (error) {
      console.error('Failed to leave meeting:', error);
    }
  }, []);

  const toggleAudio = useCallback(async () => {
    setIsAudioMuted(!isAudioMuted);
  }, [isAudioMuted]);

  const toggleVideo = useCallback(async () => {
    setIsVideoMuted(!isVideoMuted);
  }, [isVideoMuted]);

  const toggleScreenShare = useCallback(async () => {
    setIsScreenSharing(!isScreenSharing);
  }, [isScreenSharing]);

  const sendChatMessage = useCallback((message: string) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: 'You',
      message,
      timestamp: Date.now()
    };
    setChatMessages(prev => [...prev, newMessage]);
  }, []);

  return {
    isInMeeting,
    participants,
    chatMessages,
    isAudioMuted,
    isVideoMuted,
    isScreenSharing,
    connectionStatus,
    joinMeeting,
    leaveMeeting,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    sendChatMessage
  };
};