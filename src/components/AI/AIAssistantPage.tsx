import { useState, useEffect, useMemo, useRef } from 'react'
import { queryDeepSeek } from '../../services/deepseek'
import { supabase } from '../../lib/supabase'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, User, Cpu, Database, Users, Activity, Sparkles, Bot, BarChart2, MapPin } from 'lucide-react'
import { TownProps } from '../../types/supabase'

interface AreaTownMapping {
  [area: string]: string[];
}

interface BranchAreaMapping {
  [branch: string]: string;
}

// Add this function to format AI responses with beautiful styling
const formatAIResponse = (content: string) => {
  // Convert markdown-like syntax to beautiful HTML
  return content
    // Headers
    .replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold text-gray-800 mt-4 mb-2">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold text-gray-900 mt-6 mb-3 border-b pb-2">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold text-gray-900 mt-6 mb-4">$1</h1>')
    
    // Bold and Italic
    .replace(/\*\*(.*?)\*\*/gim, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em class="italic text-gray-700">$1</em>')
    
    // Lists
    .replace(/^\* (.*$)/gim, '<li class="flex items-start mb-1"><span class="text-blue-500 mr-2 mt-1">•</span><span>$1</span></li>')
    .replace(/^- (.*$)/gim, '<li class="flex items-start mb-1"><span class="text-blue-500 mr-2 mt-1">-</span><span>$1</span></li>')
    .replace(/(<li.*?<\/li>)/gims, '<ul class="space-y-2 my-3">$1</ul>')
    
    // Code blocks
    .replace(/`(.*?)`/gim, '<code class="bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm font-mono border">$1</code>')
    
    // Line breaks
    .replace(/\n/g, '<br>')
    
    // Sections with cards
    .replace(/\[card\](.*?)\[\/card\]/gims, '<div class="bg-blue-50 border border-blue-200 rounded-xl p-4 my-3">$1</div>')
    
    // Highlights
    .replace(/\[highlight\](.*?)\[\/highlight\]/gims, '<div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 my-2">$1</div>');
};

export const AIAssistantPage = ({ selectedTown, onTownChange }: TownProps) => {
  const [message, setMessage] = useState('')
  const [conversation, setConversation] = useState<Array<{role: string, content: string, id: string}>>([])
  const [loading, setLoading] = useState(false)
  const [allEmployees, setAllEmployees] = useState<any[]>([]) // Store ALL employees
  const [error, setError] = useState<string | null>(null)
  
  // Area/Town mapping state
  const [areaTownMapping, setAreaTownMapping] = useState<AreaTownMapping>({});
  const [branchAreaMapping, setBranchAreaMapping] = useState<BranchAreaMapping>({});
  const [isArea, setIsArea] = useState<boolean>(false);
  const [townsInArea, setTownsInArea] = useState<string[]>([]);
  const [currentTown, setCurrentTown] = useState<string>(selectedTown || '');

  // Auto-scroll ref
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom function
  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  // Scroll to bottom when conversation updates or loading state changes
  useEffect(() => {
    scrollToBottom();
  }, [conversation, loading]);

  // Load area-town mapping and set current town
  useEffect(() => {
    const loadMappings = async () => {
      try {
        // Fetch the area-town mapping from the database
        const { data: employeesData, error: employeesError } = await supabase
          .from('employees')
          .select('Branch, Town');
        
        if (employeesError) {
          console.error("Error loading area-town mapping:", employeesError);
          return;
        }
        
        // Convert the data to a mapping object
        const mapping: AreaTownMapping = {};
        employeesData?.forEach(item => {
          if (item.Branch && item.Town) {
            if (!mapping[item.Branch]) {
              mapping[item.Branch] = [];
            }
            if (!mapping[item.Branch].includes(item.Town)) {
              mapping[item.Branch].push(item.Town);
            }
          }
        });
        
        setAreaTownMapping(mapping);
        
        // Fetch branch-area mapping from kenya_branches
        const { data: branchesData, error: branchesError } = await supabase
          .from('kenya_branches')
          .select('"Branch Office", "Area"');
        
        if (branchesError) {
          console.error("Error loading branch-area mapping:", branchesError);
          return;
        }
        
        // Convert the data to a mapping object
        const branchMapping: BranchAreaMapping = {};
        branchesData?.forEach(item => {
          if (item['Branch Office'] && item['Area']) {
            branchMapping[item['Branch Office']] = item['Area'];
          }
        });
        
        setBranchAreaMapping(branchMapping);
        
        // Set current town from props or localStorage
        const savedTown = localStorage.getItem('selectedTown');
        if (savedTown && (!selectedTown || selectedTown === 'ADMIN_ALL')) {
          setCurrentTown(savedTown);
          if (onTownChange) {
            onTownChange(savedTown);
          }
        } else if (selectedTown) {
          setCurrentTown(selectedTown);
          localStorage.setItem('selectedTown', selectedTown);
        }
      } catch (error) {
        console.error("Error in loadMappings:", error);
      }
    };

    loadMappings();
  }, [selectedTown, onTownChange]);

  // Check if current selection is an area and get its towns
  useEffect(() => {
    if (currentTown && areaTownMapping[currentTown]) {
      setIsArea(true);
      setTownsInArea(areaTownMapping[currentTown]);
    } else {
      setIsArea(false);
      setTownsInArea([]);
    }
  }, [currentTown, areaTownMapping]);

  // Fetch ALL employees once on component mount
  useEffect(() => {
    const fetchAllEmployees = async () => {
      try {
        console.log('Fetching ALL employees...');
        
        const { data, error } = await supabase
          .from('employees')
          .select('*')
        
        if (error) {
          console.error('Supabase error:', error);
          throw error;
        }
        
        console.log('Fetched total employees:', data?.length);
        setAllEmployees(data || []);
        
      } catch (err) {
        setError('Failed to load employee data')
        console.error(err)
      }
    }
    
    fetchAllEmployees()
  }, []) // Only run once on mount

  // Filter employees based on selected town using useMemo for performance
  const filteredEmployees = useMemo(() => {
    if (!currentTown || currentTown === 'ADMIN_ALL') {
      return allEmployees;
    }
    
    console.log('Filtering employees for:', currentTown, 'isArea:', isArea);
    console.log('Total employees before filter:', allEmployees.length);
    
    const filtered = allEmployees.filter(employee => {
      if (isArea && townsInArea.length > 0) {
        // Filter by all towns in the area
        return townsInArea.includes(employee.Town || '');
      } else {
        // Filter by specific town
        return employee.Town === currentTown;
      }
    });
    
    console.log('Filtered employees count:', filtered.length);
    return filtered;
  }, [allEmployees, currentTown, isArea, townsInArea]);

  // Update conversation when filtered data changes
  useEffect(() => {
    const townContext = getTownContext();
    
    setConversation([{
      role: 'system',
      content: `There are ${filteredEmployees.length} employees in the system ${townContext}.`,
      id: 'system-init'
    }, {
      role: 'assistant',
      content: `Hello! I'm your HR AI Assistant. I can help you analyze data for ${filteredEmployees.length} employees ${townContext}. What would you like to know?`,
      id: 'welcome-message'
    }])
  }, [filteredEmployees, currentTown, isArea, townsInArea])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim() || loading) return
    
    setLoading(true)
    setError(null)
    const userMessage = { 
      role: 'user', 
      content: message,
      id: Date.now().toString() 
    }
    setConversation(prev => [...prev, userMessage])
    
    try {
      // Calculate real data statistics for AI context
      const realDataStats = calculateRealDataStats(filteredEmployees);

      const enhancedContext = `
        DATABASE SCHEMA: employees table with columns as previously described.

        ACTUAL DATA ANALYSIS CONTEXT:
        - Total employees: ${filteredEmployees.length}
        - Location: ${getTownContext()}
        
        REAL DATA STATISTICS:
        ${realDataStats}

        ANALYTICAL CAPABILITIES:
        - You have access to ${filteredEmployees.length} actual employee records
        - Analyze real distributions by Gender, Job Title, Branch, Town, etc.
        - Calculate actual salary statistics using Basic Salary field
        - Perform geographic analysis using actual Town and Branch data
        - Analyze employment types and demographics from real data
        
        RESPONSE GUIDELINES:
        - Analyze the ACTUAL ${filteredEmployees.length} employee records
        - Provide specific counts, percentages, and insights from real data
        - Reference actual data fields and values from the schema
        - Be factual and data-driven using the real employee data
        - If data is missing for certain fields, note that in your analysis

        RESPONSE FORMATTING GUIDELINES:
        - Use **bold** for key metrics and important numbers
        - Use *italic* for emphasis and insights
        - Use ### Headers for sections
        - Use * Bullet points for lists
        - Use \`code\` for specific data points or technical terms
        - Structure responses with clear sections
        - Start with key insights, then provide details
        - Use [highlight]...[/highlight] for important takeaways
        - Use [card]...[/card] for summary sections
      `;
      
      const result = await queryDeepSeek(message, enhancedContext)
      
      setConversation(prev => [
        ...prev,
        { 
          role: 'assistant', 
          content: result.response,
          id: `ai-${Date.now()}`
        }
      ])
      setMessage('')
    } catch (error) {
      setError('Failed to get AI response')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  // Helper function to calculate real data statistics
  const calculateRealDataStats = (employees: any[]) => {
    if (employees.length === 0) return 'No employee data available for analysis.';
    
    // Gender distribution
    const genderCounts = employees.reduce((acc, emp) => {
      const gender = emp.Gender || 'Unknown';
      acc[gender] = (acc[gender] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Job Title distribution (top 5)
    const jobTitleCounts = employees.reduce((acc, emp) => {
      const title = emp['Job Title'] || 'Unknown';
      acc[title] = (acc[title] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topJobTitles = Object.entries(jobTitleCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);
    
    // Branch distribution
    const branchCounts = employees.reduce((acc, emp) => {
      const branch = emp.Branch || 'Unknown';
      acc[branch] = (acc[branch] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Salary statistics (if available)
    const salaries = employees.map(emp => emp['Basic Salary']).filter(Boolean);
    const salaryStats = salaries.length > 0 ? {
      min: Math.min(...salaries),
      max: Math.max(...salaries),
      avg: salaries.reduce((a, b) => a + b, 0) / salaries.length
    } : null;
    
    return `
      - Gender Distribution: ${Object.entries(genderCounts).map(([gender, count]) => `${gender}: ${count}`).join(', ')}
      - Top Job Titles: ${topJobTitles.map(([title, count]) => `${title}: ${count}`).join(', ')}
      - Branch Distribution: ${Object.entries(branchCounts).map(([branch, count]) => `${branch}: ${count}`).join(', ')}
      ${salaryStats ? `- Salary Range: KES ${salaryStats.min.toLocaleString()} - KES ${salaryStats.max.toLocaleString()} (Avg: KES ${Math.round(salaryStats.avg).toLocaleString()})` : ''}
      - Employee Types: ${[...new Set(employees.map(emp => emp['Employee Type']).filter(Boolean))].join(', ')}
    `;
  };

  // Helper function to get town context
  const getTownContext = () => {
    if (!currentTown || currentTown === 'ADMIN_ALL') {
      return 'across all towns';
    }
    
    if (isArea) {
      return `for ${currentTown} area (${townsInArea.length} towns)`;
    }
    
    return `for ${currentTown} town`;
  };

  // Calculate HR metrics using filtered data
  const activeEmployees = filteredEmployees.filter((e: any) => e.status === 'active').length
  const avgTenure = filteredEmployees.length > 0 
    ? filteredEmployees.reduce((acc: number, e: any) => {
        const startDate = new Date(e.start_date)
        const tenure = (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 365)
        return acc + tenure
      }, 0) / filteredEmployees.length
    : 0

  // Get town display name
  const getTownDisplayName = () => {
    if (!currentTown) return "All Towns";
    if (currentTown === 'ADMIN_ALL') return "All Towns";
    
    if (isArea) {
      return `${currentTown} Area (${townsInArea.length} towns)`;
    }
    
    return currentTown;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4"
        >
          <div>
            <h1 className="text-4xl font-bold text-gray-800 flex items-center gap-4">
              <div className="p-3  rounded-xl text-blue-600 border border-blue-200">
                <img
                  src="/avatars.png"
                  alt="Avatar"
                  className="w-10 h-10 object-cover rounded-full"
                />
              </div>
              <span className="text-lg bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
                HR AI Assistant
              </span>
            </h1>
            <p className="text-gray-600 mt-2 max-w-lg text-xs">
              AI-powered workforce analytics and insights for{" "}
              <span className="font-medium text-blue-600 flex items-center mt-1">
                <MapPin className="w-4 h-4 mr-1" />
                {getTownDisplayName()}
              </span>
            </p>
          </div>
          
          <motion.div 
            whileHover={{ scale: 1.02 }}
            className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-full px-4 py-2"
          >
            <Sparkles className="w-5 h-5 text-blue-500" />
            <span className="text-xs font-medium text-blue-700">AI Assistant</span>
          </motion.div>
        </motion.header>

        {/* HR Summary Cards */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"
        >
          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                <Users className="w-6 h-6" />
              </div>
              <h6 className="font-medium text-gray-700">Total Employees</h6>
            </div>
            <p className="text-4xl font-bold text-gray-900">
              {filteredEmployees.length}
              <span className="text-xs font-normal ml-2 text-gray-500">
                {getTownContext()}
              </span>
            </p>
          </motion.div>

          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-100 rounded-lg text-green-600">
                <Activity className="w-6 h-6" />
              </div>
              <h6 className="font-medium text-gray-700">Active Employees</h6>
            </div>
            <p className="text-4xl font-bold text-gray-900">
              {activeEmployees}
              <span className="text-xs font-normal ml-2 text-gray-500">active</span>
            </p>
          </motion.div>

          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                <BarChart2 className="w-6 h-6" />
              </div>
              <h6 className="font-medium text-gray-700">Avg. Tenure</h6>
            </div>
            <p className="text-4xl font-bold text-gray-900">
              {avgTenure ? avgTenure.toFixed(1) : '--'}
              <span className="text-xs font-normal ml-2 text-gray-500">years</span>
            </p>
          </motion.div>
        </motion.div>

        {/* Chat Interface */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl overflow-hidden border border-gray-200 shadow-lg"
        >
          {/* Messages */}
          <div 
            ref={scrollRef}
            className="h-[500px] overflow-y-auto p-6 space-y-6 custom-scrollbar"
          >
            <AnimatePresence>
              {conversation
                .filter(m => m.role !== 'system')
                .map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] rounded-2xl p-5 ${msg.role === 'user' 
                      ? 'bg-gradient-to-br from-blue-600 to-blue-500 text-white rounded-br-none' 
                      : 'bg-gray-100 text-gray-800 rounded-bl-none border border-gray-200'}`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        {msg.role === 'user' ? (
                          <div className="p-1.5 bg-white/30 rounded-full">
                            <User className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="p-1.5 bg-blue-500/20 rounded-full">
                            <img
                              src="/avatars.png"
                              alt="Avatar"
                              className="w-10 h-10 object-cover rounded-full"
                            />
                          </div>
                        )}
                        <span className="text-xs font-medium">
                          {msg.role === 'user' ? 'You' : 'HR Assistant'}
                        </span>
                      </div>
                      {/* Updated message content with beautiful formatting */}
                      {msg.role === 'user' ? (
                        <p className="whitespace-pre-wrap text-xs/relaxed">{msg.content}</p>
                      ) : (
                        <div 
                          className="whitespace-pre-wrap text-xs/relaxed ai-response-content"
                          dangerouslySetInnerHTML={{ __html: formatAIResponse(msg.content) }}
                        />
                      )}
                    </div>
                  </motion.div>
                ))}
              
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex justify-start"
                >
                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-bl-none p-5 max-w-[80%] border border-gray-200">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 bg-blue-500/20 rounded-full">
                       <img
                  src="/avatars.png"
                  alt="Avatar"
                  className="w-10 h-10 object-cover rounded-full"
                />
                      </div>
                      <span className="text-xs font-medium">HR Assistant</span>
                    </div>
                    <div className="mt-3 flex space-x-2">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '200ms' }} />
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '400ms' }} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Input Area */}
          <div className="border-t border-gray-200 p-5 bg-gray-50">
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 bg-red-100 text-red-700 p-3 rounded-lg text-xs border border-red-200"
              >
                {error}
              </motion.div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="flex-1 bg-white border border-gray-300 rounded-xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-800 placeholder-gray-400 text-xs"
                placeholder="Ask about your HR data (e.g. 'Show turnover trends')"
                disabled={loading}
              />
              <motion.button
                type="submit"
                disabled={loading || !message.trim()}
                whileTap={{ scale: 0.95 }}
                whileHover={{ scale: 1.05 }}
                className="p-3.5 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-400 hover:to-blue-500 disabled:opacity-50 transition-all flex items-center justify-center shadow-md shadow-blue-500/30"
              >
                <Send className="w-5 h-5" />
              </motion.button>
            </form>
            <p className="text-xs text-gray-500 mt-3 text-center">
              AI assistant may produce inaccurate information about people or policies
            </p>
          </div>
        </motion.div>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 3px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.2);
        }

        /* Beautiful AI Response Styling */
        .ai-response-content h1 {
          font-size: 1.5rem;
          font-weight: bold;
          color: #1f2937;
          margin-top: 1.5rem;
          margin-bottom: 1rem;
        }
        
        .ai-response-content h2 {
          font-size: 1.25rem;
          font-weight: bold;
          color: #111827;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
          padding-bottom: 0.5rem;
          border-bottom: 2px solid #e5e7eb;
        }
        
        .ai-response-content h3 {
          font-size: 1.125rem;
          font-weight: bold;
          color: #374151;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }
        
        .ai-response-content ul {
          margin: 0.75rem 0;
          padding-left: 1rem;
          space-y: 0.5rem;
        }
        
        .ai-response-content li {
          display: flex;
          align-items: flex-start;
          margin-bottom: 0.25rem;
        }
        
        .ai-response-content strong {
          font-weight: 600;
          color: #111827;
        }
        
        .ai-response-content em {
          font-style: italic;
          color: #374151;
        }
        
        .ai-response-content code {
          background-color: #f3f4f6;
          color: #1f2937;
          padding: 0.25rem 0.5rem;
          border-radius: 0.375rem;
          font-size: 0.75rem;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          border: 1px solid #e5e7eb;
        }
        
        .ai-response-content br {
          margin-bottom: 0.5rem;
          display: block;
          content: "";
        }
      `}</style>
    </div>
  )
}