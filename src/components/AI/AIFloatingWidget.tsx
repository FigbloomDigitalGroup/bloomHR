import { useState, useRef, useEffect } from "react";
import { queryDeepSeek } from "../../services/deepseek";
import { MessageCircle, X, Send, Bot, User, MessageCircleMore, Cpu } from "lucide-react";

const ChatFloater = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCurvedText, setShowCurvedText] = useState(true);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Hide curved text after 5 seconds
  useEffect(() => {
    if (showCurvedText && !isOpen) {
      const timer = setTimeout(() => {
        setShowCurvedText(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [showCurvedText, isOpen]);

  const systemPrompt = `You are a Loan Portfolio Performance Planner. For each branch in the user's query, calculate loan targets and financial metrics using these exact rules and formulas. Always classify branch age, compute all metrics, and present results in a clear, visually appealing format. If data is missing (e.g., previous OLB or borrowers), ask the user to clarify and do not guess.

  Rules:
  - Branch Age Classification:
    - New Branches (≤ 3 months old) → Target 30 new loans
    - Established Branches (> 3 months old) → Target 25 new loans
  - Loan Count Formula:
    Loan Count = New Loans + Repeat Loans
  - Repeat Loans (Retention):
    Achieve ≥ 80% retention of previous borrowers. Calculate Repeat Loans as at least 80% of previous borrower count (requires previous borrowers or OLB from user).
  - Average Loan Value:
    Average Loan Value = Disbursement Amount / Disbursement Count
    Use 5,000 KES as default if not specified.
  - Projected Disbursement Amount:
    Projected Disbursement Amount = Loan Count × Average Loan Value
  - Outstanding Loan Balance (OLB) Projection:
    Projected OLB = (Previous OLB × Retention Rate) + (New Loans × Average Loan Value)
    Use Retention Rate = 80% unless specified otherwise.
  - Retention Rate: Always ≥ 80%, presented as a percentage.

  For each branch, output results in a visually appealing format using clear headings and organized sections. Do not simply list the formulas or repeat the rules verbatim. Instead, present the calculated values in a professional, easy-to-read manner.

  If the query lacks details, respond with a friendly request for the needed information.`;

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    // More flexible input validation
    const isLoanPortfolioQuery = 
      input.toLowerCase().includes("branch") ||
      input.toLowerCase().includes("loan") ||
      input.toLowerCase().includes("olb") ||
      input.toLowerCase().includes("target") ||
      input.toLowerCase().includes("projection") ||
      input.match(/\d/); // Contains numbers

    if (!isLoanPortfolioQuery) {
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: "I specialize in loan portfolio planning. Please ask about branch targets, OLB calculations, or provide details like branch age, previous OLB, and borrower count for accurate projections.",
        timestamp: new Date()
      }]);
      setInput("");
      return;
    }

    const newMessage = { role: "user", content: input, timestamp: new Date() };
    setMessages((prev) => [...prev, newMessage]);
    const currentInput = input;
    setInput("");
    setLoading(true);

    // Build context string
    const recentMessages = messages.slice(-6);
    const context = [
      systemPrompt,
      ...recentMessages.map(msg => `${msg.role}: ${msg.content}`),
      `user: ${currentInput}`
    ].join('\n');

    const maxRetries = 2;
    let attempts = 0;
    
    while (attempts < maxRetries) {
      try {
        // Call DeepSeek API with string parameters
        const result = await queryDeepSeek(currentInput, context);
        
        // Handle different response formats
        let responseContent = '';
        if (typeof result === 'string') {
          responseContent = result;
        } else if (result?.choices?.[0]?.message?.content) {
          responseContent = result.choices[0].message.content;
        } else if (result?.response) {
          responseContent = result.response;
        } else if (result?.content) {
          responseContent = result.content;
        } else if (result?.data) {
          responseContent = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        } else {
          responseContent = "I received your message but had trouble processing it. Please try rephrasing or provide more details about your branch portfolio.";
        }

        // Format the response for better readability
        const formattedResponse = formatAssistantResponse(responseContent);
        
        setMessages((prev) => [...prev, { 
          role: "assistant", 
          content: formattedResponse,
          timestamp: new Date()
        }]);
        break;
      } catch (error) {
        console.error("DeepSeek API Error:", error);
        attempts++;
        
        if (attempts === maxRetries) {
          let errorMessage = `⚠️ Failed to connect to the AI service after ${maxRetries} attempts. `;
          
          if (error.message?.includes("network") || error.message?.includes("fetch")) {
            errorMessage += "Please check your internet connection and try again.";
          } else if (error.message?.includes("auth") || error.message?.includes("401") || error.message?.includes("403")) {
            errorMessage += "There might be an issue with API authentication. Please contact support.";
          } else {
            errorMessage += `Error: ${error.message || 'Unknown error'}`;
          }
          
          setMessages((prev) => [...prev, { 
            role: "assistant", 
            content: errorMessage,
            timestamp: new Date()
          }]);
        }
      }
    }
    setLoading(false);
  };

  // Function to format the assistant's response for better readability
  const formatAssistantResponse = (response) => {
    // Convert markdown-like formatting to HTML-like tags for better rendering
    let formatted = response
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold text
      .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italic text
      .replace(/^-\s+(.*)$/gm, '• $1') // Bullet points
      .replace(/\n\n/g, '<br/><br/>') // Paragraph breaks
      .replace(/\n/g, '<br/>'); // Line breaks

    // Add section headers for better organization
    if (formatted.includes("Branch Age") || formatted.includes("New Loan Target")) {
      formatted = `<div class="portfolio-summary">${formatted}</div>`;
    }

    return formatted;
  };

  const formatTime = (timestamp) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(timestamp);
  };

  const clearChat = () => {
    setMessages([]);
  };

  // Component to render formatted message content
  const FormattedMessage = ({ content }) => {
    return (
      <div 
        className="text-xs leading-relaxed"
        dangerouslySetInnerHTML={{ __html: content }} 
      />
    );
  };

  return (
    <div className="font-sans">
      {/* Floating Action Button with Curved Text */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-50">
          {/* Curved Text Container */}
          {showCurvedText && (
            <div className="absolute -top-16 -right-4 transform rotate-12 animate-bounce">
              <div className="relative">
                {/* Curved Text SVG */}
                <svg 
                  width="120" 
                  height="60" 
                  viewBox="0 0 120 60"
                  className="filter drop-shadow-lg"
                >
                  <defs>
                    <linearGradient id="textGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                  <path
                    id="curve"
                    d="M 20 50 A 40 40 0 1 1 100 50"
                    fill="transparent"
                  />
                  <text
                    width="120"
                    className="text-xs font-semibold"
                  >
                    <textPath
                      href="#curve"
                      startOffset="50%"
                      textAnchor="middle"
                      fill="url(#textGradient)"
                    >
                      ✨ am here to help!
                    </textPath>
                  </text>
                </svg>
                
                {/* Speech bubble tail */}
                
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setIsOpen(true);
              setShowCurvedText(false);
            }}
            onMouseEnter={() => setShowCurvedText(true)}
            className="group relative bg-blue-600/30 backdrop-blur-sm hover:bg-white/40 text-gray-600 p-3 rounded-full shadow-lg transition-all duration-300 transform hover:scale-105 border border-gray-300/50"
          >
            <img
              src="/avatars.png"
              alt="Avatar"
              className="w-8 h-8 object-cover rounded-full"
            />
            
            {/* Subtle pulse animation */}
            <div className="absolute inset-0 rounded-full bg-white/40 animate-pulse opacity-50 -z-10"></div>
            
           
          </button>
        </div>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 w-96 h-[500px] bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-gray-200/50 flex flex-col overflow-hidden transition-all duration-500">
          {/* Header */}
          <div className="relative bg-gradient-to-r from-blue-600/90 to-purple-600/90 backdrop-blur-lg p-4 border-b border-white/20">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <img
                      src="/avatars.png"
                      alt="Avatar"
                      className="w-10 h-10 object-cover rounded-full"
                    />
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-white rounded-full"></div>
                </div>
                <div>
                  <h2 className="text-white font-semibold text-xs">Loan Portfolio AI</h2>
                  <p className="text-white/70 text-xs">Performance Assistant</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-1">
                <button 
                  onClick={clearChat}
                  className="p-1.5 text-xs text-white/70 hover:text-white hover:bg-white/20 rounded transition-colors duration-200"
                  title="Clear chat"
                >
                  Clear
                </button>
                <button 
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-white/20 rounded-full transition-colors duration-200"
                >
                  <X size={18} className="text-white" />
                </button>
              </div>
            </div>
          </div>

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gradient-to-b from-gray-50/50 to-white/50">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-gradient-to-r from-blue-100 to-purple-100 rounded-full mx-auto mb-3 flex items-center justify-center">
                  <img
                    src="/avatars.png"
                    alt="Avatar"
                    className="w-10 h-10 object-cover rounded-full"
                  />
                </div>
                <p className="text-gray-600 text-xs mb-2">Welcome to Loan Portfolio AI</p>
                <p className="text-gray-400 text-xs px-2">Ask about targets, projections, OLB calculations, or retention strategies.</p>
                <div className="mt-4 space-y-2">
                  <p className="text-gray-500 text-xs font-medium">Try asking:</p>
                  <div className="flex flex-col space-y-1 text-xs">
                    <button 
                      onClick={() => setInput("New branch with 40 previous borrowers and 200,000 KES OLB")}
                      className="text-blue-500 hover:text-blue-600"
                    >
                      • New branch with 40 borrowers
                    </button>
                    <button 
                      onClick={() => setInput("Established branch with 60 borrowers and 500,000 KES OLB")}
                      className="text-blue-500 hover:text-blue-600"
                    >
                      • Established branch projections
                    </button>
                    <button 
                      onClick={() => setInput("How to calculate retention rate?")}
                      className="text-blue-500 hover:text-blue-600"
                    >
                      • How to calculate retention
                    </button>
                  </div>
                </div>
              </div>
            )}
            
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-in slide-in-from-bottom-2`}
              >
                <div className={`flex items-start space-x-2 max-w-[85%] ${msg.role === "user" ? "flex-row-reverse space-x-reverse" : ""}`}>
                  {/* Avatar */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === "user" 
                      ? "bg-gradient-to-r from-blue-500 to-purple-500" 
                      : "bg-gradient-to-r from-gray-200 to-gray-300"
                  }`}>
                    {msg.role === "user" ? 
                      <User size={14} className="text-white" /> : 
                      <img
                  src="/avatars.png"
                  alt="Avatar"
                  className="w-10 h-10 object-cover rounded-full"
                />
                    }
                  </div>
                  
                  {/* Message Bubble */}
                  <div className={`relative px-4 py-3 rounded-2xl ${
                    msg.role === "user"
                      ? "bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg"
                      : "bg-white border border-gray-200 text-gray-800 shadow-sm"
                  }`}>
                    <FormattedMessage content={msg.content} />
                    {msg.timestamp && (
                      <div className={`text-xs mt-1 ${
                        msg.role === "user" ? "text-white/70" : "text-gray-400"
                      }`}>
                        {formatTime(msg.timestamp)}
                      </div>
                    )}
                    
                    {/* Message tail */}
                    <div className={`absolute top-4 w-2 h-2 transform rotate-45 ${
                      msg.role === "user" 
                        ? "-right-1 bg-gradient-to-r from-blue-500 to-purple-500" 
                        : "-left-1 bg-white border-l border-t border-gray-200"
                    }`}></div>
                  </div>
                </div>
              </div>
            ))}
            
            {/* Loading indicator */}
            {loading && (
              <div className="flex justify-start animate-in slide-in-from-bottom-2">
                <div className="flex items-start space-x-2 max-w-[85%]">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-r from-gray-200 to-gray-300 flex items-center justify-center flex-shrink-0">
                    <img
                  src="/avatars.png"
                  alt="Avatar"
                  className="w-10 h-10 object-cover rounded-full"
                />
                  </div>
                  <div className="bg-white border border-gray-200 px-4 py-3 rounded-2xl shadow-sm">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-4 bg-white/80 backdrop-blur-sm border-t border-gray-200/50">
            <div className="flex items-end space-x-3">
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="Ask about targets, projections, OLB calculations..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-2xl text-xs placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  disabled={loading}
                />
                
                <div className="absolute right-2 bottom-2">
                  {input.trim() && (
                    <button
                      onClick={handleSend}
                      disabled={loading}
                      className="p-1.5 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white rounded-full transition-all duration-200 transform hover:scale-110 disabled:opacity-50 disabled:transform-none"
                    >
                      <Send size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            {/* Quick suggestions */}
            <div className="flex flex-wrap gap-1 mt-2">
              {[
                "New branch with 40 borrowers",
                "Established branch OLB projection",
                "How to calculate retention?",
                "Targets for 3-month old branch"
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setInput(suggestion)}
                  disabled={loading}
                  className="px-2 py-1 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors duration-200 disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          {/* Add custom CSS for formatted messages */}
          <style>{`
            .portfolio-summary {
              line-height: 1.6;
            }
            .portfolio-summary strong {
              color: #4f46e5;
              font-weight: 600;
            }
            .portfolio-summary br {
              margin-bottom: 0.5rem;
              display: block;
              content: "";
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default ChatFloater;