import { useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { X, Save, PrinterIcon, Download, ArrowLeft, Plus, Upload, AlertCircle, Users, Check, PencilLine, Bell } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import GlowButton from '../UI/GlowButton';
import { User, Briefcase, CreditCard, Phone, Mail, MapPin } from 'lucide-react';

type Employee = Database['public']['Tables']['employees']['Row'] & {
  'SHIF Number'?: string | null;
  'NSSF Number'?: string | null;
  'Tax PIN'?: string | null;
  NITA?: string | null;
  HELB?: string | null;
};

type DropdownOptions = {
  employmentTypes: string[];
  branches: string[];
  jobLevels: string[];
  jobGroup: string[];
  office: string[];
  jobTitles: string[];
  supervisors: string[];
  paymentMethods: string[];
  genders: string[];
};

type EmergencyContact = {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
};

type Dependent = {
  name: string;
  relationship: string;
  dateOfBirth?: string;
};

type StatutoryDeduction = {
  name: string;
  number: string;
  isActive: boolean;
};

const phoneRegex = /^[+]{0,1}[\s0-9]{8,15}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const idNumberRegex = /^[0-9]{6,12}$/;
const passportRegex = /^[A-Za-z0-9]{6,12}$/;
const nhifRegex = /^[0-9]{8,10}$/;
const nssfRegex = /^[0-9]{9}$/;
const kraPinRegex = /^[A-Z]{1}[0-9]{9}[A-Z]{1}$/;
const nitaRegex = /^[A-Za-z0-9]{6,12}$/;
const helbRegex = /^[A-Za-z0-9]{6,12}$/;

// List of fields that should be READ-ONLY for employees
const READ_ONLY_FIELDS = [
  // Employee Identification & System Fields
  'Employee Number',
  'Work Email',
  'Work Mobile', // Added: Company-provided mobile number
  'Mobile Number', // Added: Primary mobile number requires admin approval to change

  // Employment Status & Contract Fields
  'Employee Type',
  'Start Date',
  'Termination Date',
  'Probation Start Date',
  'Probation End Date',
  'Contract Start Date',
  'Contract End Date',

  // Job & Position Information
  'Job Title',
  'Job Level',
  'Job Group',
  'Department',

  // Organizational Structure
  'Branch',
  'Town',
  'Manager',
  'Leave Approver',
  'Alternate Approver',

  // Financial & Compensation
  'Basic Salary',
  'Currency',
  'payment_method',
  'Bank',
  'Account Number',
  'account_number_name',
  'Bank Branch'
];

const EmployeeBioPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState<Partial<Employee>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [dropdownOptions, setDropdownOptions] = useState<DropdownOptions>({
    employmentTypes: [],
    branches: [],
    jobLevels: [],
    jobGroup: [],
    office: [],
    jobTitles: [],
    supervisors: [],
    paymentMethods: ['Bank Transfer', 'Cash', 'Mobile Money'],
    genders: ['Male', 'Female', 'Other']
  });
  const [activeTab, setActiveTab] = useState('personal');
  const [emergencyContact, setEmergencyContact] = useState<EmergencyContact>({ name: '', relationship: '', phone: '', email: '' });
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [statutoryDeductions, setStatutoryDeductions] = useState<StatutoryDeduction[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isEditMode, setIsEditMode] = useState(false);
  const [userRole, setUserRole] = useState<string>('employee'); // Track user role
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Phone number change request state
  const [pendingPhoneRequest, setPendingPhoneRequest] = useState<any>(null);
  const [showPhoneRequestModal, setShowPhoneRequestModal] = useState(false);
  const [requestedPhone, setRequestedPhone] = useState('');
  const [phoneChangeReason, setPhoneChangeReason] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

  // Check if a field should be editable based on user role
  const canEditField = (fieldName: string): boolean => {
    // HR/Admin can edit everything
    if (userRole === 'hr' || userRole === 'admin') return true;

    // Employees can only edit non-read-only fields
    if (isEditMode) {
      return !READ_ONLY_FIELDS.includes(fieldName);
    }

    return false;
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) return;

        // Fetch user role
        const { data: userProfile } = await supabase
          .from('user_profiles') // Adjust to your actual table name
          .select('role')
          .eq('user_id', user.id)
          .single();

        if (userProfile?.role) {
          setUserRole(userProfile.role);
        }

        const { data: employeeData } = await supabase
          .from('employees')
          .select('"Employee Number"')
          .eq('"Work Email"', user.email)
          .single();

        if (!employeeData) return;

        // Fetch employee data
        const { data: empData, error: empError } = await supabase
          .from('employees')
          .select('*')
          .eq('"Employee Number"', employeeData["Employee Number"])
          .single();

        if (empError) throw empError;
        if (!empData) throw new Error('Employee not found');

        // Fetch dropdown options
        const { data: empTypes } = await supabase
          .from('employees')
          .select('"Employee Type"')
          .not('Employee Type', 'is', null)
          .order('"Employee Type"', { ascending: true });

        const { data: branches } = await supabase
          .from('employees')
          .select('"Branch"')
          .not('Branch', 'is', null)
          .order('"Branch"', { ascending: true });

        const { data: jobLevels } = await supabase
          .from('employees')
          .select('"Job Level"')
          .not('Job Level', 'is', null)
          .order('"Job Level"', { ascending: true });

        const { data: jobGroup } = await supabase
          .from('employees')
          .select('"Job Group"')
          .not('Job Group', 'is', null)
          .order('"Job Group"', { ascending: true });

        const { data: office } = await supabase
          .from('employees')
          .select('"Town"')
          .not('Town', 'is', null)
          .order('"Town"', { ascending: true });

        const { data: jobTitles } = await supabase
          .from('employees')
          .select('"Job Title"')
          .not('Job Title', 'is', null)
          .order('"Job Title"', { ascending: true });

        const { data: supervisors } = await supabase
          .from('employees')
          .select('"First Name", "Last Name"')
          .order('"First Name"', { ascending: true });

        // Fetch emergency contact (single contact)
        const { data: contacts } = await supabase
          .from('emergency_contact')
          .select('*')
          .eq('Employee Number', id)
          .limit(1)
          .single();

        // Fetch dependents
        const { data: deps } = await supabase
          .from('dependents')
          .select('*')
          .eq('Employee Number', id);

        // Set default statutory deductions
        const defaultDeductions = [
          { name: 'SHIF Number', number: empData['SHIF Number'] || '', isActive: !!empData['SHIF Number'] },
          { name: 'NSSF Number', number: empData['NSSF Number'] || '', isActive: !!empData['NSSF Number'] },
          { name: 'Tax PIN', number: empData['Tax PIN'] || '', isActive: !!empData['Tax PIN'] },
          { name: 'NITA', number: empData.NITA || '', isActive: !!empData.NITA },
          { name: 'HELB', number: empData.HELB || '', isActive: !!empData.HELB }
        ];

        setDropdownOptions(prev => ({
          ...prev,
          employmentTypes: [...new Set(empTypes?.map(item => item['Employee Type'] as string))],
          branches: [...new Set(branches?.map(item => item.Branch as string))],
          jobLevels: [...new Set(jobLevels?.map(item => item['Job Level'] as string))],
          jobGroup: [...new Set(jobGroup?.map(item => item['Job Group'] as string))],
          office: [...new Set(office?.map(item => item.Town as string))],
          jobTitles: [...new Set(jobTitles?.map(item => item['Job Title'] as string))],
          supervisors: supervisors?.map(item => `${item['First Name']} ${item['Last Name']}`) || [],
        }));

        setEmployee(empData);

        // Set single emergency contact
        setEmergencyContact(
          contacts ? {
            name: contacts.full_name,
            relationship: contacts.relationship,
            phone: contacts.phone_number,
            email: contacts.email || ''
          } : { name: '', relationship: '', phone: '', email: '' }
        );

        setDependents(deps?.map(d => ({
          name: d.full_name,
          relationship: d.relationship,
          dateOfBirth: d.date_birth || undefined
        })) || [{ name: '', relationship: '' }]);

        setStatutoryDeductions(defaultDeductions);

        if (empData['Profile Image']) {
          setPreviewImage(empData['Profile Image']);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id]);

  const validateField = (name: string, value: string | number | null | undefined) => {
    let error = '';

    if (typeof value === 'string' && !value.trim() && ['First Name', 'Last Name'].includes(name)) {
      error = 'This field is required';
    } else {
      switch (name) {
        case 'Mobile Number':
        case 'Work Mobile':
        case 'Personal Mobile':
        case 'Alternative Mobile Number':
          if (value && !phoneRegex.test(String(value))) {
            error = 'Invalid phone number format';
          }
          break;
        case 'Personal Email':
        case 'Work Email':
          if (value && !emailRegex.test(String(value))) {
            error = 'Invalid email format';
          }
          break;
        case 'ID Number':
          if (value && !idNumberRegex.test(String(value))) {
            error = 'Invalid ID number format';
          }
          break;
        case 'passport_number':
          if (value && !passportRegex.test(String(value))) {
            error = 'Invalid passport number format';
          }
          break;
      }
    }

    setErrors(prev => ({ ...prev, [name]: error }));
    return !error;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, profileImage: 'File size exceeds 5MB limit' }));
        return;
      }
      setProfileImage(file);
      setPreviewImage(URL.createObjectURL(file));
      setErrors(prev => ({ ...prev, profileImage: '' }));
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    // Only allow editing if field is editable for this user
    if (!canEditField(name) && userRole !== 'hr' && userRole !== 'admin') {
      return;
    }

    setEmployee(prev => ({
      ...prev,
      [name]: value
    }));

    // Validate on change
    if (isEditMode) validateField(name, value);
  };

  const handleDateChange = (name: string, value: string) => {
    // Only allow editing if field is editable for this user
    if (!canEditField(name) && userRole !== 'hr' && userRole !== 'admin') {
      return;
    }

    setEmployee(prev => ({
      ...prev,
      [name]: value || null
    }));
  };

  const handleEmergencyContactChange = (field: keyof EmergencyContact, value: string) => {
    setEmergencyContact(prev => ({
      ...prev,
      [field]: value
    }));

    // Validate on change
    if (isEditMode) {
      if (field === 'phone') {
        validateField('emergencyContactPhone', value);
      } else if (field === 'email' && value) {
        validateField('emergencyContactEmail', value);
      }
    }
  };

  const handleDependentChange = (index: number, field: keyof Dependent, value: string) => {
    const updatedDependents = [...dependents];
    updatedDependents[index] = {
      ...updatedDependents[index],
      [field]: value
    };
    setDependents(updatedDependents);
  };

  const handleStatutoryDeductionChange = (index: number, field: keyof StatutoryDeduction, value: string | boolean) => {
    const updatedDeductions = [...statutoryDeductions];
    updatedDeductions[index] = {
      ...updatedDeductions[index],
      [field]: value
    };
    setStatutoryDeductions(updatedDeductions);

    // Validate on change if it's the number field
    if (field === 'number' && updatedDeductions[index].isActive && isEditMode) {
      validateField(`deduction${updatedDeductions[index].name}`, String(value));
    }
  };

  const addDependent = () => {
    setDependents([...dependents, { name: '', relationship: '' }]);
  };

  const removeDependent = (index: number) => {
    if (dependents.length > 1) {
      const updatedDependents = [...dependents];
      updatedDependents.splice(index, 1);
      setDependents(updatedDependents);
    }
  };

  const validateForm = () => {
    if (!isEditMode) return true;

    let isValid = true;
    const newErrors: Record<string, string> = {};

    // Required fields validation
    if (!employee['First Name']) {
      newErrors['First Name'] = 'First Name is required';
      isValid = false;
    }
    if (!employee['Last Name']) {
      newErrors['Last Name'] = 'Last Name is required';
      isValid = false;
    }
    if (!employee['Mobile Number']) {
      newErrors['Mobile Number'] = 'Mobile Number is required';
      isValid = false;
    } else if (!phoneRegex.test(employee['Mobile Number'])) {
      newErrors['Mobile Number'] = 'Invalid phone number format';
      isValid = false;
    }
    if (!employee['Personal Email']) {
      newErrors['Personal Email'] = 'Personal Email is required';
      isValid = false;
    } else if (!emailRegex.test(employee['Personal Email'])) {
      newErrors['Personal Email'] = 'Invalid email format';
      isValid = false;
    }

    // Emergency contact validation
    if (emergencyContact.name && !emergencyContact.phone) {
      newErrors['emergencyContactPhone'] = 'Emergency contact phone is required';
      isValid = false;
    } else if (emergencyContact.phone && !phoneRegex.test(emergencyContact.phone)) {
      newErrors['emergencyContactPhone'] = 'Invalid emergency contact phone format';
      isValid = false;
    }

    // Statutory deductions validation
    statutoryDeductions.forEach((deduction) => {
      if (deduction.isActive && !deduction.number) {
        newErrors[`deduction${deduction.name}`] = `${deduction.name} is required`;
        isValid = true;
      } else if (deduction.isActive && deduction.number) {
        switch (deduction.name) {
          case 'SHIF Number':
            if (!nhifRegex.test(deduction.number)) {
              newErrors[`deduction${deduction.name}`] = 'Invalid SHIF Number (8-10 digits)';
              isValid = true;
            }
            break;
          case 'NSSF Number':
            if (!nssfRegex.test(deduction.number)) {
              newErrors[`deduction${deduction.name}`] = 'Invalid NSSF number (9 digits)';
              isValid = true;
            }
            break;
          case 'Tax PIN':
            if (!kraPinRegex.test(deduction.number)) {
              newErrors[`deduction${deduction.name}`] = 'Invalid KRA PIN format (e.g., A123456789Z)';
              isValid = true;
            }
            break;
          case 'NITA':
            if (!nitaRegex.test(deduction.number)) {
              newErrors[`deduction${deduction.name}`] = 'Invalid NITA number format';
              isValid = true;
            }
            break;
          case 'HELB':
            if (!helbRegex.test(deduction.number)) {
              newErrors[`deduction${deduction.name}`] = 'Invalid HELB number format';
              isValid = true;
            }
            break;
        }
      }
    });

    setErrors(newErrors);
    return isValid;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      let imageUrl = employee['Profile Image'] || null;
      if (profileImage) {
        const fileExt = profileImage.name.split('.').pop();
        const fileName = `${employee['Employee Number']}.${fileExt}`;
        const filePath = `profile_images/${fileName}`;

        // First delete existing image if it exists
        if (employee['Profile Image']) {
          const { error: deleteError } = await supabase.storage
            .from('employeeavatar')
            .remove([filePath]);

          if (deleteError && deleteError.message !== 'Object not found') {
            throw deleteError;
          }
        }

        // Upload new image
        const { error: uploadError } = await supabase.storage
          .from('employeeavatar')
          .upload(filePath, profileImage);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('employeeavatar')
          .getPublicUrl(filePath);

        imageUrl = publicUrl;
      }

      // Prepare update data, preserving read-only fields for non-HR/Admin users
      let updateData = { ...employee };

      // If user is not HR/Admin, don't update read-only fields
      if (userRole !== 'hr' && userRole !== 'admin') {
        READ_ONLY_FIELDS.forEach(field => {
          delete updateData[field];
        });
      }

      // Always update profile image and statutory deductions
      updateData['Profile Image'] = imageUrl;

      // Update statutory deductions
      const shifNumber = statutoryDeductions.find(d => d.name === 'SHIF Number')?.number || null;
      const nssfNumber = statutoryDeductions.find(d => d.name === 'NSSF Number')?.number || null;
      const taxPin = statutoryDeductions.find(d => d.name === 'Tax PIN')?.number || null;
      const nita = statutoryDeductions.find(d => d.name === 'NITA')?.number || null;
      const helb = statutoryDeductions.find(d => d.name === 'HELB')?.number || null;

      // Update employee data
      const { error: employeeError } = await supabase
        .from('employees')
        .update({
          ...updateData,
          'SHIF Number': shifNumber,
          'NSSF Number': nssfNumber,
          'Tax PIN': taxPin,
          'NITA': nita,
          'HELB': helb
        })
        .eq('"Employee Number"', id);

      if (employeeError) throw employeeError;

      // Update emergency contact (single contact using upsert)
      if (emergencyContact.name.trim()) {
        const { error: contactsError } = await supabase
          .from('emergency_contact')
          .upsert({
            "Employee Number": id,
            full_name: emergencyContact.name,
            relationship: emergencyContact.relationship,
            phone_number: emergencyContact.phone,
            email: emergencyContact.email || null
          }, {
            onConflict: 'Employee Number'
          });

        if (contactsError) throw contactsError;
      } else {
        // If no emergency contact provided, delete existing one
        const { error: deleteContactsError } = await supabase
          .from('emergency_contact')
          .delete()
          .eq('Employee Number', id);

        if (deleteContactsError) throw deleteContactsError;
      }

      // Update dependents
      // First delete all existing dependents
      const { error: deleteDependentsError } = await supabase
        .from('dependents')
        .delete()
        .eq('Employee Number', id);

      if (deleteDependentsError) throw deleteDependentsError;

      // Then insert updated dependents if they exist
      const validDependents = dependents.filter(dependent => dependent.name.trim());
      if (validDependents.length > 0) {
        const dependentsToInsert = validDependents.map(dependent => ({
          "Employee Number": id,
          full_name: dependent.name,
          relationship: dependent.relationship,
          date_birth: dependent.dateOfBirth || null
        }));

        const { error: dependentsError } = await supabase
          .from('dependents')
          .insert(dependentsToInsert);

        if (dependentsError) throw dependentsError;
      }

      setIsEditMode(false);
      navigate(`/staff`, { state: { success: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update employee');
    } finally {
      setSaving(false);
    }
  };

  const handleEditToggle = () => {
    if (isEditMode) {
      // If canceling edit mode, reset form to original values
      setIsEditMode(false);
      setErrors({});
    } else {
      setIsEditMode(true);
    }
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 max-w-6xl mx-auto flex justify-center items-center min-h-[60vh] text-xs"
      >
        <div className="text-center">
          <div className="animate-pulse flex flex-col items-center">
            <div className="w-16 h-16 bg-gradient-to-r from-green-50 to-green-200 rounded-full mb-6"></div>
            <div className="h-5 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full w-64 mb-4"></div>
            <div className="h-4 bg-gradient-to-r from-gray-100 to-gray-200 rounded-full w-48"></div>
          </div>
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 max-w-6xl mx-auto flex justify-center items-center min-h-[60vh] text-xs"
      >
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center border border-red-100">
          <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Error Loading Employee</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <GlowButton
            onClick={() => navigate('/employees')}
            icon={ArrowLeft}
            className="w-full max-w-xs mx-auto text-xs"
          >
            Back to Employee List
          </GlowButton>
        </div>
      </motion.div>
    );
  }

  if (!employee || !employee['Employee Number']) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-6 max-w-6xl mx-auto flex justify-center items-center min-h-[60vh] text-xs"
      >
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center border border-yellow-100">
          <div className="bg-yellow-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-yellow-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Employee Not Found</h2>
          <p className="text-gray-600 mb-6">The requested employee could not be found.</p>
          <GlowButton
            onClick={() => navigate('/employees')}
            icon={ArrowLeft}
            className="w-full max-w-xs mx-auto text-xs"
          >
            Back to Employee List
          </GlowButton>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="p-4 md:p-6 max-w-6xl mx-auto text-xs"
    >
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate(`/staff`)}
          className="flex items-center text-gray-600 hover:text-gray-900 transition-colors group text-xs"
        >
          <div className="p-1 rounded-full group-hover:bg-gray-100 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </div>
          <span className="ml-2 font-medium hidden sm:inline">Back to View</span>
        </button>

        <div className="flex space-x-2">
          {isEditMode ? (
            <>
              <GlowButton
                onClick={handleEditToggle}
                variant="secondary"
                className="mr-2"
                disabled={saving}
              >
                Cancel
              </GlowButton>
              <GlowButton
                onClick={handleSave}
                icon={Save}
                loading={saving}
                className="bg-green-200 hover:green-100 text-black"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </GlowButton>
            </>
          ) : (
            <GlowButton
              onClick={handleEditToggle}
              icon={PencilLine}
              className="bg-green-600 hover:blue-100 text-white"
            >
              update details
            </GlowButton>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-300 overflow-hidden">
        {/* Header */}
        <div className="bg-gray-500 p-6 md:p-8 border-b border-gray-300">
          <div className="flex flex-col md:flex-row md:items-start justify-between">
            <div className="flex items-start space-x-4">
              <div className="relative">
                {isEditMode ? (
                  <div
                    className="bg-gradient-to-br from-green-100 to-emerald-200 w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-emerald-800 cursor-pointer"
                    onClick={triggerFileInput}
                  >
                    {previewImage ? (
                      <img
                        src={previewImage}
                        alt="Profile"
                        className="absolute inset-0 w-16 h-16 rounded-full object-cover"
                      />
                    ) : (
                      <>
                        {employee['First Name']?.[0]}
                        {employee['Last Name']?.[0]}
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={handleImageUpload}
                        />
                      </>
                    )}
                  </div>
                ) : (
                  <div className="bg-white w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-black relative">
                    {previewImage ? (
                      <img
                        src={previewImage}
                        alt="Profile"
                        className="absolute inset-0 w-16 h-16 rounded-full object-cover"
                      />
                    ) : (
                      <>
                        {employee['First Name']?.[0]}
                        {employee['Last Name']?.[0]}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h1 className="text-xl md:text-2xl font-bold text-white">
                  {isEditMode ? 'Edit' : 'View'}: {employee['First Name']} {employee['Last Name']}
                </h1>
                <p className="text-white mt-1">
                  <span className="font-medium">Employee ID:</span> {employee['Employee Number']}
                  {userRole === 'hr' || userRole === 'admin' ? ' (HR/Admin View)' : ' (Employee View)'}
                </p>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-medium mt-4 md:mt-0 ${employee['Termination Date']
              ? 'bg-red-100 text-red-800 border border-red-200'
              : 'bg-green-100 text-green-800 border border-green-200'
              }`}>
              {employee['Termination Date'] ? 'Inactive' : 'Active'}
            </div>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="border-b border-gray-200">
          <nav className="flex overflow-x-auto">
            <button
              onClick={() => setActiveTab('personal')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'personal' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <User className="w-4 h-4 mr-2" />
              Personal
            </button>
            <button
              onClick={() => setActiveTab('employment')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'employment' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Briefcase className="w-4 h-4 mr-2" />
              Employment
            </button>
            <button
              onClick={() => setActiveTab('contact')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'contact' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Phone className="w-4 h-4 mr-2" />
              Contact
            </button>
            <button
              onClick={() => setActiveTab('financial')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'financial' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              Financial
            </button>
            <button
              onClick={() => setActiveTab('emergency')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'emergency' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              Emergency
            </button>
            <button
              onClick={() => setActiveTab('dependents')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'dependents' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Users className="w-4 h-4 mr-2" />
              Dependents
            </button>
          </nav>
        </div>

        {/* Main Content */}
        <div className="p-6 md:p-8">
          {/* Personal Information Tab */}
          {activeTab === 'personal' && (
            <div className="space-y-8">
              {/* Profile Image Section - ALWAYS editable for employees */}
              {isEditMode && (
                <div>
                  <SectionHeader
                    title="Profile Image"
                    icon={User}
                  />
                  <div className="mt-4 flex flex-col md:flex-row items-start gap-8">
                    {/* Photo Upload Card */}
                    <div className="w-full md:w-auto">
                      <div className="relative group">
                        <div
                          className="relative w-40 h-40 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden border-2 border-gray-200 shadow-sm cursor-pointer transition-all duration-300 hover:border-emerald-300 hover:shadow-md"
                          onClick={triggerFileInput}
                        >
                          {previewImage ? (
                            <img
                              src={previewImage}
                              alt="Profile preview"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <div className="relative">
                                <div className="bg-gradient-to-br from-green-100 to-emerald-200 w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-emerald-800">
                                  {employee['First Name']?.[0]}{employee['Last Name']?.[0]}
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-300">
                            <div className="flex flex-col items-center">
                              <Upload className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 mb-1" />
                              <span className="text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300 text-center px-2">
                                {previewImage ? 'Change Photo' : 'Upload Photo'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={handleImageUpload}
                        />
                      </div>

                      <div className="mt-4 flex flex-col sm:flex-row gap-3">
                        <button
                          onClick={triggerFileInput}
                          className="flex-1 flex items-center justify-center px-4 py-2 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors shadow-sm"
                        >
                          <Upload className="w-4 h-4 mr-2 text-gray-500" />
                          <span className="text-xs">{previewImage ? 'Change' : 'Upload'}</span>
                        </button>
                        {previewImage && (
                          <button
                            onClick={() => {
                              setPreviewImage(null);
                              setProfileImage(null);
                            }}
                            className="flex-1 flex items-center justify-center px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-xs text-gray-700"
                          >
                            <X className="w-4 h-4 mr-2" />
                            Remove
                          </button>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-gray-500">JPG, PNG or GIF (Max 5MB)</p>
                      {errors.profileImage && (
                        <p className="mt-1 text-xs text-red-500">{errors.profileImage}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Personal Information Sections */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <SectionHeader
                    title="Personal Information"
                    icon={User}
                  />
                  <div className="grid grid-cols-1 gap-6 mt-4">
                    <FormField
                      label="First Name"
                      name="First Name"
                      value={employee['First Name'] || ''}
                      onChange={handleInputChange}
                      error={errors['First Name']}
                      required={isEditMode}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Middle Name"
                      name="Middle Name"
                      value={employee['Middle Name'] || ''}
                      onChange={handleInputChange}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Last Name"
                      name="Last Name"
                      value={employee['Last Name'] || ''}
                      onChange={handleInputChange}
                      error={errors['Last Name']}
                      required={isEditMode}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Date of Birth"
                      name="Date of Birth"
                      type="date"
                      value={employee['Date of Birth'] || ''}
                      onChange={(e) => handleDateChange('Date of Birth', e.target.value)}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Gender"
                      name="Gender"
                      type={isEditMode ? "select" : "text"}
                      value={employee.Gender || ''}
                      onChange={handleInputChange}
                      options={dropdownOptions.genders}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="National ID"
                      name="ID Number"
                      type="number"
                      value={employee['ID Number'] ? String(employee['ID Number']) : ''}
                      onChange={(e) => {
                        const numValue = e.target.value ? parseInt(e.target.value) : null;
                        setEmployee(prev => ({
                          ...prev,
                          "ID Number": numValue
                        }));
                      }}
                      error={errors['ID Number']}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Passport Number"
                      name="passport_number"
                      value={employee.passport_number || ''}
                      onChange={handleInputChange}
                      error={errors['passport_number']}
                      disabled={!isEditMode}
                    />
                  </div>
                </div>
                <div>
                  <SectionHeader
                    title="Additional Details"
                    icon={User}
                  />
                  <div className="grid grid-cols-1 gap-6 mt-4">
                    <FormField
                      label="Marital Status"
                      name="Marital Status"
                      type={isEditMode ? "select" : "text"}
                      value={employee['Marital Status'] || ''}
                      onChange={handleInputChange}
                      options={['Single', 'Married', 'Divorced', 'Widowed']}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Blood Group"
                      name="blood_group"
                      type={isEditMode ? "select" : "text"}
                      value={employee.blood_group || ''}
                      onChange={handleInputChange}
                      options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Disability Status"
                      name="Disability Cert No"
                      type={isEditMode ? "select" : "text"}
                      value={employee['Disability Cert No'] || ''}
                      onChange={handleInputChange}
                      options={['None', 'Physical', 'Visual', 'Hearing', 'Other']}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Religion"
                      name="religion"
                      value={employee.religion || ''}
                      onChange={handleInputChange}
                      disabled={!isEditMode}
                    />
                    <FormField
                      label="Nationality"
                      name="Country"
                      value={employee.Country || ''}
                      onChange={handleInputChange}
                      disabled={!isEditMode}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Employment Information Tab */}
          {activeTab === 'employment' && (
            <div className="space-y-8">
              <div>
                <SectionHeader
                  title="Employment Information"
                  icon={Briefcase}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  <FormField
                    label="Employee Type"
                    name="Employee Type"
                    type={isEditMode ? "select" : "text"}
                    value={employee['Employee Type'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.employmentTypes}
                    disabled={!isEditMode || !canEditField('Employee Type')}
                    readOnly={!canEditField('Employee Type')}
                    isReadOnly={!canEditField('Employee Type')}
                  />
                  <FormField
                    label="Employment Start Date"
                    name="Start Date"
                    type="date"
                    value={employee['Start Date'] || ''}
                    onChange={(e) => handleDateChange('Start Date', e.target.value)}
                    disabled={!isEditMode || !canEditField('Start Date')}
                    readOnly={!canEditField('Start Date')}
                    isReadOnly={!canEditField('Start Date')}
                  />
                  {employee['Termination Date'] && (
                    <FormField
                      label="Termination Date"
                      name="Termination Date"
                      type="date"
                      value={employee['Termination Date'] || ''}
                      onChange={(e) => handleDateChange('Termination Date', e.target.value)}
                      disabled={!isEditMode || !canEditField('Termination Date')}
                      readOnly={!canEditField('Termination Date')}
                      isReadOnly={!canEditField('Termination Date')}
                    />
                  )}
                  <FormField
                    label="Department"
                    name="Job Level"
                    type={isEditMode ? "select" : "text"}
                    value={employee['Job Level'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.jobLevels}
                    disabled={!isEditMode || !canEditField('Job Level')}
                    readOnly={!canEditField('Job Level')}
                    isReadOnly={!canEditField('Job Level')}
                  />
                  <FormField
                    label="Job Title"
                    name="Job Title"
                    type={isEditMode ? "select" : "text"}
                    value={employee['Job Title'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.jobTitles}
                    disabled={!isEditMode || !canEditField('Job Title')}
                    readOnly={!canEditField('Job Title')}
                    isReadOnly={!canEditField('Job Title')}
                  />
                  <FormField
                    label="Job Group"
                    name="Job Group"
                    type={isEditMode ? "select" : "text"}
                    value={employee['Job Group'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.jobGroup}
                    disabled={!isEditMode || !canEditField('Job Group')}
                    readOnly={!canEditField('Job Group')}
                    isReadOnly={!canEditField('Job Group')}
                  />
                  <FormField
                    label="Branch"
                    name="Branch"
                    type={isEditMode ? "select" : "text"}
                    value={employee.Branch || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.branches}
                    disabled={!isEditMode || !canEditField('Branch')}
                    readOnly={!canEditField('Branch')}
                    isReadOnly={!canEditField('Branch')}
                  />
                  <FormField
                    label="Office Location"
                    name="Town"
                    type={isEditMode ? "select" : "text"}
                    value={employee.Town || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.office}
                    disabled={!isEditMode || !canEditField('Town')}
                    readOnly={!canEditField('Town')}
                    isReadOnly={!canEditField('Town')}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <SectionHeader
                    title="Supervisor Information"
                    icon={User}
                  />
                  <div className="grid grid-cols-1 gap-6 mt-4">
                    <FormField
                      label="Manager"
                      name="Manager"
                      type={isEditMode ? "select" : "text"}
                      value={employee['Manager'] || ''}
                      onChange={handleInputChange}
                      options={dropdownOptions.supervisors}
                      disabled={!isEditMode || !canEditField('Manager')}
                      readOnly={!canEditField('Manager')}
                      isReadOnly={!canEditField('Manager')}
                    />
                    <FormField
                      label="Work Email"
                      name="Work Email"
                      type="email"
                      value={employee['Work Email'] || ''}
                      onChange={handleInputChange}
                      error={errors['Work Email']}
                      disabled={!isEditMode || !canEditField('Work Email')}
                      readOnly={!canEditField('Work Email')}
                      isReadOnly={!canEditField('Work Email')}
                    />
                  </div>
                </div>

                <div>
                  <SectionHeader
                    title="Leave Approvers"
                    icon={User}
                  />
                  <div className="grid grid-cols-1 gap-6 mt-4">
                    <FormField
                      label="Leave Approver"
                      name="Leave Approver"
                      type={isEditMode ? "select" : "text"}
                      value={employee["Leave Approver"] || ''}
                      onChange={handleInputChange}
                      options={dropdownOptions.supervisors}
                      disabled={!isEditMode || !canEditField('Leave Approver')}
                      readOnly={!canEditField('Leave Approver')}
                      isReadOnly={!canEditField('Leave Approver')}
                    />
                    <FormField
                      label="Alternate Leave Approver"
                      name="Alternate Approver"
                      type={isEditMode ? "select" : "text"}
                      value={employee['Alternate Approver'] || ''}
                      onChange={handleInputChange}
                      options={dropdownOptions.supervisors}
                      disabled={!isEditMode || !canEditField('Alternate Approver')}
                      readOnly={!canEditField('Alternate Approver')}
                      isReadOnly={!canEditField('Alternate Approver')}
                    />
                  </div>
                </div>
              </div>

              <div>
                <SectionHeader
                  title="Contract Dates"
                  icon={Briefcase}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  <FormField
                    label="Probation Start Date"
                    name="Probation Start Date"
                    type="date"
                    value={employee['Probation Start Date'] || ''}
                    onChange={(e) => handleDateChange('Probation Start Date', e.target.value)}
                    disabled={!isEditMode || !canEditField('Probation Start Date')}
                    readOnly={!canEditField('Probation Start Date')}
                    isReadOnly={!canEditField('Probation Start Date')}
                  />
                  <FormField
                    label="Probation End Date"
                    name="Probation End Date"
                    type="date"
                    value={employee['Probation End Date'] || ''}
                    onChange={(e) => handleDateChange('Probation End Date', e.target.value)}
                    disabled={!isEditMode || !canEditField('Probation End Date')}
                    readOnly={!canEditField('Probation End Date')}
                    isReadOnly={!canEditField('Probation End Date')}
                  />
                  <FormField
                    label="Contract Start Date"
                    name="Contract Start Date"
                    type="date"
                    value={employee['Contract Start Date'] || ''}
                    onChange={(e) => handleDateChange('Contract Start Date', e.target.value)}
                    disabled={!isEditMode || !canEditField('Contract Start Date')}
                    readOnly={!canEditField('Contract Start Date')}
                    isReadOnly={!canEditField('Contract Start Date')}
                  />
                  <FormField
                    label="Contract End Date"
                    name="Contract End Date"
                    type="date"
                    value={employee['Contract End Date'] || ''}
                    onChange={(e) => handleDateChange('Contract End Date', e.target.value)}
                    disabled={!isEditMode || !canEditField('Contract End Date')}
                    readOnly={!canEditField('Contract End Date')}
                    isReadOnly={!canEditField('Contract End Date')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Contact Information Tab */}
          {activeTab === 'contact' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <SectionHeader
                  title="Contact Information"
                  icon={Phone}
                />
                <div className="grid grid-cols-1 gap-6 mt-4">
                  <FormField
                    label="Personal Email"
                    name="Personal Email"
                    type="email"
                    value={employee['Personal Email'] || ''}
                    onChange={handleInputChange}
                    error={errors['Personal Email']}
                    required={isEditMode}
                    disabled={!isEditMode}
                  />
                  <FormField
                    label="Primary Mobile Number"
                    name="Mobile Number"
                    type="tel"
                    value={employee['Mobile Number'] || ''}
                    onChange={handleInputChange}
                    error={errors['Mobile Number']}
                    required={isEditMode}
                    disabled={!isEditMode}
                    placeholder="e.g., +254712345678"
                  />
                  <FormField
                    label="Work Mobile Number"
                    name="Work Mobile"
                    type="tel"
                    value={employee['Work Mobile'] || ''}
                    onChange={handleInputChange}
                    error={errors['Work Mobile']}
                    disabled={!isEditMode || !canEditField('Work Mobile')}
                    readOnly={!canEditField('Work Mobile')}
                    isReadOnly={!canEditField('Work Mobile')}
                    placeholder="Company-provided mobile"
                  />
                  <FormField
                    label="Personal Mobile Number"
                    name="Personal Mobile"
                    type="tel"
                    value={employee['Personal Mobile'] || ''}
                    onChange={handleInputChange}
                    error={errors['Personal Mobile']}
                    disabled={!isEditMode}
                    placeholder="Optional personal mobile"
                  />
                  <FormField
                    label="Alternative Mobile Number"
                    name="Alternative Mobile Number"
                    type="tel"
                    value={employee['Alternative Mobile Number'] || ''}
                    onChange={handleInputChange}
                    error={errors['Alternative Mobile Number']}
                    placeholder="Optional alternative mobile"
                  />
                </div>
              </div>
              <div>
                <SectionHeader
                  title="Address Information"
                  icon={MapPin}
                />
                <div className="grid grid-cols-1 gap-6 mt-4">
                  <FormField
                    label="Physical Address"
                    name="Area"
                    value={employee.Area || ''}
                    onChange={handleInputChange}
                    disabled={!isEditMode}
                  />
                  <FormField
                    label="City/Town"
                    name="City"
                    value={employee.City || ''}
                    onChange={handleInputChange}
                    disabled={!isEditMode}
                  />
                  <FormField
                    label="Postal Code"
                    name="Postal Code"
                    value={employee['Postal Code'] || ''}
                    onChange={handleInputChange}
                    disabled={!isEditMode}
                  />
                  <FormField
                    label="Country"
                    name="Country"
                    value={employee.Country || ''}
                    onChange={handleInputChange}
                    disabled={!isEditMode}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Financial Information Tab */}
          {activeTab === 'financial' && (
            <div className="space-y-8">
              <div>
                <SectionHeader
                  title="Banking Information"
                  icon={CreditCard}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                  <FormField
                    label="Bank Name"
                    name="Bank"
                    value={employee['Bank'] || ''}
                    onChange={handleInputChange}
                    disabled={!isEditMode || !canEditField('Bank')}
                    readOnly={!canEditField('Bank')}
                    isReadOnly={!canEditField('Bank')}
                  />
                  <FormField
                    label="Account Number"
                    name="Account Number"
                    value={employee['Account Number'] || ''}
                    onChange={handleInputChange}
                    disabled={!isEditMode || !canEditField('Account Number')}
                    readOnly={!canEditField('Account Number')}
                    isReadOnly={!canEditField('Account Number')}
                  />
                  <FormField
                    label="Account Name"
                    name="account_number_name"
                    value={employee.account_number_name || ''}
                    onChange={handleInputChange}
                    disabled={!isEditMode || !canEditField('account_number_name')}
                    readOnly={!canEditField('account_number_name')}
                    isReadOnly={!canEditField('account_number_name')}
                  />
                  <FormField
                    label="Bank Branch"
                    name="Bank Branch"
                    value={employee['Bank Branch'] || ''}
                    onChange={handleInputChange}
                    disabled={!isEditMode || !canEditField('Bank Branch')}
                    readOnly={!canEditField('Bank Branch')}
                    isReadOnly={!canEditField('Bank Branch')}
                  />
                  <FormField
                    label="Payment Method"
                    name="payment_method"
                    type={isEditMode ? "select" : "text"}
                    value={employee['payment_method'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.paymentMethods}
                    disabled={!isEditMode || !canEditField('payment_method')}
                    readOnly={!canEditField('payment_method')}
                    isReadOnly={!canEditField('payment_method')}
                  />
                </div>
              </div>

              {userRole === 'admin' && (
                <div>
                  <SectionHeader
                    title="Salary Information"
                    icon={CreditCard}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                    <FormField
                      label="Basic Salary"
                      name="Basic Salary"
                      type="number"
                      value={employee['Basic Salary'] ? String(employee['Basic Salary']) : ''}
                      onChange={(e) => {
                        const numValue = e.target.value ? parseFloat(e.target.value) : null;
                        setEmployee(prev => ({
                          ...prev,
                          "Basic Salary": numValue
                        }));
                      }}
                      disabled={!isEditMode || !canEditField('Basic Salary')}
                      readOnly={!canEditField('Basic Salary')}
                      isReadOnly={!canEditField('Basic Salary')}
                    />
                    <FormField
                      label="Currency"
                      name="Currency"
                      type={isEditMode ? "select" : "text"}
                      value={employee['Currency'] || 'KES'}
                      onChange={handleInputChange}
                      options={['KES', 'USD', 'EUR', 'GBP']}
                      disabled={!isEditMode || !canEditField('Currency')}
                      readOnly={!canEditField('Currency')}
                      isReadOnly={!canEditField('Currency')}
                    />
                  </div>
                </div>
              )}

              <div>
                <SectionHeader
                  title="Statutory Deductions"
                  icon={CreditCard}
                />
                <div className="grid grid-cols-1 gap-6 mt-4">
                  {statutoryDeductions.map((deduction, index) => (
                    <div key={index} className="flex items-center gap-4">
                      <div className="flex items-center">
                        {isEditMode ? (
                          <button
                            type="button"
                            className={`w-6 h-6 rounded flex items-center justify-center border ${deduction.isActive ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'}`}
                            onClick={() => handleStatutoryDeductionChange(index, 'isActive', !deduction.isActive)}
                            disabled={!isEditMode}
                          >
                            {deduction.isActive && <Check className="w-4 h-4 text-white" />}
                          </button>
                        ) : (
                          <div className={`w-6 h-6 rounded flex items-center justify-center border ${deduction.isActive ? 'bg-emerald-100 border-emerald-300' : 'border-gray-200 bg-gray-50'}`}>
                            {deduction.isActive && <Check className="w-4 h-4 text-emerald-600" />}
                          </div>
                        )}
                        <span className="ml-2 font-medium min-w-[100px]">{deduction.name}</span>
                      </div>
                      {deduction.isActive && (
                        <div className="flex-1">
                          {isEditMode ? (
                            <input
                              type="text"
                              value={deduction.number}
                              onChange={(e) => handleStatutoryDeductionChange(index, 'number', e.target.value)}
                              className={`w-full h-11 bg-gray-50 border-gray-300 border rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
                              placeholder={`Enter ${deduction.name}`}
                              disabled={!isEditMode}
                              onBlur={() => validateField(`deduction${deduction.name}`, deduction.number)}
                            />
                          ) : (
                            <div className="w-full h-11 bg-gray-100 border-gray-200 border rounded-lg px-4 py-2 text-gray-900">
                              {deduction.number}
                            </div>
                          )}
                          {errors[`deduction${deduction.name}`] && (
                            <p className="mt-1 text-xs text-red-500">{errors[`deduction${deduction.name}`]}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Emergency Contact Tab */}
          {activeTab === 'emergency' && (
            <div>
              <SectionHeader
                title="Emergency Contact"
                icon={AlertCircle}
              />
              <p className="text-gray-600 mb-6">Primary emergency contact for this employee</p>

              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={emergencyContact.name}
                      onChange={(e) => handleEmergencyContactChange('name', e.target.value)}
                      className={`w-full h-11 ${isEditMode ? 'bg-white border-gray-300' : 'bg-gray-100 border-gray-200'} border rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
                      placeholder="Full Name"
                      disabled={!isEditMode}
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">Relationship</label>
                    <input
                      type="text"
                      value={emergencyContact.relationship}
                      onChange={(e) => handleEmergencyContactChange('relationship', e.target.value)}
                      className={`w-full h-11 ${isEditMode ? 'bg-white border-gray-300' : 'bg-gray-100 border-gray-200'} border rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
                      placeholder="Relationship"
                      disabled={!isEditMode}
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">Phone Number</label>
                    <input
                      type="tel"
                      value={emergencyContact.phone}
                      onChange={(e) => handleEmergencyContactChange('phone', e.target.value)}
                      className={`w-full h-11 ${isEditMode ? 'bg-white border-gray-300' : 'bg-gray-100 border-gray-200'} border rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
                      placeholder="Phone Number"
                      disabled={!isEditMode}
                      onBlur={() => validateField('emergencyContactPhone', emergencyContact.phone)}
                    />
                    {errors['emergencyContactPhone'] && (
                      <p className="mt-1 text-xs text-red-500">{errors['emergencyContactPhone']}</p>
                    )}
                  </div>
                  <div>
                    <label className="block font-medium text-gray-700 mb-1">Email (Optional)</label>
                    <input
                      type="email"
                      value={emergencyContact.email || ''}
                      onChange={(e) => handleEmergencyContactChange('email', e.target.value)}
                      className={`w-full h-11 ${isEditMode ? 'bg-white border-gray-300' : 'bg-gray-100 border-gray-200'} border rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
                      placeholder="Email"
                      disabled={!isEditMode}
                      onBlur={() => {
                        if (emergencyContact.email) {
                          validateField('emergencyContactEmail', emergencyContact.email);
                        }
                      }}
                    />
                    {errors['emergencyContactEmail'] && (
                      <p className="mt-1 text-xs text-red-500">{errors['emergencyContactEmail']}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Dependents Tab */}
          {activeTab === 'dependents' && (
            <div>
              <SectionHeader
                title="Dependents"
                icon={Users}
              />
              <p className="text-gray-600 mb-6">List of dependents for this employee (spouse, children, etc.)</p>

              <div className="space-y-6">
                {dependents.map((dependent, index) => (
                  <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="font-medium text-gray-700">Dependent #{index + 1}</h3>
                      {isEditMode && dependents.length > 1 && (
                        <button
                          onClick={() => removeDependent(index)}
                          className="text-red-500 hover:text-red-700 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Full Name</label>
                        <input
                          type="text"
                          value={dependent.name}
                          onChange={(e) => handleDependentChange(index, 'name', e.target.value)}
                          className={`w-full h-11 ${isEditMode ? 'bg-white border-gray-300' : 'bg-gray-100 border-gray-200'} border rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
                          placeholder="Full Name"
                          disabled={!isEditMode}
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Relationship</label>
                        <input
                          type="text"
                          value={dependent.relationship}
                          onChange={(e) => handleDependentChange(index, 'relationship', e.target.value)}
                          className={`w-full h-11 ${isEditMode ? 'bg-white border-gray-300' : 'bg-gray-100 border-gray-200'} border rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
                          placeholder="Relationship"
                          disabled={!isEditMode}
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-gray-700 mb-1">Date of Birth (Optional)</label>
                        <input
                          type="date"
                          value={dependent.dateOfBirth || ''}
                          onChange={(e) => handleDependentChange(index, 'dateOfBirth', e.target.value)}
                          className={`w-full h-11 ${isEditMode ? 'bg-white border-gray-300' : 'bg-gray-100 border-gray-200'} border rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
                          disabled={!isEditMode}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {isEditMode && (
                <button
                  onClick={addDependent}
                  className="mt-4 flex items-center text-emerald-600 hover:text-emerald-800 transition-colors"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Another Dependent
                </button>
              )}
            </div>
          )}

          {Object.keys(errors).length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600"
            >
              <h3 className="font-medium mb-2">Please fix the following errors:</h3>
              <ul className="list-disc pl-5 space-y-1">
                {Object.entries(errors).map(([field, errorMsg]) => (
                  <li key={field}>{errorMsg}</li>
                ))}
              </ul>
            </motion.div>
          )}
        </div>

        {/* Footer Actions */}
        {isEditMode && (
          <div className="p-6 border-t border-gray-300 bg-gray-50">
            <div className="flex justify-end space-x-3">
              <GlowButton
                onClick={handleEditToggle}
                variant="secondary"
                disabled={saving}
              >
                Cancel
              </GlowButton>
              <GlowButton
                onClick={handleSave}
                icon={Save}
                loading={saving}
                className="bg-green-600 hover:bg-green-400 text-white"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </GlowButton>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

// Reusable Section Header Component
const SectionHeader = ({ title, icon: Icon }: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}) => (
  <div className="flex items-center mb-2">
    <div className="p-1.5 mr-2 rounded-full bg-gray-100">
      <Icon className="w-5 h-5 text-gray-500" />
    </div>
    <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
  </div>
);

// Reusable Form Field Component with read-only support
const FormField = ({
  label,
  value,
  onChange,
  name,
  type = 'text',
  required = false,
  options = [],
  disabled = false,
  readOnly = false,
  isReadOnly = false,
  error = '',
  placeholder = '',
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  name?: string;
  type?: string;
  required?: boolean;
  options?: string[];
  disabled?: boolean;
  readOnly?: boolean;
  isReadOnly?: boolean;
  error?: string;
  placeholder?: string;
}) => {
  const fieldId = `field-${name || label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="space-y-1">
      <label htmlFor={fieldId} className="block font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
        {isReadOnly && (
          <span className="ml-2 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            Read-only
          </span>
        )}
      </label>
      {type === 'select' ? (
        <select
          id={fieldId}
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled || readOnly}
          className={`w-full h-11 ${disabled || readOnly ? 'bg-gray-50 border-gray-200 cursor-not-allowed' : 'bg-white border-gray-300'} rounded-lg px-4 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
          style={readOnly ? { pointerEvents: 'none' } : {}}
        >
          <option value="">Select {label}</option>
          {options.map(option => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : (
        <input
          id={fieldId}
          type={type}
          name={name}
          value={value}
          onChange={onChange}
          required={required}
          disabled={disabled || readOnly}
          readOnly={readOnly}
          placeholder={placeholder}
          className={`w-full h-11 ${disabled || readOnly ? 'bg-gray-50 border-gray-200 cursor-not-allowed' : 'bg-white border-gray-300'} rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm`}
          style={readOnly ? { pointerEvents: 'none' } : {}}
        />
      )}
      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
      )}
    </div>
  );
};

export default EmployeeBioPage;