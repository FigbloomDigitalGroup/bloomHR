// StatutorySettingsModal.tsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

const StatutorySettingsModal = ({ isOpen, onClose, reloadSettings }) => {
  const [settings, setSettings] = useState({
    payeBrackets: [
      { threshold: 24000, rate: 0.10 },
      { threshold: 32333, rate: 0.25 },
      { threshold: 500000, rate: 0.30 },
      { threshold: 800000, rate: 0.325 },
      { threshold: 999999999, rate: 0.35 }
    ],
    personalRelief: 2400,
    nssfLowerLimit: 8000,
    nssfUpperLimit: 72000,
    nssfRate: 0.06,
    nssfMaximum: 4320,
    nhifRate: 0.0275,
    housingLevyRate: 0.015,
    currency: 'KSh',
    effectiveDate: new Date().toISOString().split('T')[0]
  });

  const [isLoading, setIsLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (isOpen) loadSettings();
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
        const cleanSettings = { ...data.settings };
        delete cleanSettings.nhifRates;
        delete cleanSettings.nhifDefault;
        if (!cleanSettings.nhifRate) cleanSettings.nhifRate = 0.0275;
        if (cleanSettings.payeBrackets) {
          cleanSettings.payeBrackets = cleanSettings.payeBrackets.map(bracket =>
            bracket.rate >= 1 ? { ...bracket, rate: bracket.rate / 100 } : bracket
          );
        }
        setSettings(cleanSettings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const saveSettings = async () => {
    setIsLoading(true);
    try {
      const validatedSettings = { ...settings };
      if (validatedSettings.payeBrackets) {
        validatedSettings.payeBrackets = validatedSettings.payeBrackets.map(bracket =>
          bracket.rate >= 1 ? { ...bracket, rate: bracket.rate / 100 } : bracket
        );
      }
      const settingsToSave = { ...validatedSettings, nhifRates: undefined, nhifDefault: undefined };

      const { error } = await supabase
        .from('statutory_settings')
        .insert([{ settings: settingsToSave, created_by: (await supabase.auth.getUser()).data.user?.id }])
        .select()
        .single();

      if (error) throw error;
      toast.success('Statutory settings updated successfully!');
      setHasChanges(false);
      if (reloadSettings) reloadSettings();
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
      updatedBrackets[index] = { ...updatedBrackets[index], [field]: parseFloat(value) / 100 };
    } else {
      updatedBrackets[index] = { ...updatedBrackets[index], [field]: parseFloat(value) };
    }
    updateSettings('payeBrackets', updatedBrackets);
  };

  const addPayeBracket = () => {
    const newBrackets = [...settings.payeBrackets];
    newBrackets.splice(newBrackets.length - 1, 0, { threshold: 0, rate: 0.25 });
    updateSettings('payeBrackets', newBrackets);
  };

  const removePayeBracket = (index) => {
    if (settings.payeBrackets.length <= 2) {
      toast.error('Must have at least 2 tax brackets');
      return;
    }
    updateSettings('payeBrackets', settings.payeBrackets.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  const inputCls = "w-full bg-gray-50 border border-gray-200 rounded-[8px] px-3 py-1.5 text-xs focus:ring-2 focus:ring-violet-300 focus:outline-none";
  const sectionCls = "bg-white border border-gray-100 rounded-[10px] p-4";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[10px] border border-gray-200 shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-gray-800">Statutory Calculations Settings</h2>
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-gray-600 px-3 py-1 rounded-[25px] hover:bg-gray-100 transition-colors border border-gray-200"
          >
            Close
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">

          {/* PAYE */}
          <div className={sectionCls}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">PAYE Tax Brackets</h3>
            <div className="mb-3 flex items-center gap-3">
              <label className="text-xs text-gray-500 w-40 shrink-0">Personal Relief (KSh)</label>
              <input
                type="number"
                value={settings.personalRelief}
                onChange={(e) => updateSettings('personalRelief', parseFloat(e.target.value))}
                className={`${inputCls} max-w-[200px]`}
              />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-[10px] font-medium text-gray-400 uppercase px-2">
                <div className="col-span-5">Income Up To (KSh)</div>
                <div className="col-span-4">Tax Rate (%)</div>
                <div className="col-span-3"></div>
              </div>
              {settings.payeBrackets.map((bracket, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded-[8px] px-2 py-2 border border-gray-100">
                  <div className="col-span-5">
                    <input
                      type="number"
                      value={bracket.threshold === 999999999 ? '' : bracket.threshold}
                      onChange={(e) => updatePayeBracket(index, 'threshold',
                        index === settings.payeBrackets.length - 1 ? 999999999 : parseFloat(e.target.value))}
                      placeholder={index === settings.payeBrackets.length - 1 ? 'Max' : 'Threshold'}
                      disabled={index === settings.payeBrackets.length - 1}
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      type="number"
                      step="0.01"
                      value={(bracket.rate * 100).toFixed(2)}
                      onChange={(e) => updatePayeBracket(index, 'rate', parseFloat(e.target.value))}
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-3 flex justify-end">
                    {index !== settings.payeBrackets.length - 1 && index !== 0 && (
                      <button
                        onClick={() => removePayeBracket(index)}
                        className="text-[10px] text-red-500 hover:text-red-700 px-2 py-1 rounded-[25px] hover:bg-red-50 transition-colors border border-red-100"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={addPayeBracket}
              className="mt-3 text-xs text-violet-600 hover:text-violet-800 font-medium transition-colors"
            >
              + Add Bracket
            </button>
          </div>

          {/* NSSF */}
          <div className={sectionCls}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">NSSF Settings</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Lower Limit (KSh)</label>
                <input type="number" value={settings.nssfLowerLimit}
                  onChange={(e) => updateSettings('nssfLowerLimit', parseFloat(e.target.value))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Upper Limit (KSh)</label>
                <input type="number" value={settings.nssfUpperLimit}
                  onChange={(e) => updateSettings('nssfUpperLimit', parseFloat(e.target.value))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Rate (%)</label>
                <input type="number" step="0.01" value={(settings.nssfRate * 100).toFixed(2)}
                  onChange={(e) => updateSettings('nssfRate', parseFloat(e.target.value) / 100)}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Maximum (KSh)</label>
                <input type="number" value={settings.nssfMaximum}
                  onChange={(e) => updateSettings('nssfMaximum', parseFloat(e.target.value))}
                  className={inputCls} />
              </div>
            </div>
          </div>

          {/* NHIF / SHIF */}
          <div className={sectionCls}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">NHIF / SHIF Settings</h3>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-500 w-24 shrink-0">NHIF Rate (%)</label>
              <input
                type="number"
                step="0.001"
                value={(settings.nhifRate * 100).toFixed(3)}
                onChange={(e) => updateSettings('nhifRate', parseFloat(e.target.value) / 100)}
                className={`${inputCls} max-w-[160px]`}
              />
              <span className="text-[10px] text-gray-400">
                KSh 50,000 → KSh {(50000 * settings.nhifRate).toFixed(2)}
              </span>
            </div>
          </div>

          {/* Housing Levy */}
          <div className={sectionCls}>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Housing Levy</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Levy Rate (%)</label>
                <input
                  type="number"
                  step="0.01"
                  value={(settings.housingLevyRate * 100).toFixed(2)}
                  onChange={(e) => updateSettings('housingLevyRate', parseFloat(e.target.value) / 100)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-[10px] text-gray-400 mb-1">Effective Date</label>
                <input
                  type="date"
                  value={settings.effectiveDate}
                  onChange={(e) => updateSettings('effectiveDate', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="inline-flex items-center px-4 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-[25px] hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={saveSettings}
            disabled={!hasChanges || isLoading}
            className="inline-flex items-center px-4 py-1.5 text-xs font-medium text-white bg-green-600 rounded-[25px] hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatutorySettingsModal;