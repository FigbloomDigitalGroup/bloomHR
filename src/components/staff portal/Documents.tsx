import { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { 
  Upload, 
  FileText, 
  Image, 
  File, 
  X, 
  CheckCircle, 
  AlertCircle,
  Eye, 
  Download, 
  Trash2, 
  RefreshCw,
  Calendar,
  FolderOpen,
  Plus,
  Newspaper,
  Check,
  Ban,
  Square
} from 'lucide-react';

const DocumentsManager = () => {
  const [activeTab, setActiveTab] = useState('upload');
  const [user, setUser] = useState<any>(null);
  const [employeeNumber, setEmployeeNumber] = useState('');
  
  // Upload states
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadStatus, setUploadStatus] = useState<Record<string, any>>({});
  const [uploadControllers, setUploadControllers] = useState<Record<string, AbortController>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  
  // Viewer states
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);

  // Document types configuration
  const documentTypes = [
    { id: 'id_front', label: 'Kenyan ID Front', accept: '.jpg,.jpeg' },
    { id: 'id_back', label: 'Kenyan ID Back', accept: '.jpg,.jpeg' },
    { id: 'kra_pin', label: 'KRA PIN Certificate/ Tax Exemption', accept: '.jpg,.jpeg' },
    { id: 'nssf', label: 'NSSF Card', accept: '.jpg,.jpeg' },
    { id: 'nhif', label: 'NHIF Card', accept: '.jpg,.jpeg' },
    { id: 'cv', label: 'CV/Resume', accept: '.pdf,.doc,.docx' },
    { id: 'certificates', label: 'Certificates', accept: 'image/*,.pdf,.doc,.docx' },
  ];

  const documentLabels = documentTypes.reduce((acc, doc) => {
    acc[doc.id] = doc.label;
    return acc;
  }, {} as Record<string, string>);

  const [files, setFiles] = useState(
    documentTypes.reduce((acc, doc) => {
      acc[doc.id] = null;
      return acc;
    }, {} as Record<string, File | null>)
  );

  // Track which document types are already uploaded and their file names
  const [uploadedDocuments, setUploadedDocuments] = useState<Record<string, string>>({});

  // Get current user and employee number
  useEffect(() => {
    const getCurrentUser = async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) {
          console.error('Error getting user:', error);
        } else {
          setUser(user);
          
          // For demo purposes, use email as employee number
          if (user?.email) {
            setEmployeeNumber(user.email.split('@')[0]);
          }
        }
      } catch (error) {
        console.error('Error in getCurrentUser:', error);
      }
    };

    getCurrentUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setUser(session?.user ?? null);
      
      // For demo purposes, use email as employee number
      if (session?.user?.email) {
        setEmployeeNumber(session.user.email.split('@')[0]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch documents when switching to view tab or when user/employee number changes
  useEffect(() => {
    if (employeeNumber) {
      fetchDocuments();
    }
  }, [employeeNumber, activeTab]);

  // Update uploaded document types when documents change
  useEffect(() => {
    const uploadedDocs: Record<string, string> = {};
    documents.forEach(doc => {
      // Extract document type from filename (format: type_timestamp.extension)
      const docType = doc.name.split('_')[0];
      if (documentTypes.find(dt => dt.id === docType)) {
        uploadedDocs[docType] = doc.name;
      }
    });
    setUploadedDocuments(uploadedDocs);
  }, [documents]);

  // IMPROVED UPLOAD FUNCTIONS
  const handleFileSelect = (documentType: string, selectedFile: File | null) => {
    if (!selectedFile) return;
    
    // Prevent upload if document type is already uploaded
    if (uploadedDocuments[documentType]) {
      setUploadStatus(prev => ({
        ...prev,
        [documentType]: { 
          status: 'error', 
          message: 'This document type is already uploaded. Delete the existing one to upload a new version.' 
        }
      }));
      return;
    }
    
    const docConfig = documentTypes.find(doc => doc.id === documentType);
    const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase();
    const acceptedTypes = docConfig?.accept.split(',').map(type => type.trim().toLowerCase()) || [];
    
    const isValidType = acceptedTypes.some(type => {
      if (type === 'image/*') return selectedFile.type.startsWith('image/');
      if (type.startsWith('.')) return `.${fileExtension}` === type;
      return selectedFile.type.includes(type);
    });

    if (!isValidType) {
      setUploadStatus(prev => ({
        ...prev,
        [documentType]: { status: 'error', message: `Invalid file type. Accepted: ${docConfig?.accept}` }
      }));
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      setUploadStatus(prev => ({
        ...prev,
        [documentType]: { status: 'error', message: 'File size too large. Max 5MB allowed.' }
      }));
      return;
    }

    setFiles(prev => ({ ...prev, [documentType]: selectedFile }));
    setUploadStatus(prev => ({ ...prev, [documentType]: { status: 'idle' } }));
    setUploadProgress(prev => ({ ...prev, [documentType]: 0 }));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.add('border-blue-400');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-blue-400');
  };

  const handleDrop = (e: React.DragEvent, documentType: string) => {
    e.preventDefault();
    e.currentTarget.classList.remove('border-blue-400');
    
    // Prevent drop if document type is already uploaded
    if (uploadedDocuments[documentType]) {
      setUploadStatus(prev => ({
        ...prev,
        [documentType]: { 
          status: 'error', 
          message: 'This document type is already uploaded. Delete the existing one to upload a new version.' 
        }
      }));
      return;
    }
    
    const droppedFile = e.dataTransfer.files[0];
    handleFileSelect(documentType, droppedFile);
  };

  // Improved upload function with retry mechanism and better error handling
  const uploadFileWithRetry = async (documentType: string, file: File, maxRetries = 3) => {
    if (!file || !employeeNumber) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${employeeNumber}/${documentType}_${Date.now()}.${fileExt}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create abort controller for this upload
        const controller = new AbortController();
        setUploadControllers(prev => ({ ...prev, [documentType]: controller }));

        // Set initial progress
        setUploadProgress(prev => ({ ...prev, [documentType]: 0 }));

        const { data, error } = await supabase.storage
          .from('documents')
          .upload(fileName, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type,
            signal: controller.signal
          });

        if (error) {
          if (error.name === 'AbortError') {
            throw new Error('Upload cancelled');
          }
          throw new Error(error.message || 'Failed to upload file to storage');
        }

        const { data: urlData } = supabase.storage
          .from('documents')
          .getPublicUrl(fileName);

        // Set complete progress
        setUploadProgress(prev => ({ ...prev, [documentType]: 100 }));

        return { ...data, publicUrl: urlData.publicUrl, path: fileName };

      } catch (error: any) {
        console.error(`Upload attempt ${attempt} failed for ${documentType}:`, error);
        
        if (error.message === 'Upload cancelled') {
          throw error;
        }

        if (attempt === maxRetries) {
          throw new Error(`Upload failed after ${maxRetries} attempts: ${error.message}`);
        }

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        
        setUploadStatus(prev => ({
          ...prev,
          [documentType]: { 
            status: 'retrying', 
            message: `Retrying upload (${attempt}/${maxRetries})...` 
          }
        }));
      } finally {
        // Clean up controller
        setUploadControllers(prev => {
          const newControllers = { ...prev };
          delete newControllers[documentType];
          return newControllers;
        });
      }
    }
  };

  // Parallel upload with concurrency control
  const handleUpload = async () => {
    if (!employeeNumber) {
      alert('Employee information not available. Please log in again.');
      return;
    }

    setUploading(true);
    const filesToUpload = Object.entries(files).filter(([docType, file]) => 
      file && !uploadedDocuments[docType]
    );

    if (filesToUpload.length === 0) {
      setUploading(false);
      return;
    }

    // Process uploads with limited concurrency (2 at a time to avoid overwhelming the server)
    const concurrencyLimit = 2;
    const results = [];
    let hasErrors = false;

    for (let i = 0; i < filesToUpload.length; i += concurrencyLimit) {
      const batch = filesToUpload.slice(i, i + concurrencyLimit);
      
      const batchPromises = batch.map(async ([docType, file]) => {
        try {
          setUploadStatus(prev => ({
            ...prev,
            [docType]: { status: 'uploading', message: 'Uploading...' }
          }));

          const result = await uploadFileWithRetry(docType, file!);
          
          setUploadStatus(prev => ({
            ...prev,
            [docType]: { status: 'success', message: 'Upload successful!' }
          }));

          return { docType, result, success: true };
        } catch (error: any) {
          console.error(`Error uploading ${docType}:`, error);
          
          setUploadStatus(prev => ({
            ...prev,
            [docType]: { 
              status: 'error', 
              message: error.message || 'Failed to upload file' 
            }
          }));

          hasErrors = true;
          return { docType, error, success: false };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    setUploading(false);
    
    const successfulUploads = results.filter(r => r.success).length;
    const failedUploads = results.filter(r => !r.success).length;
    
    if (successfulUploads > 0 && failedUploads === 0) {
      alert(`All ${successfulUploads} documents uploaded successfully!`);
      resetUploadForm();
      fetchDocuments();
    } else if (successfulUploads > 0 && failedUploads > 0) {
      alert(`${successfulUploads} documents uploaded successfully, ${failedUploads} failed. Please check the errors and try again.`);
      // Only reset successful uploads
      results.forEach(result => {
        if (result.success) {
          setFiles(prev => ({ ...prev, [result.docType]: null }));
          if (fileInputRefs.current[result.docType]) {
            fileInputRefs.current[result.docType]!.value = '';
          }
        }
      });
      fetchDocuments();
    } else if (failedUploads > 0) {
      alert('All uploads failed. Please check your internet connection and try again.');
    }
  };

  // Cancel upload function
  const cancelUpload = (documentType: string) => {
    const controller = uploadControllers[documentType];
    if (controller) {
      controller.abort();
      setUploadStatus(prev => ({
        ...prev,
        [documentType]: { status: 'cancelled', message: 'Upload cancelled' }
      }));
    }
  };

  // Cancel all uploads
  const cancelAllUploads = () => {
    Object.values(uploadControllers).forEach(controller => {
      if (controller) {
        controller.abort();
      }
    });
    
    setUploading(false);
    setUploadControllers({});
    
    // Reset status for uploading files
    const newStatus: Record<string, any> = {};
    Object.keys(uploadStatus).forEach(docType => {
      if (uploadStatus[docType]?.status === 'uploading' || uploadStatus[docType]?.status === 'retrying') {
        newStatus[docType] = { status: 'cancelled', message: 'Upload cancelled' };
      } else {
        newStatus[docType] = uploadStatus[docType];
      }
    });
    setUploadStatus(newStatus);
  };

  const resetUploadForm = () => {
    setFiles(documentTypes.reduce((acc, doc) => {
      acc[doc.id] = null;
      return acc;
    }, {} as Record<string, File | null>));
    
    setUploadProgress({});
    setUploadStatus({});
    
    Object.keys(fileInputRefs.current).forEach(key => {
      if (fileInputRefs.current[key]) {
        fileInputRefs.current[key]!.value = '';
      }
    });
  };

  const removeFile = (documentType: string) => {
    // Don't allow removing files for already uploaded document types
    if (uploadedDocuments[documentType]) {
      setUploadStatus(prev => ({
        ...prev,
        [documentType]: { 
          status: 'error', 
          message: 'Cannot remove - document already uploaded. Delete from "View Documents" tab to replace.' 
        }
      }));
      return;
    }
    
    // Cancel upload if in progress
    if (uploadStatus[documentType]?.status === 'uploading') {
      cancelUpload(documentType);
    }
    
    setFiles(prev => ({ ...prev, [documentType]: null }));
    setUploadStatus(prev => ({ ...prev, [documentType]: { status: 'idle' } }));
    setUploadProgress(prev => ({ ...prev, [documentType]: 0 }));
    
    if (fileInputRefs.current[documentType]) {
      fileInputRefs.current[documentType]!.value = '';
    }
  };

  // VIEWER FUNCTIONS
  const fetchDocuments = async () => {
    if (!employeeNumber) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .list(employeeNumber, {
          limit: 100,
          offset: 0,
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) {
        console.error('Error fetching documents:', error);
        return;
      }

      const documentsWithUrls = await Promise.all(
        data.map(async (doc) => {
          const fullPath = `${employeeNumber}/${doc.name}`;
          const { data: urlData } = supabase.storage
            .from('documents')
            .getPublicUrl(fullPath);
          
          // Extract document type from filename
          const docType = doc.name.split('_')[0];
          
          return {
            ...doc,
            fullPath,
            publicUrl: urlData.publicUrl,
            type: docType,
            label: documentLabels[docType] || docType,
            fileType: getFileType(doc.name),
            formattedSize: formatFileSize(doc.metadata?.size || 0),
            uploadDate: new Date(doc.created_at).toLocaleDateString()
          };
        })
      );

      setDocuments(documentsWithUrls);
    } catch (error) {
      console.error('Error in fetchDocuments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFileType = (filename: string) => {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension || '')) return 'image';
    if (extension === 'pdf') return 'pdf';
    return 'document';
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileIcon = (file: File | null, fileType?: string) => {
    if (file) {
      if (file.type?.startsWith('image/')) return <Image size={24} className="text-blue-500" />;
      if (file.type === 'application/pdf') return <FileText size={24} className="text-red-500" />;
      return <File size={24} className="text-gray-500" />;
    }
    
    switch (fileType) {
      case 'image':
        return <Image size={24} className="text-blue-500" />;
      case 'pdf':
        return <FileText size={24} className="text-red-500" />;
      default:
        return <File size={24} className="text-gray-500" />;
    }
  };

  const handleView = (doc: any) => {
    setSelectedDoc(doc);
    setShowModal(true);
  };

  const handleDownload = async (doc: any) => {
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .download(doc.fullPath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Failed to download file');
    }
  };

  const handleDelete = async (doc: any) => {
    if (!confirm(`Are you sure you want to delete ${doc.name}?`)) return;

    setDeleting(prev => ({ ...prev, [doc.name]: true }));

    try {
      const { error } = await supabase.storage
        .from('documents')
        .remove([doc.fullPath]);

      if (error) throw error;

      await fetchDocuments();
      alert('File deleted successfully');
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Failed to delete file');
    } finally {
      setDeleting(prev => ({ ...prev, [doc.name]: false }));
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedDoc(null);
  };

  const hasFilesToUpload = Object.values(files).some(file => file !== null);
  const hasActiveUploads = Object.values(uploadStatus).some(status => 
    status?.status === 'uploading' || status?.status === 'retrying'
  );

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <AlertCircle className="mx-auto mb-4 text-yellow-600" size={48} />
          <h2 className="text-xl font-semibold text-yellow-800 mb-2">Authentication Required</h2>
          <p className="text-yellow-700">Please log in to manage your documents.</p>
        </div>
      </div>
    );
  }

  if (!employeeNumber) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
          <AlertCircle className="mx-auto mb-4 text-yellow-600" size={48} />
          <h2 className="text-xl font-semibold text-yellow-800 mb-2">Employee Information Missing</h2>
          <p className="text-yellow-700">Unable to retrieve your employee information. Please contact support.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Tab Navigation */}
      <div className="mb-8">
        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'upload'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <Plus size={16} />
            Upload Documents
          </button>
          <button
            onClick={() => setActiveTab('view')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              activeTab === 'view'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            <Newspaper size={16} />
            View Documents
          </button>
        </div>
      </div>

      {/* Upload Tab Content */}
      {activeTab === 'upload' && (
        <div>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-800 mb-2">Upload Your Documents</h1>
            <p className="text-gray-600">
              Please upload your documents for verification. The first five documents must be JPG/JPEG format.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {documentTypes.map((doc) => {
              const isUploaded = uploadedDocuments[doc.id];
              const status = uploadStatus[doc.id];
              const progress = uploadProgress[doc.id] || 0;
              const isUploading = status?.status === 'uploading' || status?.status === 'retrying';
              
              return (
                <div 
                  key={doc.id} 
                  className={`bg-white rounded-lg border p-4 ${isUploaded ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-700">{doc.label}</h3>
                    <div className="flex items-center gap-2">
                      {isUploaded && (
                        <div className="flex items-center gap-1 text-green-600">
                          <Check size={16} />
                          <span className="text-xs">Uploaded</span>
                        </div>
                      )}
                      {status?.status === 'success' && (
                        <CheckCircle size={16} className="text-green-500" />
                      )}
                      {status?.status === 'error' && (
                        <AlertCircle size={16} className="text-red-500" />
                      )}
                      {status?.status === 'cancelled' && (
                        <Ban size={16} className="text-orange-500" />
                      )}
                      {isUploading && (
                        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                      )}
                    </div>
                  </div>

                  {isUploaded ? (
                    <div className="text-center py-6 bg-green-100 rounded-lg">
                      <CheckCircle size={32} className="mx-auto mb-2 text-green-500" />
                      <p className="text-green-700 font-medium">Document already uploaded</p>
                      <p className="text-xs text-green-600 mt-1">
                        {uploadedDocuments[doc.id]}
                      </p>
                    </div>
                  ) : (
                    <div>
                      <div
                        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                          files[doc.id] 
                            ? 'border-green-300 bg-green-50' 
                            : 'border-gray-300 hover:border-blue-400'
                        }`}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, doc.id)}
                        onClick={() => fileInputRefs.current[doc.id]?.click()}
                      >
                        <input
                          ref={el => fileInputRefs.current[doc.id] = el}
                          type="file"
                          accept={doc.accept}
                          onChange={(e) => handleFileSelect(doc.id, e.target.files?.[0] || null)}
                          className="hidden"
                          disabled={!!isUploaded || uploading}
                        />

                        {files[doc.id] ? (
                          <div className="flex flex-col items-center">
                            <div className="text-blue-500 mb-2">
                              {getFileIcon(files[doc.id])}
                            </div>
                            <p className="text-xs font-medium text-gray-700 truncate max-w-full">
                              {files[doc.id]!.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {(files[doc.id]!.size / 1024).toFixed(1)} KB
                            </p>
                            
                            <div className="flex gap-2 mt-3">
                              {isUploading && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelUpload(doc.id);
                                  }}
                                  className="text-orange-500 hover:text-orange-700 text-xs flex items-center"
                                >
                                  <Square size={14} className="mr-1" /> Cancel
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFile(doc.id);
                                }}
                                disabled={isUploading || !!isUploaded}
                                className="text-red-500 hover:text-red-700 text-xs flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <X size={14} className="mr-1" /> Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={`py-4 ${isUploaded ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <Upload size={24} className="mx-auto mb-2 text-gray-400" />
                            <p className="text-xs text-gray-600">
                              {isUploaded ? 'Document already uploaded' : 'Drag & drop or click to upload'}
                            </p>
                            {!isUploaded && (
                              <p className="text-xs text-gray-500 mt-1">
                                Accepted Format: {doc.accept}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Progress bar for uploading files */}
                      {isUploading && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-gray-600 mb-1">
                            <span>{status?.message}</span>
                            <span>{progress}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${progress}%` }}
                            ></div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {status?.message && !isUploading && (
                    <p className={`text-xs mt-2 ${
                      status?.status === 'error' ? 'text-red-500' : 
                      status?.status === 'success' ? 'text-green-500' : 
                      status?.status === 'cancelled' ? 'text-orange-500' :
                      'text-blue-500'
                    }`}>
                      {status?.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex justify-between items-center">
            <div className="flex gap-2">
              {hasActiveUploads && (
                <button
                  type="button"
                  onClick={cancelAllUploads}
                  className="bg-orange-600 hover:bg-orange-700 text-white font-medium py-2 px-4 rounded-lg flex items-center"
                >
                  <Square size={16} className="mr-2" />
                  Cancel All
                </button>
              )}
              <button
                type="button"
                onClick={resetUploadForm}
                disabled={uploading}
                className="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset Form
              </button>
            </div>
            
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !hasFilesToUpload}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
            >
              {uploading ? (
                <>
                  <div className="animate-spin -ml-1 mr-2 h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                  Uploading...
                </>
              ) : (
                'Upload Documents'
              )}
            </button>
          </div>
        </div>
      )}

      {/* View Tab Content */}
      {activeTab === 'view' && (
        <div>
          <div className="mb-8 flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 mb-2">My Documents</h1>
              <p className="text-gray-600">
                View, download, and manage your uploaded documents
              </p>
            </div>
            <button
              onClick={fetchDocuments}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center gap-3">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-gray-600">Loading documents...</span>
              </div>
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <FolderOpen size={64} className="mx-auto mb-4 text-gray-300" />
              <h3 className="text-xl font-medium text-gray-500 mb-2">No documents found</h3>
              <p className="text-gray-400 mb-4">Upload some documents to get started</p>
              <button
                onClick={() => setActiveTab('upload')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Upload Documents
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {documents.map((doc) => {
                const isAlreadyUploaded = uploadedDocuments[doc.type] === doc.name;
                
                return (
                  <div key={doc.name} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {getFileIcon(null, doc.fileType)}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-800 truncate">
                            {doc.label}
                          </h3>
                          <p className="text-xs text-gray-500 truncate">
                            {doc.name}
                          </p>
                        </div>
                      </div>
                      {isAlreadyUploaded && (
                        <div className="flex items-center gap-1 text-green-600">
                          <Check size={16} />
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <Calendar size={14} />
                        <span>{doc.uploadDate}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <File size={14} />
                        <span>{doc.formattedSize}</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => handleView(doc)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                      >
                        <Eye size={14} />
                        View
                      </button>
                      <button
                        onClick={() => handleDownload(doc)}
                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs bg-green-50 text-green-600 rounded-lg hover:bg-green-100"
                      >
                        <Download size={14} />
                        Download
                      </button>
                      <button
                        onClick={() => handleDelete(doc)}
                        disabled={deleting[doc.name]}
                        className="flex items-center justify-center px-3 py-2 text-xs bg-red-50 text-red-600 rounded-lg hover:bg-red-100 disabled:opacity-50"
                      >
                        {deleting[doc.name] ? (
                          <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                    
                    {isAlreadyUploaded && (
                      <div className="mt-3 p-2 bg-blue-50 rounded-lg">
                        <p className="text-xs text-blue-700 text-center">
                          <strong>Note:</strong> Delete this document from here to upload a new version
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal for viewing documents */}
      {showModal && selectedDoc && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h3 className="font-semibold text-gray-800">{selectedDoc.label}</h3>
                <p className="text-xs text-gray-600">{selectedDoc.name}</p>
              </div>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={24} />
              </button>
            </div>
            
            <div className="p-4 overflow-auto max-h-[calc(90vh-120px)]">
              {selectedDoc.fileType === 'image' ? (
                <img
                  src={selectedDoc.publicUrl}
                  alt={selectedDoc.name}
                  className="max-w-full h-auto mx-auto rounded-lg"
                />
              ) : selectedDoc.fileType === 'pdf' ? (
                <iframe
                  src={selectedDoc.publicUrl}
                  className="w-full h-[600px] border rounded-lg"
                  title={selectedDoc.name}
                />
              ) : (
                <div className="text-center py-8">
                  <File size={64} className="mx-auto mb-4 text-gray-300" />
                  <p className="text-gray-600 mb-4">
                    Preview not available for this file type
                  </p>
                  <button
                    onClick={() => handleDownload(selectedDoc)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Download to View
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentsManager;