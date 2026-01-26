import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  QrCode, Camera, Search, X, CheckCircle, AlertCircle,
  Download, PrinterIcon, Smartphone, Monitor, Car,
  HardDrive, User, MapPin, Building, Tag, Info,
  RefreshCw, Eye, Edit, Trash2, Plus, ArrowLeft,
  Clock, VideoOff
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import GlowButton from '../UI/GlowButton';
import RoleButtonWrapper from '../ProtectedRoutes/RoleButton';

type Asset = Database['public']['Tables']['assets']['Row'];

const QRScanner: React.FC = () => {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraId, setCameraId] = useState<string>('');
  const [cameras, setCameras] = useState<{deviceId: string, label: string}[]>([]);
  const [scannedResult, setScannedResult] = useState<string>('');
  const [scanStatus, setScanStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(true);
  const [scanHistory, setScanHistory] = useState<Array<{
    id: string;
    asset_tag: string;
    asset_name: string;
    timestamp: Date;
    status: 'success' | 'error';
  }>>([]);
  const [manualInput, setManualInput] = useState('');
  const [cameraError, setCameraError] = useState<string>('');
  const [isCameraSupported, setIsCameraSupported] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check camera support
  useEffect(() => {
    const checkCameraSupport = () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsCameraSupported(false);
        setCameraError('Camera API not supported in this browser');
        return;
      }
      setIsCameraSupported(true);
    };

    checkCameraSupport();
  }, []);

  // Initialize cameras
  useEffect(() => {
    const getCameras = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) {
          throw new Error('Media devices not supported');
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices
          .filter(device => device.kind === 'videoinput')
          .map(device => ({
            deviceId: device.deviceId,
            label: device.label || `Camera ${videoDevices.length + 1}`
          }));
        
        if (videoDevices.length > 0) {
          setCameras(videoDevices);
          setCameraId(videoDevices[0].deviceId);
        } else {
          setCameraError('No cameras found');
        }
      } catch (err: any) {
        console.error('Error getting cameras:', err);
        setCameraError(err.message || 'Failed to access cameras');
      }
    };

    if (isCameraSupported) {
      getCameras();
    }
  }, [isCameraSupported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, []);

  // Start/Stop camera
  const toggleScanner = async () => {
    if (!cameraId || !isCameraSupported) return;

    try {
      if (!scanning) {
        await startCamera();
        setScanning(true);
        startScanning();
      } else {
        stopCamera();
        setScanning(false);
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      setCameraError(err.message || 'Failed to start camera');
      setScanning(false);
    }
  };

  // Start camera
  const startCamera = async () => {
    stopCamera(); // Stop any existing stream
    
    const constraints = {
      video: {
        deviceId: cameraId ? { exact: cameraId } : undefined,
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraError('');
    } catch (err: any) {
      throw new Error(`Camera access denied: ${err.message}`);
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Simple QR code scanning using canvas
  const startScanning = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
    }

    scanIntervalRef.current = setInterval(() => {
      if (videoRef.current && canvasRef.current) {
        try {
          const canvas = canvasRef.current;
          const context = canvas.getContext('2d');
          
          if (context && videoRef.current.videoWidth > 0) {
            // Draw video frame to canvas
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            
            // Simple QR code detection (placeholder)
            // In a real app, you would use a QR code library here
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            
            // This is a placeholder - you should integrate a QR library like jsqr
            // For now, we'll use manual input as primary method
          }
        } catch (err) {
          console.debug('Scan error:', err);
        }
      }
    }, 100); // Check every 100ms
  };

  // Handle scan result
  const handleScan = async (result: string) => {
    stopCamera();
    setScanning(false);
    
    setScannedResult(result);
    setScanStatus('success');
    await fetchAsset(result);
    
    // Add to history
    const historyItem = {
      id: Date.now().toString(),
      asset_tag: result,
      asset_name: 'Scanning...',
      timestamp: new Date(),
      status: 'success' as const
    };
    setScanHistory(prev => [historyItem, ...prev.slice(0, 9)]);
  };

  // Fetch asset data
  const fetchAsset = async (assetTag: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .or(`asset_tag.eq.${assetTag},serial_number.eq.${assetTag}`)
        .single();

      if (error) {
        console.error('Asset not found:', error);
        setAsset(null);
        setScanStatus('error');
      } else {
        setAsset(data);
        setScanStatus('success');
        
        // Update history item with asset name
        setScanHistory(prev => prev.map(item => 
          item.asset_tag === assetTag 
            ? { ...item, asset_name: data.asset_name || 'Unknown Asset' }
            : item
        ));
      }
    } catch (err) {
      console.error('Error fetching asset:', err);
      setAsset(null);
      setScanStatus('error');
    } finally {
      setLoading(false);
    }
  };

  // Manual search
  const handleManualSearch = () => {
    if (manualInput.trim()) {
      handleScan(manualInput.trim());
      setManualInput('');
    }
  };

  // Clear scan
  const clearScan = async () => {
    stopCamera();
    setScanning(false);
    
    setScannedResult('');
    setAsset(null);
    setScanStatus('idle');
    setCameraError('');
  };

  // Get asset icon based on category
  const getAssetIcon = (category: string) => {
    switch (category) {
      case 'vehicle': return <Car className="w-4 h-4" />;
      case 'computer': return <Monitor className="w-4 h-4" />;
      case 'phone': return <Smartphone className="w-4 h-4" />;
      default: return <HardDrive className="w-4 h-4" />;
    }
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500/20 text-green-800 border-green-500/30';
      case 'maintenance': return 'bg-yellow-500/20 text-yellow-800 border-yellow-500/30';
      case 'retired': return 'bg-gray-500/20 text-gray-800 border-gray-500/30';
      case 'lost': return 'bg-red-500/20 text-red-800 border-red-500/30';
      default: return 'bg-blue-500/20 text-blue-800 border-blue-500/30';
    }
  };

  // Export scan history
  const exportHistory = () => {
    const historyData = scanHistory.map(item => ({
      'Asset Tag': item.asset_tag,
      'Asset Name': item.asset_name,
      'Timestamp': item.timestamp.toLocaleString(),
      'Status': item.status === 'success' ? 'Success' : 'Error'
    }));

    const csv = [
      ['Asset Tag', 'Asset Name', 'Timestamp', 'Status'],
      ...historyData.map(item => [item['Asset Tag'], item['Asset Name'], item['Timestamp'], item['Status']])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan-history-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Clear history
  const clearHistory = () => {
    if (window.confirm('Are you sure you want to clear scan history?')) {
      setScanHistory([]);
    }
  };

  // Toggle scanner visibility
  const handleToggleScanner = () => {
    setShowScanner(!showScanner);
  };

  return (
    <div className="p-6 space-y-6 text-xs">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/asset')}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">QR Code Scanner</h1>
            <p className="text-gray-600 mt-0.5">
              Scan asset QR codes to view and manage asset information
            </p>
          </div>
        </div>
        
        <div className="flex flex-wrap gap-2">
          <GlowButton 
            variant="secondary" 
            icon={RefreshCw}
            size="sm"
            onClick={clearScan}
            disabled={loading}
          >
            New Scan
          </GlowButton>
          
          <RoleButtonWrapper allowedRoles={['ADMIN', 'IT']}>
            <GlowButton 
              variant="secondary"
              icon={Download}
              size="sm"
              onClick={exportHistory}
              disabled={scanHistory.length === 0}
            >
              Export History
            </GlowButton>
          </RoleButtonWrapper>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Scanner */}
        <div className="lg:col-span-2 space-y-4">
          {/* Scanner Controls */}
          <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">QR Code Scanner</h3>
                <p className="text-gray-600 mt-0.5">
                  {scanning ? 'Camera active - Use manual input below' : 'Ready to scan'}
                </p>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {cameras.length > 0 && (
                  <select
                    value={cameraId}
                    onChange={(e) => setCameraId(e.target.value)}
                    disabled={scanning}
                    className="h-[34px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                  >
                    {cameras.map((camera, index) => (
                      <option key={camera.deviceId} value={camera.deviceId}>
                        {camera.label}
                      </option>
                    ))}
                  </select>
                )}
                
                <GlowButton 
                  icon={scanning ? X : Camera}
                  size="sm"
                  onClick={toggleScanner}
                  variant={scanning ? "danger" : "primary"}
                  disabled={!isCameraSupported || cameras.length === 0}
                >
                  {scanning ? 'Stop Camera' : 'Start Camera'}
                </GlowButton>
              </div>
            </div>

            {/* Camera Error Message */}
            {cameraError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <span className="font-medium text-red-800">Camera Error</span>
                </div>
                <p className="text-red-600 text-xs">{cameraError}</p>
                <p className="text-red-500 text-xs mt-1">
                  Try refreshing the page or check camera permissions
                </p>
              </div>
            )}

            {/* Camera Not Supported */}
            {!isCameraSupported && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <VideoOff className="w-4 h-4 text-yellow-600" />
                  <span className="font-medium text-yellow-800">Camera Not Supported</span>
                </div>
                <p className="text-yellow-600 text-xs">
                  Your browser doesn't support camera access. Try using Chrome, Firefox, or Edge.
                </p>
              </div>
            )}

            {/* Scanner View */}
            <div className="relative">
              {showScanner ? (
                <div className="w-full h-64 bg-black rounded-lg overflow-hidden relative">
                  {scanning ? (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 pointer-events-none">
                        <div className="absolute inset-0 border-2 border-green-500/50 rounded-lg m-8"></div>
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-green-500 rounded-lg"></div>
                        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                          <div className="animate-pulse">
                            <QrCode className="w-8 h-8 text-green-400 mx-auto" />
                            <p className="text-green-400 text-xs mt-2">Use manual input below</p>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="text-center">
                        <QrCode className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                        <p className="text-gray-300">Camera preview will appear here</p>
                        <p className="text-gray-400 text-xs mt-1">Click "Start Camera" to begin</p>
                      </div>
                    </div>
                  )}
                  <canvas ref={canvasRef} className="hidden" />
                </div>
              ) : (
                <div className="w-full h-64 bg-gray-900 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <Camera className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-300">Scanner is hidden</p>
                    <button
                      onClick={() => setShowScanner(true)}
                      className="mt-2 text-green-400 hover:text-green-300 text-sm"
                    >
                      Show Scanner
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Manual Input */}
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <Search className="w-3 h-3 text-gray-500" />
                <span className="text-gray-700">Enter asset tag or serial number:</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleManualSearch()}
                  placeholder="Enter asset tag or serial number..."
                  className="flex-1 h-[34px] bg-gray-50 border border-gray-300 rounded-lg px-3 py-1.5 text-xs text-gray-900 placeholder-gray-500 focus:outline-none focus:border-green-500 focus:shadow-[0_0_10px_rgba(34,197,94,0.3)] transition-all duration-200"
                  disabled={loading}
                />
                <GlowButton 
                  size="sm"
                  onClick={handleManualSearch}
                  disabled={!manualInput.trim() || loading}
                >
                  Search
                </GlowButton>
              </div>
              <p className="text-gray-500 text-xs mt-2">
                Note: For QR scanning, please use a dedicated QR scanner app and enter the code manually.
              </p>
            </div>
          </div>

          {/* Scan Result */}
          {scannedResult && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {scanStatus === 'success' ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-500" />
                  )}
                  <h3 className="font-semibold text-gray-900">
                    {scanStatus === 'success' ? 'Scan Successful' : 'Scan Failed'}
                  </h3>
                </div>
                <div className="text-gray-500 text-xs">
                  Scanned: {new Date().toLocaleTimeString()}
                </div>
              </div>

              <div className="space-y-3">
                {/* Scanned Code */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-gray-600">Scanned Code:</span>
                    <span className="font-mono font-medium text-gray-900">{scannedResult}</span>
                  </div>
                </div>

                {/* Asset Information */}
                {loading ? (
                  <div className="text-center py-8">
                    <div className="animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto mb-3"></div>
                      <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto"></div>
                    </div>
                  </div>
                ) : asset ? (
                  <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getStatusColor(asset.status || 'active').split(' ')[0]}`}>
                          {getAssetIcon(asset.category || 'other')}
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{asset.asset_name}</h4>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-gray-600">{asset.asset_tag}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs ${getStatusColor(asset.status || 'active')}`}>
                              {asset.status}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => navigate(`/asset/view/${asset.id}`)}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-3 h-3 text-gray-600" />
                        </button>
                        <button
                          onClick={() => navigate(`/asset/edit/${asset.id}`)}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Edit Asset"
                        >
                          <Edit className="w-3 h-3 text-gray-600" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-1.5">
                        <Tag className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="text-gray-600">Serial:</span>
                        <span className="font-medium text-gray-900 truncate">{asset.serial_number || 'N/A'}</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5">
                        <Building className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="text-gray-600">Location:</span>
                        <span className="font-medium text-gray-900 truncate">{asset.location || 'Unassigned'}</span>
                      </div>
                      
                      {asset.assigned_to && (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <span className="text-gray-600">Assigned To:</span>
                          <span className="font-medium text-gray-900 truncate">{asset.assigned_to}</span>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-gray-400 flex-shrink-0" />
                        <span className="text-gray-600">Condition:</span>
                        <span className="font-medium text-gray-900">{asset.condition || 'N/A'}</span>
                      </div>
                    </div>

                    {asset.notes && (
                      <div className="mt-3 pt-3 border-t border-gray-200">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Info className="w-3 h-3 text-gray-400" />
                          <span className="text-gray-600">Notes:</span>
                        </div>
                        <p className="text-gray-700 text-xs">{asset.notes}</p>
                      </div>
                    )}

                    <div className="flex gap-2 mt-4 pt-3 border-t border-gray-200">
                      <GlowButton 
                        variant="primary" 
                        size="xs"
                        onClick={() => navigate(`/asset/view/${asset.id}`)}
                      >
                        View Full Details
                      </GlowButton>
                      <GlowButton 
                        variant="secondary" 
                        size="xs"
                        onClick={() => navigate(`/asset/edit/${asset.id}`)}
                      >
                        Edit Asset
                      </GlowButton>
                      <RoleButtonWrapper allowedRoles={['ADMIN', 'IT']}>
                        <GlowButton 
                          variant="danger" 
                          size="xs"
                          onClick={() => navigate(`/asset/delete/${asset.id}`)}
                        >
                          Delete
                        </GlowButton>
                      </RoleButtonWrapper>
                    </div>
                  </div>
                ) : scanStatus === 'error' ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      <h4 className="font-semibold text-red-800">Asset Not Found</h4>
                    </div>
                    <p className="text-red-600 mb-3">
                      No asset found with tag/serial: <span className="font-mono">{scannedResult}</span>
                    </p>
                    <div className="flex gap-2">
                      <GlowButton 
                        size="xs"
                        onClick={() => navigate('/asset/add', { state: { asset_tag: scannedResult } })}
                        icon={Plus}
                      >
                        Create New Asset
                      </GlowButton>
                      <GlowButton 
                        variant="secondary" 
                        size="xs"
                        onClick={clearScan}
                      >
                        Try Again
                      </GlowButton>
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>
          )}
        </div>

        {/* Right Column: History & Instructions */}
        <div className="space-y-4">
          {/* Instructions */}
          <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
              <Info className="w-4 h-4" />
              How to Use
            </h3>
            <ul className="space-y-2">
              <li className="flex items-start gap-1.5">
                <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-green-600 text-xs">1</span>
                </div>
                <span className="text-gray-700">Enter asset tag or serial number manually</span>
              </li>
              <li className="flex items-start gap-1.5">
                <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-green-600 text-xs">2</span>
                </div>
                <span className="text-gray-700">Click "Search" to find the asset</span>
              </li>
              <li className="flex items-start gap-1.5">
                <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-green-600 text-xs">3</span>
                </div>
                <span className="text-gray-700">View asset details and take action</span>
              </li>
              <li className="flex items-start gap-1.5">
                <div className="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-green-600 text-xs">4</span>
                </div>
                <span className="text-gray-700">Use camera for visual verification only</span>
              </li>
            </ul>
            
            <div className="mt-4 pt-3 border-t border-gray-200">
              <h4 className="font-medium text-gray-900 mb-1.5">For QR Scanning:</h4>
              <ul className="text-gray-600 space-y-1">
                <li className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-gray-400 flex-shrink-0"></div>
                  Use a dedicated QR scanner app on your phone
                </li>
                <li className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-gray-400 flex-shrink-0"></div>
                  Scan the QR code to get the asset tag
                </li>
                <li className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-gray-400 flex-shrink-0"></div>
                  Enter the asset tag manually above
                </li>
              </ul>
            </div>
          </div>

          {/* Scan History */}
          <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 flex items-center gap-1.5">
                <Clock className="w-4 h-4" />
                Recent Scans
              </h3>
              {scanHistory.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="text-xs text-red-600 hover:text-red-800 transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>

            {scanHistory.length === 0 ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <Search className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-gray-600">No scan history yet</p>
                <p className="text-gray-500 text-xs mt-0.5">Start scanning to see history here</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-2">
                {scanHistory.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`p-2.5 rounded-lg border ${
                      item.status === 'success' 
                        ? 'border-green-200 bg-green-50/50' 
                        : 'border-red-200 bg-red-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {item.status === 'success' ? (
                          <CheckCircle className="w-3 h-3 text-green-600" />
                        ) : (
                          <AlertCircle className="w-3 h-3 text-red-600" />
                        )}
                        <span className="font-medium text-gray-900 truncate">{item.asset_tag}</span>
                      </div>
                      <span className="text-gray-500 text-xs">
                        {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600 truncate text-xs">{item.asset_name}</span>
                      <button
                        onClick={() => handleScan(item.asset_tag)}
                        className="text-xs text-green-600 hover:text-green-800 transition-colors"
                      >
                        Rescan
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {scanHistory.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Total scans: {scanHistory.length}</span>
                  <span className="text-gray-600">
                    Success: {scanHistory.filter(s => s.status === 'success').length}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <GlowButton 
                variant="secondary"
                size="xs"
                onClick={() => navigate('/asset')}
                className="justify-start"
              >
                View All Assets
              </GlowButton>
              
              <GlowButton 
                variant="secondary"
                size="xs"
                onClick={() => navigate('/asset/add')}
                className="justify-start"
                icon={Plus}
              >
                Add New Asset
              </GlowButton>
              
              <RoleButtonWrapper allowedRoles={['ADMIN', 'IT']}>
                <GlowButton 
                  variant="secondary"
                  size="xs"
                  onClick={() => navigate('/asset/print-labels')}
                  className="justify-start"
                >
                  Print QR Labels
                </GlowButton>
              </RoleButtonWrapper>
              
              <GlowButton 
                variant="secondary"
                size="xs"
                onClick={() => window.print()}
                className="justify-start"
                icon={PrinterIcon}
              >
                Print Report
              </GlowButton>
            </div>
          </div>
        </div>
      </div>

      {/* Camera Toggle Button (Mobile) */}
      <div className="lg:hidden fixed bottom-6 right-6 z-50">
        <button
          onClick={handleToggleScanner}
          className="w-12 h-12 bg-green-500 hover:bg-green-600 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 hover:scale-110"
        >
          {showScanner ? (
            <X className="w-5 h-5 text-white" />
          ) : (
            <Camera className="w-5 h-5 text-white" />
          )}
        </button>
      </div>
    </div>
  );
};

export default QRScanner;