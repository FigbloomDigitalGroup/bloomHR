export interface ZoomUser {
  userId: number;
  displayName: string;
  avatar?: string;
  audio?: {
    muted: boolean;
  };
  video?: {
    muted: boolean;
  };
  isHost?: boolean;
  isManager?: boolean;
}

export interface ChatMessage {
  id: string;
  sender: string;
  message: string;
  timestamp: number;
  
}

export interface MeetingConfig {
  sdkKey: string;
  sdkSecret: string;
  topic: string;
  signature: string;
  userName: string;
  userEmail?: string;
  password?: string;
  sessionKey?: string;
}