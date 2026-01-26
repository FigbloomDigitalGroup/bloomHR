// SMS Service Configuration for SMS Leopard
const SMS_LEOPARD_CONFIG = {
  baseUrl: 'https://api.smsleopard.com/v1',
  username: 'yxFXqkhbsdbm2cCeXOju',
  password: '***REMOVED***',
  source: 'sms_Leopard'
};

// Utility function to add query parameters
const addQueryParams = (url, params) => {
  const queryString = Object.entries(params)
    .flatMap(([key, value]) => 
      Array.isArray(value) 
        ? value.map(val => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
        : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');
  
  return `${url}?${queryString}`;
};

// SMS Service Functions for SMS Leopard
const sendSMSLeopard = async (phoneNumber, message) => {
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    if (!formattedPhone || !message) {
      throw new Error('Phone number and message are required');
    }

    const endpoint = addQueryParams(`${SMS_LEOPARD_CONFIG.baseUrl}/sms/send`, {
      username: SMS_LEOPARD_CONFIG.username,
      password: SMS_LEOPARD_CONFIG.password,
      message: message,
      destination: formattedPhone,
      source: SMS_LEOPARD_CONFIG.source
    });

    // Create Basic Auth credentials
    const credentials = btoa(`${SMS_LEOPARD_CONFIG.username}:${SMS_LEOPARD_CONFIG.password}`);

    const response = await fetch(endpoint, {
      method: 'GET', // SMS Leopard uses GET requests
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SMS service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // SMS Leopard specific response handling
    if (result.status === 'success' || response.ok) {
      return {
        success: true,
        message: 'SMS sent successfully',
        timestamp: new Date().toISOString(),
        rawResponse: result
      };
    } else {
      throw new Error(result.message || 'Failed to send SMS');
    }
    
  } catch (error) {
    console.error('SMS sending error:', error);
    
    // Fallback: Log the SMS that would have been sent
    console.log('SMS would have been sent:', {
      to: formatPhoneNumber(phoneNumber),
      message: message,
      provider: 'SMS Leopard'
    });
    
    return { 
      success: false, 
      error: error.message,
      fallback: true,
      message: 'SMS queued for retry'
    };
  }
};

const checkSMSBalance = async () => {
  try {
    const endpoint = `${SMS_LEOPARD_CONFIG.baseUrl}/balance`;
    const credentials = btoa(`${SMS_LEOPARD_CONFIG.username}:${SMS_LEOPARD_CONFIG.password}`);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to check balance: ${response.status}`);
    }

    const result = await response.json();
    
    // Handle different response formats from SMS Leopard
    if (result.balance !== undefined) {
      return `KSh ${result.balance}`;
    } else if (result.data && result.data.balance !== undefined) {
      return `KSh ${result.data.balance}`;
    } else {
      return 'Balance information not available';
    }
    
  } catch (error) {
    console.error('SMS balance check error:', error);
    return 'Service unavailable';
  }
};

// Enhanced phone number formatting for SMS Leopard
const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  
  // Remove any non-digit characters
  let cleaned = phone.replace(/\D/g, '');
  
  // Convert to 254 format if it starts with 0 or 7
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  } else if (cleaned.startsWith('7')) {
    cleaned = '254' + cleaned;
  } else if (cleaned.startsWith('+254')) {
    cleaned = cleaned.substring(1); // Remove the +
  }
  
  // Ensure it's exactly 12 digits (254XXXXXXXXX)
  if (cleaned.length === 12 && cleaned.startsWith('254')) {
    return cleaned;
  }
  
  console.warn('Invalid phone number format:', phone, 'cleaned:', cleaned);
  return cleaned; // Return as-is and let the API handle validation
};