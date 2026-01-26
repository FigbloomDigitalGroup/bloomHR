import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase'; // Adjust path to your supabase config

const VideoConferenceComponent = () => {
  const [meetingCode, setMeetingCode] = useState('');
  const [userName, setUserName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [api, setApi] = useState(null);
  const [preGeneratedCode, setPreGeneratedCode] = useState('');
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isSomeoneTranscribing, setIsSomeoneTranscribing] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  
  const jitsiContainerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const transcriptIdRef = useRef(null);

  // Environment variables
  const JITSI_DOMAIN = import.meta.env.VITE_JITSI_DOMAIN || 'meet.jit.si';
  const VPAAS_MAGIC_COOKIE = import.meta.env.VITE_VPAAS_MAGIC_COOKIE;
  const DEEPSEEK_API_KEY = import.meta.env.VITE_DEEPSEEK_API_KEY;

  // Function to generate a deterministic code based on 5-day intervals
  const generateFiveDayCode = () => {
    const now = new Date();
    const startDate = new Date('2024-01-01');
    const diffTime = now - startDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const fiveDayPeriod = Math.floor(diffDays / 5);
    
    const adjectives = ['quick', 'bright', 'clear', 'happy', 'smart', 'brave', 'calm', 'eager', 'gentle', 'jolly', 'kind', 'lively', 'nice', 'proud', 'silly', 'witty'];
    const nouns = ['team', 'meeting', 'session', 'call', 'huddle', 'chat', 'talk', 'brief', 'review', 'sync', 'standup', 'planning', 'brainstorm', 'workshop'];
    const colors = ['red', 'blue', 'green', 'gold', 'silver', 'navy', 'teal', 'ruby', 'pearl', 'amber', 'ivory', 'ebony'];
    
    const adjIndex = (fiveDayPeriod * 3) % adjectives.length;
    const nounIndex = (fiveDayPeriod * 7) % nouns.length;
    const colorIndex = (fiveDayPeriod * 11) % colors.length;
    
    const code = `${adjectives[adjIndex]}-${colors[colorIndex]}-${nouns[nounIndex]}-${(fiveDayPeriod % 99).toString().padStart(2, '0')}`;
    
    return code;
  };

  // Function to get days until next code change
  const getDaysUntilChange = () => {
    const now = new Date();
    const startDate = new Date('2024-01-01');
    const diffTime = now - startDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const daysInCurrentPeriod = diffDays % 5;
    return 5 - daysInCurrentPeriod;
  };

  // Initialize pre-generated code
  useEffect(() => {
    const code = generateFiveDayCode();
    setPreGeneratedCode(code);
    setMeetingCode(code);
  }, []);

  // Save transcript and summary to Supabase
  const saveToSupabase = async (transcriptText, summaryText, isFinal = false) => {
    try {
      const transcriptData = {
        meeting_code: meetingCode,
        participant_name: userName,
        transcript: transcriptText,
        summary: summaryText,
        updated_at: new Date().toISOString(),
      };

      let result;

      if (transcriptIdRef.current) {
        // Update existing record
        result = await supabase
          .from('meeting_transcripts')
          .update(transcriptData)
          .eq('id', transcriptIdRef.current)
          .select();
      } else {
        // Create new record
        result = await supabase
          .from('meeting_transcripts')
          .insert([transcriptData])
          .select();

        if (result.data && result.data[0]) {
          transcriptIdRef.current = result.data[0].id;
        }
      }

      if (result.error) {
        console.error('Error saving to Supabase:', result.error);
        setSaveStatus('Failed to save');
        return false;
      }

      setSaveStatus(isFinal ? 'Saved successfully' : 'Auto-saved');
      setTimeout(() => setSaveStatus(''), 3000);
      return true;
    } catch (error) {
      console.error('Error saving to Supabase:', error);
      setSaveStatus('Failed to save');
      return false;
    }
  };

  // Auto-save when transcript or summary changes
  useEffect(() => {
    if ((transcript || summary) && isJoined) {
      const saveData = async () => {
        await saveToSupabase(transcript, summary);
      };
      
      // Debounce auto-save to prevent too many writes
      const timeoutId = setTimeout(saveData, 5000);
      return () => clearTimeout(timeoutId);
    }
  }, [transcript, summary, meetingCode, userName, isJoined]);

  // Initialize speech recognition with multiple languages
  const initializeSpeechRecognition = () => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      
      recognition.continuous = true;
      recognition.interimResults = true;
      
      // Configure for multiple languages - English and Swahili
      recognition.lang = 'en-US';
      
      // Alternative approach for multi-language support
      const languages = ['en-US', 'sw-KE'];
      let currentLangIndex = 0;

      recognition.onresult = (event) => {
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          }
        }

        if (finalTranscript) {
          setTranscript(prev => {
            const newTranscript = prev + finalTranscript;
            return newTranscript;
          });
        }

        // Try switching languages if no results after a while
        if (!finalTranscript && event.results.length > 2) {
          currentLangIndex = (currentLangIndex + 1) % languages.length;
          try {
            recognition.lang = languages[currentLangIndex];
          } catch (e) {
            console.log('Language switch not supported');
          }
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          alert('Microphone access denied. Please allow microphone access to use transcription.');
        }
        setIsSomeoneTranscribing(false);
      };

      recognition.onend = () => {
        if (isTranscribing) {
          setTimeout(() => {
            if (isTranscribing && recognitionRef.current) {
              try {
                recognitionRef.current.start();
              } catch (error) {
                console.error('Error restarting recognition:', error);
                stopTranscription();
              }
            }
          }, 100);
        }
      };

      recognitionRef.current = recognition;
      return recognition;
    } else {
      alert('Speech recognition is not supported in your browser. Try Chrome or Edge.');
      return null;
    }
  };

  // Start transcription
  const startTranscription = async () => {
    if (isSomeoneTranscribing) {
      alert('Another participant is already transcribing this meeting. Only one transcription can be active at a time.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } 
      });
      
      const recognition = initializeSpeechRecognition();
      
      if (recognition) {
        recognition.start();
        setIsTranscribing(true);
        setIsSomeoneTranscribing(true);
      }

      // Set up media recorder for audio backup
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.start(1000);

    } catch (error) {
      console.error('Error starting transcription:', error);
      alert('Error accessing microphone. Please ensure you have granted microphone permissions.');
      setIsSomeoneTranscribing(false);
    }
  };

  // Stop transcription
  const stopTranscription = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
    setIsTranscribing(false);
    setIsSomeoneTranscribing(false);
  };

  // Generate summary using DeepSeek API
  const generateSummary = async () => {
    if (!transcript.trim()) {
      alert('No transcript available to summarize');
      return;
    }

    if (!DEEPSEEK_API_KEY) {
      alert('DeepSeek API key not configured');
      return;
    }

    setIsGeneratingSummary(true);
    
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that summarizes meeting transcripts. Provide concise, structured summaries that capture key decisions, action items, and important discussion points. Keep it under 200 words.'
            },
            {
              role: 'user',
              content: `Please provide a comprehensive summary of this meeting transcript:\n\n${transcript}`
            }
          ],
          max_tokens: 500,
          temperature: 0.3,
          stream: false
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      if (data.choices && data.choices[0] && data.choices[0].message) {
        const newSummary = data.choices[0].message.content;
        setSummary(newSummary);
        await saveToSupabase(transcript, newSummary);
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (error) {
      console.error('Error generating summary:', error);
      
      // Fallback summary
      const sentences = transcript.split('. ').filter(s => s.length > 10);
      const keySentences = sentences
        .filter(sentence => {
          const lower = sentence.toLowerCase();
          return lower.includes('important') || lower.includes('decision') || 
                 lower.includes('action') || lower.includes('agree') || 
                 lower.includes('conclusion') || lower.includes('next');
        })
        .slice(0, 6);
      
      const fallbackSummary = keySentences.length > 0 
        ? `Key Meeting Points:\n• ${keySentences.join('\n• ')}`
        : 'Summary will be generated when more content is available.';
      
      setSummary(fallbackSummary);
      alert('Unable to generate AI summary. Using basic summary instead.');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // Auto-generate summary when transcript reaches sufficient length
  useEffect(() => {
    if (transcript.length > 1000 && !summary && isTranscribing && !isGeneratingSummary) {
      const autoSummaryTimer = setTimeout(() => {
        generateSummary();
      }, 30000);

      return () => clearTimeout(autoSummaryTimer);
    }
  }, [transcript, summary, isTranscribing, isGeneratingSummary]);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    const element = jitsiContainerRef.current;
    
    if (!document.fullscreenElement) {
      if (element.requestFullscreen) {
        element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  };

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Export transcript and summary
  const exportTranscript = () => {
    const content = `Meeting Transcript & Summary
Generated: ${new Date().toLocaleString()}
Meeting Code: ${meetingCode}
Participant: ${userName}

TRANSCRIPT:
${transcript}

SUMMARY:
${summary}

--- 
Generated by Video Conference App`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-${meetingCode}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleJoinMeeting = (e) => {
    e.preventDefault();
    if (!meetingCode.trim() || !userName.trim()) return;
    
    setIsLoading(true);
    setTimeout(() => {
      setIsJoined(true);
      setIsLoading(false);
    }, 1500);
  };

  const handleLeaveMeeting = () => {
    if (isTranscribing) {
      stopTranscription();
    }
    if (api) {
      api.dispose();
      setApi(null);
    }
    
    // Save final version before leaving
    if (transcript || summary) {
      saveToSupabase(transcript, summary, true);
    }
    
    setIsJoined(false);
    setTranscript('');
    setSummary('');
    transcriptIdRef.current = null;
  };

  const handleUsePreGenerated = () => {
    setMeetingCode(preGeneratedCode);
  };

  // Initialize Jitsi Meet when component mounts and is joined
  useEffect(() => {
    if (isJoined && jitsiContainerRef.current) {
      const script = document.createElement('script');
      script.src = `https://${JITSI_DOMAIN}/external_api.js`;
      script.async = true;
      script.defer = true;
      
      let jitsiApi = null;

      script.onload = () => {
        const roomName = VPAAS_MAGIC_COOKIE 
          ? `${VPAAS_MAGIC_COOKIE}/${meetingCode.replace(/\s+/g, '')}`
          : meetingCode.replace(/\s+/g, '');

        jitsiApi = new window.JitsiMeetExternalAPI(JITSI_DOMAIN, {
          roomName: roomName,
          parentNode: jitsiContainerRef.current,
          userInfo: {
            displayName: userName,
          },
          configOverwrite: {
            prejoinPageEnabled: false,
            startWithAudioMuted: true,
            startWithVideoMuted: false,
            disableModeratorIndicator: false,
          },
          interfaceConfigOverwrite: {
            TOOLBAR_BUTTONS: [
              'microphone', 'camera', 'closedcaptions', 'desktop', 'fullscreen',
              'fodeviceselection', 'hangup', 'profile', 'chat', 'recording',
              'livestreaming', 'etherpad', 'sharedvideo', 'settings', 'raisehand',
              'videoquality', 'filmstrip', 'invite', 'feedback', 'stats', 'shortcuts',
              'tileview', 'videobackgroundblur', 'download', 'help', 'mute-everyone',
              'security'
            ],
          },
        });

        jitsiApi.addEventListener('videoConferenceJoined', () => {
          console.log('Successfully joined the conference');
        });

        jitsiApi.addEventListener('videoConferenceLeft', () => {
          handleLeaveMeeting();
        });

        setApi(jitsiApi);
      };

      script.onerror = () => {
        console.error('Failed to load Jitsi Meet API');
        alert('Failed to load video conference. Please check your connection.');
        setIsLoading(false);
        setIsJoined(false);
      };

      document.head.appendChild(script);

      return () => {
        if (jitsiApi) {
          jitsiApi.dispose();
        }
        if (script.parentNode) {
          script.parentNode.removeChild(script);
        }
      };
    }
  }, [isJoined, meetingCode, userName]);

  const daysUntilChange = getDaysUntilChange();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white  sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            
            {isJoined && (
              <div className="flex items-center space-x-4">
                <span className="text-sm text-gray-600">Joined as <strong>{userName}</strong></span>
                {saveStatus && (
                  <span className={`text-xs px-2 py-1 rounded ${
                    saveStatus.includes('Failed') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                  }`}>
                    {saveStatus}
                  </span>
                )}
                <button
                  onClick={handleLeaveMeeting}
                  className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Leave Meeting
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!isJoined ? (
          <div className="text-center max-w-2xl mx-auto">
           

            {/* Current Code Card */}
            <div className="max-w-md mx-auto mb-8">
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Recommended Meeting Code</h3>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {daysUntilChange} day{daysUntilChange !== 1 ? 's' : ''} left
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <code className="text-lg font-mono font-bold text-gray-900 bg-white px-3 py-2 rounded border">
                    {preGeneratedCode}
                  </code>
                  <button
                    onClick={handleUsePreGenerated}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center"
                  >
                    Use This Code
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-3 text-left">
                  This code automatically changes every 5 days for enhanced security.
                  Next rotation in {daysUntilChange} day{daysUntilChange !== 1 ? 's' : ''}.
                </p>
              </div>
            </div>

            <div className="max-w-sm mx-auto">
              <form onSubmit={handleJoinMeeting} className="space-y-6 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="userName" className="block text-sm font-medium text-gray-700 text-left mb-2">
                      Your Name
                    </label>
                    <input
                      id="userName"
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"
                      placeholder="Enter your name"
                      required
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="meetingCode" className="block text-sm font-medium text-gray-700 text-left mb-2">
                      Meeting Code
                    </label>
                    <input
                      id="meetingCode"
                      type="text"
                      value={meetingCode}
                      onChange={(e) => setMeetingCode(e.target.value)}
                      className="w-full px-4 py-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"
                      placeholder="Enter meeting code"
                      required
                    />
                  </div>
                </div>
                
                <button
                  type="submit"
                  disabled={isLoading}
                  className={`w-full py-3 px-4 text-sm font-medium text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                    isLoading
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {isLoading ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Joining Meeting...
                    </div>
                  ) : (
                    'Join Meeting'
                  )}
                </button>
              </form>
              
              <div className="mt-8 pt-6 border-t border-gray-200">
                <p className="text-sm text-gray-500">
                  Use the auto-generated code above or enter a custom meeting code
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Video Conference Section */}
            <div className="lg:flex-1 bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
              <div className="flex justify-between items-center bg-gray-800 px-6 py-4">
                <div className="flex items-center space-x-4">
                  <div>
                    <h2 className="text-white font-semibold">Meeting: {meetingCode}</h2>
                    <p className="text-gray-400 text-sm">Joined as: {userName}</p>
                  </div>
                  {isTranscribing && (
                    <div className="flex items-center space-x-2 bg-red-500 px-3 py-1 rounded-full">
                      <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                      <span className="text-white text-xs font-medium">REC</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center space-x-3">
                  {/* Transcription Controls */}
                  <button
                    onClick={isTranscribing ? stopTranscription : startTranscription}
                    disabled={isSomeoneTranscribing && !isTranscribing}
                    className={`px-4 py-2 rounded-lg text-xs font-medium flex items-center transition-colors ${
                      isTranscribing 
                        ? 'bg-red-600 text-white hover:bg-red-700' 
                        : isSomeoneTranscribing
                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                        : 'bg-green-600 text-white hover:bg-green-700'
                    }`}
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" />
                    </svg>
                    {isSomeoneTranscribing && !isTranscribing ? (
                      'Transcription Active'
                    ) : isTranscribing ? (
                      'Stop Transcription'
                    ) : (
                      'Start Transcription'
                    )}
                  </button>

                  {/* Fullscreen Toggle */}
                  <button
                    onClick={toggleFullscreen}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 flex items-center transition-colors"
                  >
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>
                </div>
              </div>
              
              <div 
                ref={jitsiContainerRef} 
                className="w-full bg-black"
                style={{ height: isFullscreen ? '85vh' : '60vh' }}
              />
            </div>

            {/* Transcription & Summary Panel */}
            <div className={`${isFullscreen ? 'hidden' : 'lg:w-96'} bg-white border border-gray-200 rounded-xl shadow-lg`}>
              <div className="border-b border-gray-200 px-6 py-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Live Transcript 
                </h3>
                <p className="text-sm text-gray-500 mt-1">Real-time transcription and summary</p>
                {isSomeoneTranscribing && !isTranscribing && (
                  <p className="text-xs text-orange-600 mt-1">
                    Another participant is transcribing this meeting
                  </p>
                )}
              </div>

              <div className="p-6 space-y-6 max-h-[calc(60vh+80px)] overflow-y-auto">
                {/* Transcription Status */}
                {isTranscribing && (
                  <div className="flex items-center space-x-2 text-green-600 bg-green-50 px-3 py-2 rounded-lg">
                    <div className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium">Live transcription active</span>
                  </div>
                )}

                {/* Transcript Section */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-medium text-gray-900">Transcript</h4>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                        {transcript.length} characters
                      </span>
                      {transcript && (
                        <button
                          onClick={() => setTranscript('')}
                          className="text-xs text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4 min-h-[120px] max-h-60 overflow-y-auto">
                    {transcript ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{transcript}</p>
                    ) : (
                      <div className="text-center py-8">
                        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 016 0v6a3 3 0 01-3 3z" />
                        </svg>
                        <p className="text-xs text-gray-500">
                          {isTranscribing ? 'Listening... Speak to see transcript here' : 'Start transcription to see live transcript'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Summary Section */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-medium text-gray-900">Summary</h4>
                    {transcript && !summary && (
                      <button
                        onClick={generateSummary}
                        disabled={isGeneratingSummary}
                        className="text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center transition-colors"
                      >
                        {isGeneratingSummary ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-1 h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Generating...
                          </>
                        ) : (
                          'Generate Summary'
                        )}
                      </button>
                    )}
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4 min-h-[100px] border border-blue-100">
                    {summary ? (
                      <div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{summary}</p>
                        <div className="mt-3 pt-3 border-t border-blue-200 flex justify-between items-center">
                          <button
                            onClick={generateSummary}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            Regenerate
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-sm text-gray-600">
                          {isGeneratingSummary 
                            ? 'Analyzing the transcript...' 
                            : 'Generate a summary of your meeting'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="space-y-3 pt-4 border-t border-gray-200">
                  <div className="flex space-x-3">
                    <button
                      onClick={() => navigator.clipboard.writeText(transcript)}
                      disabled={!transcript}
                      className="flex-1 py-2 px-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy Transcript
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(summary)}
                      disabled={!summary}
                      className="flex-1 py-2 px-3 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy Summary
                    </button>
                  </div>

                  {(transcript || summary) && (
                    <button
                      onClick={exportTranscript}
                      className="w-full py-2 px-3 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Export Transcript & Summary
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-sm text-gray-500">
              Secure Video Conferencing • End-to-end Encrypted • Real-time Transcription
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default VideoConferenceComponent;