// StatutorySettingsModal.jsx
import React, { useState, useEffect } from 'react';
import { Settings, Save, X, DollarSign, Calculator, Users, Home } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

const StatutorySettingsModal = ({ isOpen, onClose, reloadSettings }) => {
  const [settings, setSettings] = useState({
    // PAYE Settings - FIXED: Using decimals instead of whole numbers
    payeBrackets: [
      { threshold: 24000, rate: 0.10 },    // 10% as decimal
      { threshold: 32333, rate: 0.25 },    // 25% as decimal  
      { threshold: 500000, rate: 0.30 },   // 30% as decimal
      { threshold: 800000, rate: 0.325 },  // 32.5% as decimal
      { threshold: 999999999, rate: 0.35 } // 35% as decimal
    ],
    personalRelief: 2400,
    
    // NSSF Settings
    nssfLowerLimit: 8000,
    nssfUpperLimit: 72000,
    nssfRate: 0.06,
    nssfMaximum: 4320,
    
    // NHIF Settings - FLAT RATE ONLY
    nhifRate: 0.0275, // 0.275% as decimal
    
    // Housing Levy
    housingLevyRate: 0.015,
    
    // General
    currency: 'KSh',
    effectiveDate: new Date().toISOString().split('T')[0]
  });

  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load settings from database
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      const { data, error } = await supabase
        .from('statutory_settings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (data && !error) {
        // Clean up and ensure rates are decimals
        const cleanSettings = { ...data.settings };
        
        // Remove old tiered NHIF properties if they exist
        delete cleanSettings.nhifRates;
        delete cleanSettings.nhifDefault;
        
        // Ensure nhifRate exists
        if (!cleanSettings.nhifRate) {
          cleanSettings.nhifRate = 0.0275;
        }

        // CRITICAL FIX: Ensure PAYE rates are decimals, not whole numbers
        if (cleanSettings.payeBrackets) {
          cleanSettings.payeBrackets = cleanSettings.payeBrackets.map(bracket => {
            // If rate is a whole number (like 10, 25, 30), convert to decimal (0.10, 0.25, 0.30)
            if (bracket.rate >= 1) {
              console.warn('Fixing PAYE rate from whole number to decimal:', bracket.rate, '→', bracket.rate / 100);
              return {
                ...bracket,
                rate: bracket.rate / 100
              };
            }
            return bracket;
          });
        }
        
        setSettings(cleanSettings);
        console.log('Loaded settings:', cleanSettings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async () => {
    setIsLoading(true);
    try {
      // Validate PAYE rates before saving
      const validatedSettings = { ...settings };
      
      // Double-check that all PAYE rates are decimals
      if (validatedSettings.payeBrackets) {
        validatedSettings.payeBrackets = validatedSettings.payeBrackets.map(bracket => {
          // If somehow rate is still a whole number, convert it
          if (bracket.rate >= 1) {
            console.warn('Correcting PAYE rate before save:', bracket.rate, '→', bracket.rate / 100);
            return {
              ...bracket,
              rate: bracket.rate / 100
            };
          }
          return bracket;
        });
      }

      const settingsToSave = {
        ...validatedSettings,
        // Remove any old tiered NHIF data that might have been added
        nhifRates: undefined,
        nhifDefault: undefined
      };

      console.log('Saving settings:', settingsToSave);

      const { data, error } = await supabase
        .from('statutory_settings')
        .insert([
          {
            settings: settingsToSave,
            created_by: (await supabase.auth.getUser()).data.user?.id
          }
        ])
        .select()
        .single();

      if (error) throw error;

      toast.success('Statutory settings updated successfully!');
      setHasChanges(false);
      
      // Reload settings in the parent component
      if (reloadSettings) {
        reloadSettings();
      }
      
      onClose();
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const updatePayeBracket = (index, field, value) => {
    const updatedBrackets = [...settings.payeBrackets];
    
    if (field === 'rate') {
      // Convert percentage input to decimal for storage
      const decimalRate = parseFloat(value) / 100;
      updatedBrackets[index] = { ...updatedBrackets[index], [field]: decimalRate };
    } else {
      updatedBrackets[index] = { ...updatedBrackets[index], [field]: parseFloat(value) };
    }
    
    updateSettings('payeBrackets', updatedBrackets);
  };

  const addPayeBracket = () => {
    const newBrackets = [...settings.payeBrackets];
    newBrackets.splice(newBrackets.length - 1, 0, { threshold: 0, rate: 0.25 }); // Default to 25% as decimal
    updateSettings('payeBrackets', newBrackets);
  };

  const removePayeBracket = (index) => {
    if (settings.payeBrackets.length <= 2) {
      toast.error('Must have at least 2 tax brackets');
      return;
    }
    const newBrackets = settings.payeBrackets.filter((_, i) => i !== index);
    updateSettings('payeBrackets', newBrackets);
  };

  // Debug function to check current settings
  const debugSettings = () => {
    console.log('=== CURRENT SETTINGS DEBUG ===');
    console.log('PAYE Brackets:', settings.payeBrackets);
    console.log('Personal Relief:', settings.personalRelief);
    console.log('NHIF Rate:', settings.nhifRate);
    console.log('NSSF Rate:', settings.nssfRate);
    console.log('Housing Levy Rate:', settings.housingLevyRate);
    console.log('=== END DEBUG ===');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white p-6 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Statutory Calculations Settings
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={debugSettings}
              className="px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200"
              title="Debug settings in console"
            >
              Debug
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors duration-200"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* PAYE Tax Settings */}
          <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              PAYE Tax Brackets
            </h3>
            
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Personal Relief (KSh)
                  </label>
                  <input
                    type="number"
                    value={settings.personalRelief}
                    onChange={(e) => updateSettings('personalRelief', parseFloat(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-600 px-3">
                  <div className="col-span-5">Income Range (KSh)</div>
                  <div className="col-span-4">Tax Rate</div>
                  <div className="col-span-3">Actions</div>
                </div>
                
                {settings.payeBrackets.map((bracket, index) => (
                  <div key={index} className="flex items-center gap-3 bg-white p-3 rounded-lg border border-gray-200">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {index === 0 ? 'First' : 
                         index === settings.payeBrackets.length - 1 ? 'Above' : 
                         'Next'} {index === settings.payeBrackets.length - 1 ? '' : 'Up to'} (KSh)
                      </label>
                      <input
                        type="number"
                        value={bracket.threshold === 999999999 ? '' : bracket.threshold}
                        onChange={(e) => updatePayeBracket(index, 'threshold', 
                          index === settings.payeBrackets.length - 1 ? 999999999 : parseFloat(e.target.value))}
                        placeholder={index === settings.payeBrackets.length - 1 ? 'Maximum' : 'Threshold'}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        disabled={index === settings.payeBrackets.length - 1}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Rate (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={(bracket.rate * 100).toFixed(2)}
                        onChange={(e) => updatePayeBracket(index, 'rate', parseFloat(e.target.value))}
                        className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <div className="text-xs text-gray-500 mt-1">
                        Decimal: {bracket.rate.toFixed(3)}
                      </div>
                    </div>
                    {index !== settings.payeBrackets.length - 1 && index !== 0 && (
                      <button
                        onClick={() => removePayeBracket(index)}
                        className="mt-6 px-2 py-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors duration-200"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              
              <button
                onClick={addPayeBracket}
                className="text-sm font-medium text-gray-700 hover:text-gray-900 flex items-center gap-1 transition-colors duration-200"
              >
                <span className="text-lg">+</span> Add Tax Bracket
              </button>
            </div>
          </div>

          {/* NSSF Settings */}
          <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <Users className="w-5 h-5" />
              NSSF Settings
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Lower Limit (KSh)
                </label>
                <input
                  type="number"
                  value={settings.nssfLowerLimit}
                  onChange={(e) => updateSettings('nssfLowerLimit', parseFloat(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Upper Limit (KSh)
                </label>
                <input
                  type="number"
                  value={settings.nssfUpperLimit}
                  onChange={(e) => updateSettings('nssfUpperLimit', parseFloat(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rate (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={(settings.nssfRate * 100).toFixed(2)}
                  onChange={(e) => updateSettings('nssfRate', parseFloat(e.target.value) / 100)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Maximum (KSh)
                </label>
                <input
                  type="number"
                  value={settings.nssfMaximum}
                  onChange={(e) => updateSettings('nssfMaximum', parseFloat(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                />
              </div>
            </div>
          </div>

          {/* NHIF Settings - SIMPLIFIED */}
          <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign className="w-5 h-5" />
              NHIF Settings
            </h3>
            
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  NHIF Rate (%)
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={(settings.nhifRate * 100).toFixed(3)}
                  onChange={(e) => updateSettings('nhifRate', parseFloat(e.target.value) / 100)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Current: {(settings.nhifRate * 100).toFixed(3)}% - For a salary of KSh 50,000, NHIF would be KSh { (50000 * settings.nhifRate).toFixed(2) }
                </p>
              </div>
            </div>
          </div>

          {/* Housing Levy Settings */}
          <div className="bg-gray-50 rounded-lg p-5 border border-gray-200">
            <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
              <Home className="w-5 h-5" />
              Housing Levy Settings
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Levy Rate (%)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={(settings.housingLevyRate * 100).toFixed(2)}
                  onChange={(e) => updateSettings('housingLevyRate', parseFloat(e.target.value) / 100)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Effective Date
                </label>
                <input
                  type="date"
                  value={settings.effectiveDate}
                  onChange={(e) => updateSettings('effectiveDate', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors duration-200"
          >
            Cancel
          </button>
          <button
            onClick={saveSettings}
            disabled={!hasChanges || isLoading}
            className="px-6 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
          >
            <Save className="w-4 h-4" />
            {isLoading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatutorySettingsModal;