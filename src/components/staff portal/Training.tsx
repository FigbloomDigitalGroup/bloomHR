import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

// Icons
import {
  PlayCircle,
  CheckCircle2,
  Lock,
  ChevronRight,
  ChevronLeft,
  Bookmark,
  Award,
  Clock,
  FileText,
  Users,
  BarChart2,
  HelpCircle,
  User,
  Box,
  Shield,
  X,
  Download,
  Search,
  Filter,
  BookOpen,
  Video,
  Image,
  File
} from 'lucide-react';

// Types
type TrainingDocument = {
  id: string;
  title: string;
  description: string | null;
  url: string;
  file_name: string;
  file_size: number;
  file_type: string;
  category: string;
  required: boolean;
  order: number;
  quiz_required: boolean;
  created_at: string;
};

type UserProgress = {
  id: string;
  document_id: string;
  employee_number: string;
  completed: boolean;
  completed_at: string | null;
  quiz_passed: boolean | null;
  quiz_score: number | null;
  time_spent: number;
  last_accessed: string;
  created_at: string;
  updated_at: string;
};

type TrainingCategory = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
};

const TrainingModule = () => {
  const [documents, setDocuments] = useState<TrainingDocument[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<TrainingDocument[]>([]);
  const [progress, setProgress] = useState<Record<string, UserProgress>>({});
  const [loading, setLoading] = useState(true);
  const [currentDocument, setCurrentDocument] = useState<TrainingDocument | null>(null);
  const [documentProgress, setDocumentProgress] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'videos' | 'documents'>('all');
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  const navigate = useNavigate();

  // Categories with icons and colors - dynamically generated from document categories
  const [categories, setCategories] = useState<TrainingCategory[]>([]);

  // Sample quiz questions (in a real app, these would come from Supabase)
  const quizQuestions = currentDocument ? [
    {
      id: '1',
      question: `What was the main point of "${currentDocument.title}"?`,
      options: [
        'Option A',
        'Option B',
        'Option C (Correct)',
        'Option D'
      ],
      correctAnswer: 'Option C (Correct)'
    },
    {
      id: '2',
      question: 'Which of these was NOT mentioned in the training material?',
      options: [
        'First concept',
        'Second concept',
        'Third concept (Correct)',
        'All were mentioned'
      ],
      correctAnswer: 'Third concept (Correct)'
    },
    {
      id: '3',
      question: 'How should you apply this knowledge?',
      options: [
        'In specific situations only',
        'Never',
        'In all relevant work (Correct)',
        'Only when supervised'
      ],
      correctAnswer: 'In all relevant work (Correct)'
    }
  ] : [];

  // Fetch training documents from Supabase
  useEffect(() => {
    const fetchTrainingData = async () => {
      try {
        setLoading(true);
        
        // Check authentication
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
          throw new Error(authError?.message || 'User not authenticated');
        }

        // Get employee number
        const { data: employeeData } = await supabase
          .from('employees')
          .select('"Employee Number"')
          .eq('"Work Email"', user.email)
          .single();

        if (employeeData) {
          setEmployeeNumber(employeeData["Employee Number"]);
        }

        // Fetch documents with error handling
        const { data: documentsData, error: documentsError } = await supabase
          .from('training_documents')
          .select('*')
          .order('order', { ascending: true })
          .order('created_at', { ascending: false });

        if (documentsError) throw documentsError;
        if (!documentsData) throw new Error('No training materials found');

        // Generate categories from documents
        const uniqueCategories = [...new Set(documentsData.map(doc => doc.category))];
        const generatedCategories = uniqueCategories.map((category, index) => {
          const colors = [
            { color: 'text-blue-600', bgColor: 'bg-blue-50' },
            { color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
            { color: 'text-amber-600', bgColor: 'bg-amber-50' },
            { color: 'text-violet-600', bgColor: 'bg-violet-50' },
            { color: 'text-rose-600', bgColor: 'bg-rose-50' },
            { color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
            { color: 'text-orange-600', bgColor: 'bg-orange-50' },
            { color: 'text-lime-600', bgColor: 'bg-lime-50' }
          ];
          const colorSet = colors[index % colors.length];
          
          const icons = [<User size={18} />, <Box size={18} />, <Shield size={18} />, 
                        <FileText size={18} />, <Users size={18} />, <BookOpen size={18} />];
          
          return {
            id: category.toLowerCase().replace(/\s+/g, '-'),
            name: category,
            description: `${category} training materials`,
            icon: icons[index % icons.length],
            ...colorSet
          };
        });

        setCategories(generatedCategories);
        setDocuments(documentsData);

        // Fetch user progress if employee number is available
        if (employeeData?.["Employee Number"]) {
          await fetchTrainingProgress(employeeData["Employee Number"]);
        }
        
      } catch (error) {
        console.error('Error fetching training data:', error);
        toast.error('Failed to load training content');
        if (error instanceof Error && error.message.includes('authentication')) {
          navigate('/login');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchTrainingData();
  }, [navigate]);

  // Filter documents when search, category, or tab changes
  useEffect(() => {
    let filtered = documents;

    // Filter by type (video/document)
    if (activeTab === 'videos') {
      filtered = filtered.filter(doc => isVideoFile(doc.file_type) || doc.file_type.includes('video'));
    } else if (activeTab === 'documents') {
      filtered = filtered.filter(doc => !isVideoFile(doc.file_type) && !doc.file_type.includes('video'));
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(doc =>
        doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.category.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filter by category
    if (activeCategory) {
      const categoryName = categories.find(cat => cat.id === activeCategory)?.name;
      if (categoryName) {
        filtered = filtered.filter(doc => doc.category === categoryName);
      }
    }

    setFilteredDocuments(filtered);
  }, [documents, searchTerm, activeCategory, categories, activeTab]);

  // Check if file is a video
  const isVideoFile = (fileType: string) => {
    return fileType.includes('video') || 
           fileType.includes('mp4') || 
           fileType.includes('avi') || 
           fileType.includes('mov') ||
           fileType.includes('wmv') ||
           fileType.includes('flv') ||
           fileType.includes('webm');
  };

  // Check if file is an image
  const isImageFile = (fileType: string) => {
    return fileType.includes('image') || 
           fileType.includes('jpg') || 
           fileType.includes('jpeg') || 
           fileType.includes('png') ||
           fileType.includes('gif') ||
           fileType.includes('bmp');
  };

  // Check if file is a PDF
  const isPDFFile = (fileType: string) => {
    return fileType.includes('pdf') || fileType.includes('application/pdf');
  };

  const fetchTrainingProgress = async (empNumber: string) => {
    try {
      const { data, error } = await supabase
        .from('training_progress')
        .select('*')
        .eq('employee_number', empNumber);

      if (error) throw error;

      // Convert progress array to object
      const progressObj = (data || []).reduce((acc, item) => {
        acc[item.document_id] = item;
        return acc;
      }, {} as Record<string, UserProgress>);

      setProgress(progressObj);
    } catch (error) {
      console.error('Error fetching training progress:', error);
    }
  };

  // Handle document progress updates
  const updateDocumentProgress = async (documentId: string, newProgress: number) => {
    try {
      if (!employeeNumber) return;

      const isCompleted = newProgress >= 95;
      const currentTime = new Date().toISOString();

      // Update local state first for immediate feedback
      setProgress(prev => ({
        ...prev,
        [documentId]: {
          ...prev[documentId],
          document_id: documentId,
          employee_number: employeeNumber,
          completed: isCompleted,
          completed_at: isCompleted ? currentTime : prev[documentId]?.completed_at,
          time_spent: (prev[documentId]?.time_spent || 0) + 1,
          last_accessed: currentTime
        }
      }));

      // Upsert to Supabase - using your existing table structure
      const { error } = await supabase
        .from('training_progress')
        .upsert({
          document_id: documentId,
          employee_number: employeeNumber,
          completed: isCompleted,
          completed_at: isCompleted ? currentTime : null,
          time_spent: (progress[documentId]?.time_spent || 0) + 1,
          last_accessed: currentTime,
          updated_at: currentTime
        }, {
          onConflict: 'document_id,employee_number'
        });

      if (error) throw error;

    } catch (error) {
      console.error('Error updating progress:', error);
      toast.error('Failed to update progress');
    }
  };

  // Handle document selection
  const handleSelectDocument = (document: TrainingDocument) => {
    // Check if previous required documents are completed
    if (document.required) {
      const previousRequiredDocuments = documents
        .filter(d => d.required && d.order < document.order)
        .sort((a, b) => a.order - b.order);

      for (const prevDoc of previousRequiredDocuments) {
        if (!progress[prevDoc.id]?.completed) {
          toast.error(`Please complete "${prevDoc.title}" first`);
          return;
        }
      }
    }

    setCurrentDocument(document);
    setDocumentProgress(progress[document.id]?.completed ? 100 : (progress[document.id]?.time_spent || 0));
    setShowQuiz(false);
    setQuizSubmitted(false);
    setQuizScore(null);
    setIsVideoPlaying(false);
    
    // Update access time
    updateDocumentProgress(document.id, progress[document.id]?.completed ? 100 : (progress[document.id]?.time_spent || 0));
  };

  // Handle video play
  const handleVideoPlay = () => {
    setIsVideoPlaying(true);
  };

  // Handle video end
  const handleVideoEnd = () => {
    setIsVideoPlaying(false);
    if (currentDocument) {
      handleDocumentComplete();
    }
  };

  // Handle document completion
  const handleDocumentComplete = () => {
    if (!currentDocument) return;
    
    updateDocumentProgress(currentDocument.id, 100);
    
    // For required documents, show quiz if required
    if (currentDocument.required && currentDocument.quiz_required) {
      setShowQuiz(true);
    } else {
      toast.success(`Completed: ${currentDocument.title}`);
    }
  };

  // Handle quiz submission
  const handleQuizSubmit = async () => {
    if (!currentDocument) return;

    // Calculate score
    const correctAnswers = quizQuestions.filter(q => 
      quizAnswers[q.id] === q.correctAnswer
    ).length;

    const score = Math.round((correctAnswers / quizQuestions.length) * 100);
    setQuizScore(score);
    setQuizSubmitted(true);

    // Update progress with quiz score
    if (score >= 80) { // Passing score
      try {
        const { error } = await supabase
          .from('training_progress')
          .upsert({
            document_id: currentDocument.id,
            employee_number: employeeNumber,
            completed: true,
            completed_at: new Date().toISOString(),
            quiz_passed: true,
            quiz_score: score,
            time_spent: (progress[currentDocument.id]?.time_spent || 0) + 1,
            last_accessed: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'document_id,employee_number'
          });

        if (error) throw error;

        // Update local state
        setProgress(prev => ({
          ...prev,
          [currentDocument.id]: {
            ...prev[currentDocument.id],
            completed: true,
            completed_at: new Date().toISOString(),
            quiz_passed: true,
            quiz_score: score,
            time_spent: (prev[currentDocument.id]?.time_spent || 0) + 1,
            last_accessed: new Date().toISOString()
          }
        }));

        toast.success(`Quiz passed! Score: ${score}%`);
      } catch (error) {
        console.error('Error updating quiz results:', error);
        toast.error('Failed to save quiz results');
      }
    } else {
      toast.error(`Quiz score ${score}% - please review and try again`);
    }
  };

  // Get next/previous documents
  const getAdjacentDocuments = () => {
    if (!currentDocument || documents.length === 0) return { prev: null, next: null };

    const currentIndex = documents.findIndex(d => d.id === currentDocument.id);
    const prevDocument = currentIndex > 0 ? documents[currentIndex - 1] : null;
    const nextDocument = currentIndex < documents.length - 1 ? documents[currentIndex + 1] : null;

    return {
      prev: prevDocument,
      next: nextDocument
    };
  };

  // Calculate overall progress
  const overallProgress = documents.length > 0
    ? Math.round(
        (Object.values(progress).filter(p => p.completed).length / 
        documents.filter(d => d.required).length) * 100
      )
    : 0;

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Get file icon based on file type
  const getFileIcon = (fileType: string) => {
    if (isVideoFile(fileType)) return <Video className="h-5 w-5" />;
    if (isPDFFile(fileType)) return <FileText className="h-5 w-5" />;
    if (isImageFile(fileType)) return <Image className="h-5 w-5" />;
    return <File className="h-5 w-5" />;
  };

  // Get file type badge
  const getFileTypeBadge = (fileType: string) => {
    if (isVideoFile(fileType)) return { text: 'Video', color: 'bg-red-100 text-red-800' };
    if (isPDFFile(fileType)) return { text: 'PDF', color: 'bg-red-100 text-red-800' };
    if (isImageFile(fileType)) return { text: 'Image', color: 'bg-green-100 text-green-800' };
    return { text: 'Document', color: 'bg-blue-100 text-blue-800' };
  };

  // Calculate progress percentage based on time spent
  const calculateProgressPercentage = (documentId: string) => {
    const docProgress = progress[documentId];
    if (!docProgress) return 0;
    
    if (docProgress.completed) return 100;
    
    // Use time spent as a proxy for progress (each minute = 10% progress)
    return Math.min(docProgress.time_spent * 10, 90);
  };

  // Count videos and documents
  const videoCount = documents.filter(doc => isVideoFile(doc.file_type)).length;
  const documentCount = documents.filter(doc => !isVideoFile(doc.file_type)).length;

  // Render loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-12 w-12 bg-gray-200 rounded-full mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-32"></div>
        </div>
      </div>
    );
  }

  // Render document viewer
  if (currentDocument) {
    const isVideo = isVideoFile(currentDocument.file_type);
    const isImage = isImageFile(currentDocument.file_type);
    const isPDF = isPDFFile(currentDocument.file_type);
    const currentProgress = calculateProgressPercentage(currentDocument.id);
    const fileTypeBadge = getFileTypeBadge(currentDocument.file_type);

    return (
      <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100">
        {/* Document header */}
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-gray-50 to-white">
          <button
            onClick={() => setCurrentDocument(null)}
            className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ChevronLeft className="h-5 w-5 mr-2" />
            <span className="font-medium">Back to training</span>
          </button>
          <div className="flex items-center space-x-3">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${fileTypeBadge.color}`}>
              {fileTypeBadge.text}
            </span>
            <span className="text-xs font-medium text-gray-500">
              {currentDocument.category} Training
            </span>
            {currentDocument.required && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                Required
              </span>
            )}
            {currentDocument.quiz_required && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                Quiz Required
              </span>
            )}
          </div>
        </div>

        <div className="p-6">
          {/* Document preview area */}
          <div className="bg-gray-900 rounded-xl overflow-hidden mb-6 shadow-md min-h-[400px] flex items-center justify-center">
            {isVideo ? (
              <div className="w-full max-w-4xl">
                <video
                  ref={videoRef}
                  controls
                  className="w-full max-h-[600px] object-contain"
                  onPlay={handleVideoPlay}
                  onEnded={handleVideoEnd}
                >
                  <source src={currentDocument.url} type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
            ) : isPDF ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-8">
                <FileText className="h-24 w-24 text-white mb-4 opacity-50" />
                <p className="text-white text-lg mb-4">PDF Document</p>
                <a
                  href={currentDocument.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-white text-black rounded-lg hover:bg-gray-100 transition-colors flex items-center"
                >
                  <Download className="h-5 w-5 mr-2" />
                  Open PDF in New Tab
                </a>
              </div>
            ) : isImage ? (
              <img 
                src={currentDocument.url} 
                alt={currentDocument.title}
                className="w-full h-full object-contain max-h-[600px]"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8">
                <FileText className="h-24 w-24 text-white mb-4 opacity-50" />
                <p className="text-white text-lg mb-4">{currentDocument.file_type.toUpperCase()} Document</p>
                <a
                  href={currentDocument.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-6 py-3 bg-white text-black rounded-lg hover:bg-gray-100 transition-colors flex items-center"
                >
                  <Download className="h-5 w-5 mr-2" />
                  Download File
                </a>
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row justify-between items-start mb-8 gap-6">
            <div className="flex-1">
              <h2 className="text-2xl font-semibold text-gray-900">{currentDocument.title}</h2>
              <p className="text-gray-600 mt-2">{currentDocument.description}</p>
              <div className="flex flex-wrap gap-4 mt-4 text-xs text-gray-500">
                <span className="flex items-center">
                  <FileText className="h-4 w-4 mr-1" />
                  {formatFileSize(currentDocument.file_size)}
                </span>
                <span>{currentDocument.file_type}</span>
                <span className="flex items-center">
                  <Filter className="h-4 w-4 mr-1" />
                  {currentDocument.category}
                </span>
                {progress[currentDocument.id]?.time_spent > 0 && (
                  <span className="flex items-center">
                    <Clock className="h-4 w-4 mr-1" />
                    {progress[currentDocument.id].time_spent} min spent
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-3">
              {progress[currentDocument.id]?.completed && (
                <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  Completed
                </span>
              )}
            </div>
          </div>

          {/* Progress controls */}
          <div className="bg-gray-50 rounded-xl p-6 mb-8">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="w-full">
                <div className="flex justify-between text-xs text-gray-600 mb-2">
                  <span className="font-medium">Your progress</span>
                  <span className="font-semibold">{currentProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div 
                    className="bg-emerald-600 h-3 rounded-full" 
                    style={{ width: `${currentProgress}%` }}
                  ></div>
                </div>
              </div>
              {!isVideo && (
                <button
                  onClick={() => {
                    if (currentProgress >= 90) {
                      handleDocumentComplete();
                    } else {
                      updateDocumentProgress(currentDocument.id, currentProgress + 10);
                    }
                  }}
                  className="px-6 py-3 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors shadow-sm whitespace-nowrap"
                >
                  {currentProgress >= 90 ? 'Mark Complete' : 'Add Progress +10%'}
                </button>
              )}
            </div>
            {isVideo && (
              <p className="text-xs text-gray-500 mt-3 text-center">
                Video progress is automatically tracked when you watch the entire video
              </p>
            )}
          </div>

          {/* Quiz section */}
          {showQuiz && (
            <div className="border-t border-gray-200 pt-8 mt-8">
              <div className="flex items-center mb-6">
                <div className="p-3 rounded-lg bg-blue-100 text-blue-600 mr-4">
                  <HelpCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Knowledge Check</h3>
                  <p className="text-gray-600">{quizQuestions.length} questions to test your understanding</p>
                </div>
              </div>

              {!quizSubmitted ? (
                <div className="space-y-6">
                  {quizQuestions.map((q) => (
                    <div key={q.id} className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                      <h4 className="text-lg font-medium text-gray-900 mb-4">{q.question}</h4>
                      <div className="space-y-3">
                        {q.options.map((opt) => (
                          <label key={opt} className="flex items-center space-x-4 p-3 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                            <input
                              type="radio"
                              name={`question-${q.id}`}
                              checked={quizAnswers[q.id] === opt}
                              onChange={() => setQuizAnswers(prev => ({
                                ...prev,
                                [q.id]: opt
                              }))}
                              className="h-5 w-5 text-emerald-600 focus:ring-emerald-500 border-gray-300"
                            />
                            <span className="text-gray-700">{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}

                  <div className="flex justify-end pt-4">
                    <button
                      onClick={handleQuizSubmit}
                      disabled={Object.keys(quizAnswers).length < quizQuestions.length}
                      className={`px-6 py-3 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm ${
                        Object.keys(quizAnswers).length < quizQuestions.length 
                          ? 'opacity-50 cursor-not-allowed' 
                          : ''
                      }`}
                    >
                      Submit Quiz
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className={`mx-auto flex items-center justify-center h-16 w-16 rounded-full ${
                    quizScore && quizScore >= 80 ? 'bg-emerald-100' : 'bg-red-100'
                  } mb-6`}>
                    {quizScore && quizScore >= 80 ? (
                      <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                    ) : (
                      <X className="h-8 w-8 text-red-600" />
                    )}
                  </div>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                    {quizScore && quizScore >= 80 ? 'Quiz Passed!' : 'Quiz Not Passed'}
                  </h3>
                  <p className="text-gray-600 mb-6">
                    Your score: <span className={`font-semibold ${
                      quizScore && quizScore >= 80 ? 'text-emerald-600' : 'text-red-600'
                    }`}>{quizScore}%</span> {quizScore && quizScore >= 80 ? 
                    '— Well done!' : '— Minimum passing score is 80%'}
                  </p>
                  <div className="flex justify-center gap-4">
                    {quizScore && quizScore < 80 ? (
                      <button
                        onClick={() => {
                          setQuizSubmitted(false);
                          setQuizAnswers({});
                        }}
                        className="px-6 py-3 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                      >
                        Try Again
                      </button>
                    ) : (
                      <button
                        onClick={() => setCurrentDocument(null)}
                        className="px-6 py-3 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors shadow-sm"
                      >
                        Continue Training
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Navigation between documents */}
          <div className="flex flex-col md:flex-row justify-between gap-4 border-t border-gray-200 pt-8 mt-8">
            {getAdjacentDocuments().prev ? (
              <button
                onClick={() => handleSelectDocument(getAdjacentDocuments().prev!)}
                className="flex-1 flex items-center justify-start px-6 py-3 border border-gray-300 shadow-sm text-xs font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft className="h-5 w-5 mr-2" />
                <div className="text-left">
                  <div className="text-xs text-gray-500">Previous</div>
                  <div className="font-medium truncate max-w-xs">{getAdjacentDocuments().prev?.title}</div>
                </div>
              </button>
            ) : (
              <div className="flex-1"></div>
            )}

            {getAdjacentDocuments().next ? (
              <button
                onClick={() => handleSelectDocument(getAdjacentDocuments().next!)}
                className="flex-1 flex items-center justify-end px-6 py-3 border border-gray-300 shadow-sm text-xs font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                <div className="text-right">
                  <div className="text-xs text-gray-500">Next</div>
                  <div className="font-medium truncate max-w-xs">{getAdjacentDocuments().next?.title}</div>
                </div>
                <ChevronRight className="h-5 w-5 ml-2" />
              </button>
            ) : (
              <button
                onClick={() => setCurrentDocument(null)}
                className="flex-1 flex items-center justify-center px-6 py-3 border border-transparent text-xs font-medium rounded-lg shadow-sm text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
              >
                Finish Section
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Render main training dashboard
  return (
    <div className="space-y-8">
      {/* Progress overview */}
      <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-100">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">Training Progress</h2>
            <p className="text-gray-600 mt-1">
              Complete all required training materials to advance
            </p>
          </div>
          <div className="w-full md:w-80">
            <div className="flex justify-between text-xs text-gray-600 mb-2">
              <span className="font-medium">Overall completion</span>
              <span className="font-semibold">{overallProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-emerald-600 h-3 rounded-full" 
                style={{ width: `${overallProgress}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mt-8">
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-blue-100 text-blue-600 mr-4">
                <Bookmark className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Total Materials</p>
                <p className="text-2xl font-semibold text-gray-900">{documents.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-emerald-100 text-emerald-600 mr-4">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Completed</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {Object.values(progress).filter(p => p.completed).length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-amber-100 text-amber-600 mr-4">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Videos</p>
                <p className="text-2xl font-semibold text-gray-900">{videoCount}</p>
              </div>
            </div>
          </div>
          <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center">
              <div className="p-3 rounded-lg bg-purple-100 text-purple-600 mr-4">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Documents</p>
                <p className="text-2xl font-semibold text-gray-900">{documentCount}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <input
                type="text"
                placeholder="Search training materials..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'all' 
                  ? 'bg-emerald-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All ({documents.length})
            </button>
            <button
              onClick={() => setActiveTab('videos')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 ${
                activeTab === 'videos' 
                  ? 'bg-red-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Video className="h-4 w-4" />
              Videos ({videoCount})
            </button>
            <button
              onClick={() => setActiveTab('documents')}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 ${
                activeTab === 'documents' 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <FileText className="h-4 w-4" />
              Documents ({documentCount})
            </button>
          </div>
        </div>
      </div>

      {/* Category tabs */}
      {categories.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px overflow-x-auto">
              <button
                onClick={() => setActiveCategory(null)}
                className={`whitespace-nowrap py-5 px-6 border-b-2 font-medium text-xs flex items-center ${
                  !activeCategory
                    ? 'border-emerald-500 text-emerald-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <BarChart2 className="h-5 w-5 mr-2" />
                All Categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`whitespace-nowrap py-5 px-6 border-b-2 font-medium text-xs flex items-center transition-colors ${
                    activeCategory === cat.id
                      ? `${cat.color} border-${cat.color.split('-')[1]}-500`
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <span className={cat.color}>{cat.icon}</span>
                  <span className="ml-2">{cat.name}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Training materials list */}
      {filteredDocuments.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-200">
          <BookOpen className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900">No training materials found</h3>
          <p className="mt-2 text-xs text-gray-500">
            {documents.length === 0 
              ? "No training materials have been added yet." 
              : "No materials match your current filters."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDocuments.map((document) => {
            const isCompleted = progress[document.id]?.completed;
            const isLocked = document.required && 
              documents.some(d => d.required && d.order < document.order && !progress[d.id]?.completed);
            const category = categories.find(c => c.name === document.category);
            const progressPercentage = calculateProgressPercentage(document.id);
            const isVideo = isVideoFile(document.file_type);
            const fileTypeBadge = getFileTypeBadge(document.file_type);

            return (
              <motion.div 
                key={document.id}
                whileHover={{ y: -4 }}
                className={`bg-white rounded-xl shadow-sm overflow-hidden border ${
                  isCompleted ? 'border-emerald-200' : 'border-gray-200'
                } hover:shadow-md transition-shadow`}
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2 rounded-lg ${
                      isCompleted 
                        ? 'bg-emerald-100 text-emerald-600' 
                        : isLocked
                          ? 'bg-gray-100 text-gray-400'
                          : category?.bgColor + ' ' + category?.color
                    }`}>
                      {getFileIcon(document.file_type)}
                    </div>
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${fileTypeBadge.color}`}>
                      {fileTypeBadge.text}
                    </span>
                  </div>
                  
                  <div className="flex-1">
                    <h3 className={`text-lg font-semibold ${
                      isCompleted ? 'text-emerald-800' : 'text-gray-900'
                    }`}>
                      {document.title}
                    </h3>
                    <p className="text-xs text-gray-600 mt-1 line-clamp-2">{document.description}</p>
                    <div className="flex items-center mt-3 space-x-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        {formatFileSize(document.file_size)}
                      </span>
                      {document.required && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          Required
                        </span>
                      )}
                      {document.quiz_required && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Quiz
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="flex justify-between text-xs text-gray-600 mb-1.5">
                      <span>Progress</span>
                      <span className="font-medium">{progressPercentage}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div 
                        className={`h-1.5 rounded-full ${
                          isCompleted ? 'bg-emerald-600' : 'bg-blue-600'
                        }`} 
                        style={{ width: `${progressPercentage}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <button
                      onClick={() => !isLocked && handleSelectDocument(document)}
                      disabled={isLocked}
                      className={`w-full flex justify-center items-center px-4 py-2.5 border ${
                        isLocked
                          ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                          : isCompleted
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : isVideo
                              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                      } rounded-lg text-xs font-medium transition-colors`}
                    >
                      {isLocked ? (
                        <>
                          <Lock className="h-4 w-4 mr-2" />
                          Complete previous materials
                        </>
                      ) : isCompleted ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Review Again
                        </>
                      ) : isVideo ? (
                        <>
                          <PlayCircle className="h-4 w-4 mr-2" />
                          Watch Video
                        </>
                      ) : (
                        <>
                          <BookOpen className="h-4 w-4 mr-2" />
                          {progress[document.id]?.time_spent ? 'Continue' : 'Start'}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Completion certificate (visible when all required documents are done) */}
      {documents.length > 0 && 
       documents.filter(d => d.required).length === 
       Object.values(progress).filter(p => p.completed).length && (
        <div className="bg-gradient-to-r from-emerald-50 to-blue-50 rounded-xl shadow-lg p-8 border border-emerald-200">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="flex-1">
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Training Complete! 🎉</h2>
              <p className="text-gray-600">
                Congratulations on completing all required training materials. Download your certificate below.
              </p>
            </div>
            <div>
              <button className="inline-flex items-center px-6 py-3 border border-transparent text-xs font-medium rounded-lg shadow-sm text-white bg-emerald-600 hover:bg-emerald-700 transition-colors">
                <Award className="h-5 w-5 mr-2" />
                Download Certificate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TrainingModule;