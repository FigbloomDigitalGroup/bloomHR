// src/lib/zoom.ts
import { SignJWT } from 'jose';

// Validate environment variables (Vite uses import.meta.env)
const ZOOM_SDK_KEY = import.meta.env.VITE_ZOOM_SDK_KEY;
const ZOOM_SDK_SECRET = import.meta.env.VITE_ZOOM_SDK_SECRET;

if (!ZOOM_SDK_KEY || !ZOOM_SDK_SECRET) {
  console.error('Missing Zoom SDK credentials in environment variables');
  // In production, you might want to throw an error or handle this differently
}

export interface MeetingConfig {
  sdkKey: string;
  topic: string;
  signature: string;
  userName: string;
  userEmail?: string;
  // Note: sdkSecret should NOT be included in the final client-side config
}

export const generateSignature = async (
  sdkKey: string,
  sdkSecret: string,
  topic: string,
  roleType: number = 1
): Promise<string> => {
  // Enhanced input validation
  if (!sdkKey?.trim() || !sdkSecret?.trim()) {
    throw new Error('Invalid Zoom SDK credentials');
  }

  if (!topic?.trim()) {
    throw new Error('Meeting topic is required');
  }

  if (roleType !== 0 && roleType !== 1) {
    throw new Error('Invalid role type (must be 0 for participant or 1 for host)');
  }

  try {
    const secret = new TextEncoder().encode(sdkSecret);
    
    return await new SignJWT({
      sdkKey,
      mn: topic.trim(),       // Meeting topic/number
      role: roleType,         // 1 for host, 0 for participant
      appKey: sdkKey.trim(),
      iat: Math.floor(Date.now() / 1000),  // Issued at (seconds)
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2h')  // 2 hour expiration
      .sign(secret);
  } catch (error) {
    console.error('JWT generation error:', error);
    throw new Error('Failed to generate meeting signature');
  }
};

export const createMeetingConfig = async (
  topic: string,
  userName: string,
  userEmail?: string
): Promise<MeetingConfig> => {
  if (!ZOOM_SDK_KEY || !ZOOM_SDK_SECRET) {
    throw new Error('Zoom SDK is not properly configured');
  }

  // Validate user inputs
  if (!userName?.trim()) {
    throw new Error('User name is required');
  }

  if (userEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    throw new Error('Please enter a valid email address');
  }

  try {
    return {
      sdkKey: ZOOM_SDK_KEY,
      topic: topic.trim(),
      signature: await generateSignature(ZOOM_SDK_KEY, ZOOM_SDK_SECRET, topic),
      userName: userName.trim(),
      userEmail: userEmail?.trim(),
    };
  } catch (error) {
    console.error('Meeting config creation error:', error);
    throw new Error('Failed to create meeting configuration');
  }
};