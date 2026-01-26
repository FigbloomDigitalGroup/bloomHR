import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from '@lukeed/uuid';
import {
  UploadCloud,
  X,
  CheckCircle2,
  Film,
  Image,
  Clock,
  FileText,
  Lock,
  AlertCircle,
  ChevronDown,
  File,
  BookOpen
} from 'lucide-react';
import toast from 'react-hot-toast';

// Types
type ContentCategory = 'introduction' | 'product' | 'safety' | 'compliance' | 'soft-skills';
type ContentType = 'video' | 'document';

type VideoFormData = {
  title: string;
  description: string;
  category: ContentCategory;
  duration: string; // HH:MM:SS format
  required: boolean;
  order: number;
  quiz_required: boolean;
};

type DocumentFormData = {
  title: string;
  description: string;
  category: ContentCategory;
  required: boolean;
  order: number;
  quiz_required: boolean;
};

const AdminVideoUpload = () => {
  const [contentType, setContentType] = useState<ContentType>('video');
  const [videoFormData, setVideoFormData] = useState<VideoFormData>({
    title: '',
    description: '',
    category: 'introduction',
    duration: '00:10:00', // Default 10 minutes
    required: true,
    order: 1,
    quiz_required: true
  });
  const [documentFormData, setDocumentFormData] = useState<DocumentFormData>({
    title: '',
    description: '',
    category: 'introduction',
    required: true,
    order: 1,
    quiz_required: false
  });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null);
  const [existingVideos, setExistingVideos] = useState<any[]>([]);
  const [existingDocuments, setExistingDocuments] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Fetch existing content to determine next order number
  useEffect(() => {
    const fetchContent = async () => {
      // Fetch videos
      const { data: videosData, error: videosError } = await supabase
        .from('training_videos')
        .select('*')
        .order('order', { ascending: true });

      if (videosError) {
        console.error('Error fetching videos:', videosError);
        toast.error('Failed to load existing videos');
      } else {
        setExistingVideos(videosData || []);
      }

      // Fetch documents
      const { data: docsData, error: docsError } = await supabase
        .from('training_documents')
        .select('*')
        .order('order', { ascending: true });

      if (docsError) {
        console.error('Error fetching documents:', docsError);
      } else {
        setExistingDocuments(docsData || []);
      }

      // Set default order to next available number
      const allContent = [...(videosData || []), ...(docsData || [])];
      const maxOrder = allContent.length > 0 ? Math.max(...allContent.map(item => item.order)) : 0;
      
      setVideoFormData(prev => ({ ...prev, order: maxOrder + 1 }));
      setDocumentFormData(prev => ({ ...prev, order: maxOrder + 1 }));
    };

    fetchContent();
  }, []);

  // Handle video file selection
  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Validate video file (under 500MB and MP4/WebM)
      if (file.size > 500 * 1024 * 1024) {
        toast.error('Video file must be less than 500MB');
        return;
      }
      
      if (!['video/mp4', 'video/webm'].includes(file.type)) {
        toast.error('Only MP4 and WebM videos are supported');
        return;
      }

      setVideoFile(file);
      
      // Create preview URL
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      
      // Attempt to extract duration
      extractVideoDuration(file);
    }
  };

  // Handle document file selection
  const handleDocumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Validate document file (under 50MB and supported types)
      if (file.size > 50 * 1024 * 1024) {
        toast.error('Document file must be less than 50MB');
        return;
      }
      
      const supportedTypes = [
        'application/pdf',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      
      if (!supportedTypes.includes(file.type)) {
        toast.error('Only PDF, PPT, PPTX, DOC, and DOCX files are supported');
        return;
      }

      setDocumentFile(file);
    }
  };

  // Extract video duration using HTML5 video element
  const extractVideoDuration = (file: File) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      const duration = video.duration;
      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);
      const seconds = Math.floor(duration % 60);
      
      setVideoFormData(prev => ({
        ...prev,
        duration: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      }));
    };
    
    video.src = URL.createObjectURL(file);
  };

  // Handle thumbnail selection
  const handleThumbnailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Validate image file (under 5MB and JPG/PNG)
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Thumbnail must be less than 5MB');
        return;
      }
      
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        toast.error('Only JPG, PNG, and WebP images are supported');
        return;
      }

      setThumbnailFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setThumbnailPreview(e.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle form input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    
    if (contentType === 'video') {
      setVideoFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
      }));
    } else {
      setDocumentFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
      }));
    }
  };

  // Calculate duration in seconds
  const calculateDurationInSeconds = (durationString: string) => {
    const [hours, minutes, seconds] = durationString.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  };

  // Get file icon based on type
  const getFileIcon = (file: File) => {
    if (file.type.includes('pdf')) {
      return <FileText className="h-5 w-5 text-red-600" />;
    } else if (file.type.includes('presentation') || file.type.includes('powerpoint')) {
      return <FileText className="h-5 w-5 text-orange-600" />;
    } else if (file.type.includes('word')) {
      return <FileText className="h-5 w-5 text-blue-600" />;
    }
    return <FileText className="h-5 w-5 text-gray-600" />;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (contentType === 'video' && !videoFile) {
      toast.error('Please select a video file');
      return;
    }
    
    if (contentType === 'document' && !documentFile) {
      toast.error('Please select a document file');
      return;
    }

    const title = contentType === 'video' ? videoFormData.title : documentFormData.title;
    if (!title) {
      toast.error('Please enter a title');
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(0);

      // Generate unique filenames
      const contentId = uuidv4();
      
      if (contentType === 'video') {
        // Video upload logic
        const videoExt = videoFile!.name.split('.').pop();
        const videoPath = `${videoFormData.category}/${contentId}.${videoExt}`;
        
        let thumbnailPath = '';
        if (thumbnailFile) {
          const thumbExt = thumbnailFile.name.split('.').pop();
          thumbnailPath = `thumbnails/${contentId}.${thumbExt}`;
        }

        // Upload video file
        const { data: videoData, error: videoError } = await supabase.storage
          .from('training-videos')
          .upload(videoPath, videoFile!, {
            cacheControl: '3600',
            upsert: false,
            contentType: videoFile!.type
          });

        if (videoError) throw videoError;

        // Upload thumbnail if provided
        if (thumbnailFile) {
          const { error: thumbError } = await supabase.storage
            .from('training-videos')
            .upload(thumbnailPath, thumbnailFile, {
              cacheControl: '3600',
              upsert: false,
              contentType: thumbnailFile.type
            });

          if (thumbError) throw thumbError;
        }

        // Get public URLs
        const { data: videoUrlData } = supabase
          .storage
          .from('training-videos')
          .getPublicUrl(videoPath);
        
        const thumbnailUrl = thumbnailFile 
          ? supabase.storage
              .from('training-videos')
              .getPublicUrl(thumbnailPath).data.publicUrl
          : null;

        // Insert video record into database
        const { error: dbError } = await supabase
          .from('training_videos')
          .insert([{
            id: contentId,
            title: videoFormData.title,
            description: videoFormData.description,
            url: videoUrlData.publicUrl,
            duration: calculateDurationInSeconds(videoFormData.duration),
            required: videoFormData.required,
            order: videoFormData.order,
            category: videoFormData.category,
            thumbnail_url: thumbnailUrl,
            quiz_required: videoFormData.quiz_required
          }]);

        if (dbError) throw dbError;

      } else {
        // Document upload logic
        const docExt = documentFile!.name.split('.').pop();
        const docPath = `documents/${contentId}.${docExt}`;

        // Upload document file
        const { data: docData, error: docError } = await supabase.storage
          .from('training-documents')
          .upload(docPath, documentFile!, {
            cacheControl: '3600',
            upsert: false,
            contentType: documentFile!.type
          });

        if (docError) throw docError;

        // Get public URL
        const { data: docUrlData } = supabase
          .storage
          .from('training-documents')
          .getPublicUrl(docPath);

        // Insert document record into database
        const { error: dbError } = await supabase
          .from('training_documents')
          .insert([{
            id: contentId,
            title: documentFormData.title,
            description: documentFormData.description,
            url: docUrlData.publicUrl,
            file_name: documentFile!.name,
            file_size: documentFile!.size,
            file_type: documentFile!.type,
            required: documentFormData.required,
            order: documentFormData.order,
            category: documentFormData.category,
            quiz_required: documentFormData.quiz_required
          }]);

        if (dbError) throw dbError;
      }

      toast.success(`${contentType === 'video' ? 'Video' : 'Document'} uploaded successfully!`);
      navigate('/training');

    } catch (error) {
      console.error('Upload error:', error);
      toast.error(`Failed to upload ${contentType}`);
    } finally {
      setIsUploading(false);
    }
  };

  // Reset form
  const resetForm = () => {
    const allContent = [...existingVideos, ...existingDocuments];
    const maxOrder = allContent.length > 0 ? Math.max(...allContent.map(item => item.order)) : 0;
    
    setVideoFormData({
      title: '',
      description: '',
      category: 'introduction',
      duration: '00:10:00',
      required: true,
      order: maxOrder + 1,
      quiz_required: true
    });
    
    setDocumentFormData({
      title: '',
      description: '',
      category: 'introduction',
      required: true,
      order: maxOrder + 1,
      quiz_required: false
    });
    
    setVideoFile(null);
    setDocumentFile(null);
    setThumbnailFile(null);
    setPreviewUrl(null);
    setThumbnailPreview(null);
    setUploadProgress(0);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (documentInputRef.current) documentInputRef.current.value = '';
    if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
  };

  const currentFormData = contentType === 'video' ? videoFormData : documentFormData;

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
        {/* Header */}
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h1 className="text-xl font-medium text-gray-900 flex items-center">
            <BookOpen className="h-5 w-5 mr-2 text-blue-500" />
            Upload Training Content
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Add new training videos or documents to the staff portal
          </p>
        </div>

        {/* Content Type Selector */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={() => setContentType('video')}
              className={`flex items-center px-4 py-2 rounded-md text-sm font-medium ${
                contentType === 'video'
                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              <Film className="h-4 w-4 mr-2" />
              Video Content
            </button>
            <button
              type="button"
              onClick={() => setContentType('document')}
              className={`flex items-center px-4 py-2 rounded-md text-sm font-medium ${
                contentType === 'document'
                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              <FileText className="h-4 w-4 mr-2" />
              Document Content
            </button>
          </div>
        </div>

        {/* Main form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* File Upload Section */}
          <div className="space-y-4">
            {contentType === 'video' ? (
              <>
                {/* Video Upload */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Video File <span className="text-red-500">*</span>
                  </label>
                  
                  {!videoFile ? (
                    <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                      <div className="space-y-1 text-center">
                        <div className="flex text-xs text-gray-600 justify-center">
                          <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none">
                            <span>Upload a video file</span>
                            <input
                              ref={fileInputRef}
                              id="video-upload"
                              name="video-upload"
                              type="file"
                              accept="video/mp4,video/webm"
                              className="sr-only"
                              onChange={handleVideoChange}
                            />
                          </label>
                          <p className="pl-1">or drag and drop</p>
                        </div>
                        <p className="text-xs text-gray-500">
                          MP4 or WebM up to 500MB
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 rounded-md border border-gray-200 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className="bg-blue-100 p-2 rounded-lg">
                            <Film className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-900 truncate max-w-xs">
                              {videoFile.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setVideoFile(null);
                            setPreviewUrl(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="text-gray-400 hover:text-gray-500"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      
                      {previewUrl && (
                        <div className="mt-4">
                          <div className="aspect-w-16 aspect-h-9 bg-black rounded-md overflow-hidden">
                            <video
                              src={previewUrl}
                              controls
                              className="w-full h-48 object-contain bg-black"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Thumbnail Upload */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Thumbnail Image (Optional)
                  </label>
                  
                  {!thumbnailFile ? (
                    <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                      <div className="space-y-1 text-center">
                        <div className="flex text-xs text-gray-600 justify-center">
                          <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none">
                            <span>Upload a thumbnail</span>
                            <input
                              ref={thumbnailInputRef}
                              id="thumbnail-upload"
                              name="thumbnail-upload"
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="sr-only"
                              onChange={handleThumbnailChange}
                            />
                          </label>
                          <p className="pl-1">or drag and drop</p>
                        </div>
                        <p className="text-xs text-gray-500">
                          JPG, PNG, or WebP up to 5MB
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 rounded-md border border-gray-200 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <div className="bg-purple-100 p-2 rounded-lg">
                            <Image className="h-5 w-5 text-purple-600" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-900 truncate max-w-xs">
                              {thumbnailFile.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {(thumbnailFile.size / (1024 * 1024)).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setThumbnailFile(null);
                            setThumbnailPreview(null);
                            if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
                          }}
                          className="text-gray-400 hover:text-gray-500"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      
                      {thumbnailPreview && (
                        <div className="mt-4">
                          <img
                            src={thumbnailPreview}
                            alt="Thumbnail preview"
                            className="h-32 object-cover rounded-md"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Document Upload */
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Document File <span className="text-red-500">*</span>
                </label>
                
                {!documentFile ? (
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                    <div className="space-y-1 text-center">
                      <div className="flex text-xs text-gray-600 justify-center">
                        <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none">
                          <span>Upload a document</span>
                          <input
                            ref={documentInputRef}
                            id="document-upload"
                            name="document-upload"
                            type="file"
                            accept=".pdf,.ppt,.pptx,.doc,.docx"
                            className="sr-only"
                            onChange={handleDocumentChange}
                          />
                        </label>
                        <p className="pl-1">or drag and drop</p>
                      </div>
                      <p className="text-xs text-gray-500">
                        PDF, PPT, PPTX, DOC, DOCX up to 50MB
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 rounded-md border border-gray-200 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="bg-green-100 p-2 rounded-lg">
                          {getFileIcon(documentFile)}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-900 truncate max-w-xs">
                            {documentFile.name}
                          </p>
                          <p className="text-xs text-gray-500">
                            {(documentFile.size / (1024 * 1024)).toFixed(2)} MB • {documentFile.type.split('/')[1].toUpperCase()}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentFile(null);
                          if (documentInputRef.current) documentInputRef.current.value = '';
                        }}
                        className="text-gray-400 hover:text-gray-500"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Progress bar */}
          {isUploading && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full"
                  style={{ width: `${uploadProgress}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* Content Details Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="title" className="block text-xs font-medium text-gray-700 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={currentFormData.title}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            <div>
              <label htmlFor="category" className="block text-xs font-medium text-gray-700 mb-1">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                id="category"
                name="category"
                value={currentFormData.category}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="introduction">Introduction</option>
                <option value="product">Product Training</option>
                <option value="safety">Safety Procedures</option>
                <option value="compliance">Compliance</option>
                <option value="soft-skills">Soft Skills</option>
              </select>
            </div>

            {contentType === 'video' && (
              <div>
                <label htmlFor="duration" className="block text-xs font-medium text-gray-700 mb-1">
                  Duration (HH:MM:SS)
                </label>
                <input
                  type="text"
                  id="duration"
                  name="duration"
                  value={videoFormData.duration}
                  onChange={handleInputChange}
                  pattern="^([0-1][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])$"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                  placeholder="00:10:00"
                />
              </div>
            )}

            <div>
              <label htmlFor="order" className="block text-xs font-medium text-gray-700 mb-1">
                Display Order
              </label>
              <input
                type="number"
                id="order"
                name="order"
                min="1"
                value={currentFormData.order}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center">
                <input
                  id="required"
                  name="required"
                  type="checkbox"
                  checked={currentFormData.required}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="required" className="ml-2 block text-xs text-gray-700">
                  Required Training
                </label>
              </div>

              <div className="flex items-center">
                <input
                  id="quiz_required"
                  name="quiz_required"
                  type="checkbox"
                  checked={currentFormData.quiz_required}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="quiz_required" className="ml-2 block text-xs text-gray-700">
                  Include Quiz
                </label>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-xs font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              rows={3}
              value={currentFormData.description}
              onChange={handleInputChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Form actions */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 border border-gray-300 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={isUploading || (contentType === 'video' ? !videoFile : !documentFile)}
              className={`px-4 py-2 border border-transparent rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 ${
                isUploading || (contentType === 'video' ? !videoFile : !documentFile) ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              {isUploading ? 'Uploading...' : `Upload ${contentType === 'video' ? 'Video' : 'Document'}`}
            </button>
          </div>
        </form>
      </div>

      {/* Existing content reference */}
      <div className="mt-8 bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900 flex items-center">
            <FileText className="h-5 w-5 mr-2 text-gray-500" />
            Existing Content Reference
          </h2>
        </div>
        <div className="p-6">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Order
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {contentType === 'video' ? 'Duration' : 'File Type'}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Required
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {[...existingVideos, ...existingDocuments]
                  .sort((a, b) => a.order - b.order)
                  .map((item) => (
                    <tr key={item.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-xs font-medium text-gray-900">
                        <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                          item.url?.includes('/training-videos/') 
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {item.url?.includes('/training-videos/') ? 'Video' : 'Document'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs font-medium text-gray-900">
                        {item.order}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-900">
                        {item.title}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500 capitalize">
                        {item.category.replace('-', ' ')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                        {item.duration ? (
                          `${Math.floor(item.duration / 3600)}h ${Math.floor((item.duration % 3600) / 60)}m`
                        ) : (
                          item.file_type?.split('/')[1].toUpperCase() || 'Document'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-500">
                        {item.required ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                            No
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminVideoUpload;