// src/services/zoomService.ts
import { ZoomMtg } from '@zoomus/websdk';

export const initializeZoom = async () => {
  ZoomMtg.setZoomJSLib('https://source.zoom.us/2.9.5/lib', '/av');
  ZoomMtg.preLoadWasm();
  ZoomMtg.prepareWebSDK();
};

export const joinMeeting = async (options: {
  meetingNumber: string;
  userName: string;
  userEmail: string;
  signature: string;
  apiKey: string;
  password?: string;
}) => {
  return new Promise<void>((resolve, reject) => {
    ZoomMtg.join({
      ...options,
      success: resolve,
      error: reject,
    });
  });
};

export const generateSignature = async (meetingNumber: string, role: '0' | '1' = '0') => {
  // In production, this should call your backend
  const { generateSignature } = await import('@zoomus/websdk/dist/zoom-meeting-embedded-signature.umd.min.js');
  return generateSignature({
    apiKey: import.meta.env.VITE_ZOOM_API_KEY,
    apiSecret: import.meta.env.VITE_ZOOM_API_SECRET,
    meetingNumber,
    role
  });
};