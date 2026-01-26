// types/types.ts
export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName: string;
  workEmail: string;
  personalEmail?: string;
  mobileNumber?: string;
  workMobile?: string;
  jobTitle: string;
  jobGroup?: string;
  department: string;
  entity: string;
  branch?: string;
  manager?: string;
  profileImage?: string;
  status: 'online' | 'away' | 'offline';
  initials: string;
  startDate?: string;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  initials: string;
  email: string;
  status: 'online' | 'away' | 'offline';
  employeeData?: Employee;
  town?: string; 
}

// Update Channel to include jobTitle for filtered channels
export interface Channel {
  id: string;
  name: string;
  type: 'channel';
  description?: string;
  isPrivate: boolean;
  memberCount: number;
  unread_count?: number;
  createdBy: string;
  createdAt: string;
  jobTitle?: string; // Add this for job-specific channels
}

// Update DirectMessage to include more properties for better DM handling
export interface DirectMessage {
  id: string;
  name: string;
  type: 'direct_message';
  avatar?: string;
  initials: string;
  status: 'online' | 'away' | 'offline';
  unread_count?: number;
  userId: string;
  // Add these optional properties for better integration
  lastMessage?: string;
  lastMessageTime?: string;
  email?: string;
  isOnline?: boolean;
}

export interface Message {
  id: string;
  content: string;
  author: User;
  timestamp: string;
  reactions?: Reaction[];
  attachments?: Attachment[];
}

export interface Reaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

// Optional: Add a union type for easier handling of both channel types
export type ChatChannel = Channel | DirectMessage;

// Optional: Add type guards for better TypeScript support
export function isDirectMessage(channel: ChatChannel): channel is DirectMessage {
  return channel.type === 'direct_message';
}

export function isChannel(channel: ChatChannel): channel is Channel {
  return channel.type === 'channel';
}