import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../ProtectedRoutes/UserContext';
import { X, Plus, ArrowLeft, User, Briefcase, Phone, CreditCard, MapPin, Upload, AlertCircle, Users, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '../../lib/supabase';
import { Database } from '../../types/supabase';
import GlowButton from '../UI/GlowButton';
import SearchableDropdown from '../UI/SearchableDropdown';

type Employee = Database['public']['Tables']['employees']['Row'] & {
  'Work Mobile': string | null;
  'Personal Mobile': string | null;
  'Alternative Mobile Number': string | null;
  'SHIF Number': string | null;
  'NSSF Number': string | null;
  'Tax PIN': string | null;
  'NITA': string | null;
  'HELB': string | null;
};

type DropdownOptions = {
  employmentTypes: string[];
  branches: string[];
  jobLevels: string[];
  jobGroup: string[];
  office: string[];
  jobTitles: string[];
  supervisors: string[];
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
  columnName: string;
};

const phoneRegex = /^[+]{0,1}[\s0-9]{8,15}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const idNumberRegex = /^[0-9]{6,12}$/;
const passportRegex = /^[A-Za-z0-9]{6,12}$/;
const kraPinRegex = /^[A-Z]{1}[0-9]{9}[A-Z]{1}$/;
const nhifRegex = /^[0-9]{5,10}$/;
const nssfRegex = /^[0-9]{9}$/;

const AddEmployeePage = () => {
  const navigate = useNavigate();
  const { user } = useUser();
  const isAdmin = user?.role === 'ADMIN';
  const isHR = user?.role === 'HR';

  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [dropdownOptions, setDropdownOptions] = useState<DropdownOptions>({
    employmentTypes: [],
    branches: [],
    jobLevels: [],
    jobGroup: [],
    office: [],
    jobTitles: [],
    supervisors: []
  });
  const [activeTab, setActiveTab] = useState('personal');
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([{ name: '', relationship: '', phone: '' }]);
  const [dependents, setDependents] = useState<Dependent[]>([{ name: '', relationship: '' }]);
  const [statutoryDeductions, setStatutoryDeductions] = useState<StatutoryDeduction[]>([
    { name: 'KRA PIN', number: '', isActive: false, columnName: 'Tax PIN' },
    { name: 'NHIF', number: '', isActive: false, columnName: 'SHIF Number' },
    { name: 'NSSF', number: '', isActive: false, columnName: 'NSSF Number' },
    { name: 'HELB', number: '', isActive: false, columnName: 'HELB' },
    { name: 'NITA', number: '', isActive: false, columnName: 'NITA' }
  ]);
  const [isPageLoading, setIsPageLoading] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsPageLoading(false);
    }, 1000);

    const fetchDropdownOptions = async () => {
      try {
        setLoading(true);

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

        setDropdownOptions({
          employmentTypes: [...new Set(empTypes?.map(item => item['Employee Type'] as string))],
          branches: [...new Set(branches?.map(item => item.Branch as string))],
          jobLevels: [...new Set(jobLevels?.map(item => item['Job Level'] as string))],
          jobGroup: [...new Set(jobGroup?.map(item => item['Job Group'] as string))],
          office: [...new Set(office?.map(item => item.Town as string))],
          jobTitles: [...new Set(jobTitles?.map(item => item['Job Title'] as string))],
          supervisors: supervisors?.map(item => `${item['First Name']} ${item['Last Name']}`) || []
        });
      } catch (err) {
        console.error('Error fetching dropdown options:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchDropdownOptions();

    return () => clearTimeout(timer);
  }, []);

  const validateField = (name: string, value: string | number | null | undefined) => {
    let error = '';

    if (typeof value === 'string' && !value.trim() && ['First Name', 'Last Name', 'Employee Type', 'Start Date', 'Job Title', 'Job Level', 'Mobile Number', 'Personal Email', 'Work Email'].includes(name)) {
      error = 'This field is required';
    } else if (name === 'profileImage' && !profileImage) {
      error = 'Profile image is required';
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
        case 'Tax PIN':
          if (value && !kraPinRegex.test(String(value))) {
            error = 'Invalid KRA PIN format (e.g., A123456789Z)';
          }
          break;
        // case 'SHIF Number':
        //   if (value && !nhifRegex.test(String(value))) {
        //     error = 'Invalid SHIF Number (8-10 digits)';
        //   }
        //   break;
        // case 'NSSF Number':
        //   if (value && !nssfRegex.test(String(value))) {
        //     error = 'Invalid NSSF number (9 digits)';
        //   }
        //   break;
      }
    }

    setErrors(prev => ({ ...prev, [name]: error }));
    return !error;
  };

  const validateForm = () => {
    let isValid = true;
    const newErrors: Record<string, string> = {};

    // Required fields validation
    if (!profileImage) {
      newErrors.profileImage = 'Profile image is required';
      isValid = false;
    }
    if (!newEmployee['First Name']) {
      newErrors['First Name'] = 'First Name is required';
      isValid = false;
    }
    if (!newEmployee['Last Name']) {
      newErrors['Last Name'] = 'Last Name is required';
      isValid = false;
    }
    if (!newEmployee['Employee Type']) {
      newErrors['Employee Type'] = 'Employee Type is required';
      isValid = false;
    }
    if (!newEmployee['Start Date']) {
      newErrors['Start Date'] = 'Start Date is required';
      isValid = false;
    }
    if (!newEmployee['Mobile Number']) {
      newErrors['Mobile Number'] = 'Mobile Number is required';
      isValid = false;
    } else if (!phoneRegex.test(newEmployee['Mobile Number'])) {
      newErrors['Mobile Number'] = 'Invalid phone number format';
      isValid = false;
    }
    if (!newEmployee['Personal Email']) {
      newErrors['Personal Email'] = 'Personal Email is required';
      isValid = false;
    } else if (!emailRegex.test(newEmployee['Personal Email'])) {
      newErrors['Personal Email'] = 'Invalid email format';
      isValid = false;
    }

    // Emergency contacts validation
    emergencyContacts.forEach((contact, index) => {
      if (!contact.name) {
        newErrors[`emergencyContactName${index}`] = 'Name is required';
        isValid = false;
      }
      if (!contact.relationship) {
        newErrors[`emergencyContactRelationship${index}`] = 'Relationship is required';
        isValid = false;
      }
      if (!contact.phone) {
        newErrors[`emergencyContactPhone${index}`] = 'Phone is required';
        isValid = false;
      } else if (!phoneRegex.test(contact.phone)) {
        newErrors[`emergencyContactPhone${index}`] = 'Invalid phone format';
        isValid = false;
      }
      if (contact.email && !emailRegex.test(contact.email)) {
        newErrors[`emergencyContactEmail${index}`] = 'Invalid email format';
        isValid = false;
      }
    });

    // Statutory deductions validation
    statutoryDeductions.forEach((deduction) => {
      if (deduction.isActive && !deduction.number) {
        newErrors[`deduction${deduction.columnName}`] = `${deduction.name} number is required`;
        isValid = true;
      } else if (deduction.isActive && deduction.number) {
        switch (deduction.name) {
          case 'KRA PIN':
            if (!kraPinRegex.test(deduction.number)) {
              newErrors[`deduction${deduction.columnName}`] = 'Invalid KRA PIN format';
              isValid = false;
            }
            break;
          case 'NHIF':
            if (!nhifRegex.test(deduction.number)) {
              newErrors[`deduction${deduction.columnName}`] = 'Invalid SHIF Number';
              isValid = false;
            }
            break;
          case 'NSSF':
            if (!nssfRegex.test(deduction.number)) {
              newErrors[`deduction${deduction.columnName}`] = 'Invalid NSSF number';
              isValid = false;
            }
            break;
        }
      }
    });

    setErrors(newErrors);
    return isValid;
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
    setNewEmployee(prev => ({
      ...prev,
      [name]: value
    }));

    // Validate on change
    validateField(name, value);
  };

  const handleEmergencyContactChange = (index: number, field: keyof EmergencyContact, value: string) => {
    const updatedContacts = [...emergencyContacts];
    updatedContacts[index] = {
      ...updatedContacts[index],
      [field]: value
    };
    setEmergencyContacts(updatedContacts);

    // Validate on change
    if (field === 'phone') {
      validateField(`emergencyContactPhone${index}`, value);
    } else if (field === 'email' && value) {
      validateField(`emergencyContactEmail${index}`, value);
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

    // Update the newEmployee state with the deduction value
    if (field === 'number' && updatedDeductions[index].isActive) {
      setNewEmployee(prev => ({
        ...prev,
        [updatedDeductions[index].columnName]: value as string
      }));
    }

    // Validate on change if it's the number field
    if (field === 'number' && updatedDeductions[index].isActive) {
      validateField(updatedDeductions[index].columnName, String(value));
    }
  };

  const addEmergencyContact = () => {
    setEmergencyContacts([...emergencyContacts, { name: '', relationship: '', phone: '' }]);
  };

  const removeEmergencyContact = (index: number) => {
    if (emergencyContacts.length > 1) {
      const updatedContacts = [...emergencyContacts];
      updatedContacts.splice(index, 1);
      setEmergencyContacts(updatedContacts);

      // Remove any errors for this contact
      const newErrors = { ...errors };
      delete newErrors[`emergencyContactName${index}`];
      delete newErrors[`emergencyContactRelationship${index}`];
      delete newErrors[`emergencyContactPhone${index}`];
      delete newErrors[`emergencyContactEmail${index}`];
      setErrors(newErrors);
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

  const handleAddEmployee = async () => {
    if (!validateForm()) {
      // Group errors by tab
      const errorsByTab: Record<string, string[]> = {};

      Object.keys(errors).forEach(fieldName => {
        if (errors[fieldName]) {
          const tab = getTabForField(fieldName);
          if (!errorsByTab[tab]) {
            errorsByTab[tab] = [];
          }
          errorsByTab[tab].push(`${getFieldLabel(fieldName)}: ${errors[fieldName]}`);
        }
      });

      // Set the first tab with errors as active
      const firstErrorTab = Object.keys(errorsByTab)[0];
      if (firstErrorTab) {
        setActiveTab(firstErrorTab);

        // Scroll to the first error field
        const firstErrorField = Object.keys(errors).find(field => errors[field]);
        if (firstErrorField) {
          const firstErrorElement = document.querySelector(`[name="${firstErrorField}"]`);
          if (firstErrorElement) {
            setTimeout(() => {
              firstErrorElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
          }
        }
      }

      return;
    }

    try {
      setLoading(true);
      setErrors({});

      let imageUrl = null;
      if (profileImage) {
        const fileExt = profileImage.name.split('.').pop();
        const fileName = `${newEmployee['Employee Number'] || `MCL-${Date.now().toString().slice(-6)}`}.${fileExt}`;
        const filePath = `profile_images/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('employeeavatar')
          .upload(filePath, profileImage);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('employeeavatar')
          .getPublicUrl(filePath);

        imageUrl = publicUrl;
      }

      // Prepare statutory deductions data for employee table
      const employeeDeductions: Partial<Employee> = {};
      statutoryDeductions.forEach(deduction => {
        if (deduction.isActive && deduction.number) {
          employeeDeductions[deduction.columnName as keyof Employee] = deduction.number as any;
        }
      });

      const { data: employeeData, error: employeeError } = await supabase
        .from('employees')
        .insert([{
          ...newEmployee,
          ...employeeDeductions,
          'Employee Number': newEmployee['Employee Number'] || `MCL-${Date.now().toString().slice(-6)}`,
          'Profile Image': imageUrl
        }])
        .select();

      if (employeeError) throw employeeError;

      const employeeId = employeeData?.[0]?.["Employee Number"];
      if (!employeeId) throw new Error('Failed to get employee Number after creation');

      if (emergencyContacts.length > 0 && emergencyContacts[0].name) {
        const contactsToInsert = emergencyContacts.map(contact => ({
          "Employee Number": employeeId,
          full_name: contact.name,
          relationship: contact.relationship,
          phone_number: contact.phone,
          email: contact.email || null
        }));

        const { error: contactsError } = await supabase
          .from('emergency_contact')
          .insert(contactsToInsert);

        if (contactsError) throw contactsError;
      }

      if (dependents.length > 0 && dependents[0].name) {
        const dependentsToInsert = dependents.map(dependent => ({
          "Employee Number": employeeId,
          full_name: dependent.name,
          relationship: dependent.relationship,
          date_birth: dependent.dateOfBirth || null
        }));

        const { error: dependentsError } = await supabase
          .from('dependents')
          .insert(dependentsToInsert);

        if (dependentsError) throw dependentsError;
      }

      navigate('/employee-added', {
        state: {
          success: true,
          employeeNumber: employeeId,
          employeeName: `${newEmployee['First Name']} ${newEmployee['Last Name']}`,
          workEmail: newEmployee['Work Email'],
          personalEmail: newEmployee['Personal Email']
        }
      });

    } catch (err) {
      console.error('Error adding employee:', err);
      setErrors({ form: err instanceof Error ? err.message : 'Failed to add employee' });
    } finally {
      setLoading(false);
    }
  };

  // Helper functions
  const getTabForField = (fieldName: string): string => {
    if (fieldName === 'profileImage') return 'personal';

    const personalFields = ['First Name', 'Last Name', 'Middle Name', 'Date of Birth', 'Gender',
      'ID Number', 'passport_number', 'Marital Status', 'blood_group', 'Disability Cert No',
      'religion', 'Country'];
    if (personalFields.includes(fieldName)) return 'personal';

    const employmentFields = ['Employee Type', 'Start Date', 'Job Level', 'Job Title', 'Branch',
      'Town', 'Manager', 'Work Email', 'Leave Approver', 'Alternate Approver',
      'second_level_leave_approver', 'alternate_second_level_approver', 'internship_start_date',
      'Internship End Date', 'Probation Start Date', 'Probation End Date', 'Contract Start Date',
      'Contract End Date', 'Job Group'];
    if (employmentFields.includes(fieldName)) return 'employment';

    const contactFields = ['Personal Email', 'Mobile Number', 'Work Mobile', 'Personal Mobile',
      'Alternative Mobile Number', 'Area', 'City', 'Postal Code'];
    if (contactFields.includes(fieldName)) return 'contact';

    const financialFields = ['Bank', 'Account Number', 'account_number_name', 'Bank Branch',
      'payment_method', 'Basic Salary', 'Currency', 'Tax PIN', 'SHIF Number', 'NSSF Number', 'HELB', 'NITA'];
    if (financialFields.includes(fieldName)) return 'financial';

    if (fieldName.startsWith('emergencyContact')) return 'emergency';
    if (fieldName.startsWith('dependent')) return 'dependents';

    return 'personal';
  };

  const getFieldLabel = (fieldName: string): string => {
    if (fieldName === 'profileImage') return 'Profile Image';
    if (fieldName.startsWith('emergencyContactName')) return 'Emergency Contact Name';
    if (fieldName.startsWith('emergencyContactRelationship')) return 'Emergency Contact Relationship';
    if (fieldName.startsWith('emergencyContactPhone')) return 'Emergency Contact Phone';
    if (fieldName.startsWith('emergencyContactEmail')) return 'Emergency Contact Email';
    if (fieldName.startsWith('deduction')) return fieldName.replace('deduction', '');
    return fieldName;
  };

  const getTabName = (tabKey: string): string => {
    const tabNames: Record<string, string> = {
      personal: 'Personal Information',
      employment: 'Employment Information',
      contact: 'Contact Information',
      financial: 'Financial Information',
      emergency: 'Emergency Contacts',
      dependents: 'Dependents'
    };
    return tabNames[tabKey] || tabKey;
  };

  if (isPageLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <motion.div
          animate={{
            rotate: 360,
            scale: [1, 1.2, 1]
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "linear"
          }}
          className="w-16 h-16 border-4 border-gray-900 border-t-transparent rounded-full"
        />
      </div>
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
          onClick={() => navigate('/employees')}
          className="flex items-center text-gray-600 hover:text-gray-900 transition-colors group"
        >
          <div className="p-1.5 rounded-full bg-gray-100 group-hover:bg-gray-200 transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-500" />
          </div>
          <span className="ml-2 font-medium hidden sm:inline">Back to Employees</span>
        </button>
      </div>

      <motion.div
        ref={formRef}
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden"
      >
        {/* Form Header */}
        <div className="bg-white p-6 border-b border-gray-200">
          <div className="flex items-center">
            <div className="mr-4">
              <img
                src="/avatar.png"
                alt="avatar"
                className="w-16 h-16 rounded-full border-2 border-gray-100 shadow-sm"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Add New Employee</h1>
              <p className="text-gray-600 mt-1">Fill in the details below to add a new employee</p>
            </div>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="border-b border-gray-200">
          <nav className="flex overflow-x-auto">
            <button
              onClick={() => setActiveTab('personal')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'personal' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <User className="w-4 h-4 mr-2" />
              Personal
            </button>
            <button
              onClick={() => setActiveTab('employment')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'employment' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Briefcase className="w-4 h-4 mr-2" />
              Employment
            </button>
            <button
              onClick={() => setActiveTab('contact')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'contact' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Phone className="w-4 h-4 mr-2" />
              Contact
            </button>
            <button
              onClick={() => setActiveTab('financial')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'financial' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <CreditCard className="w-4 h-4 mr-2" />
              Financial
            </button>
            <button
              onClick={() => setActiveTab('emergency')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'emergency' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              Emergency
            </button>
            <button
              onClick={() => setActiveTab('dependents')}
              className={`px-6 py-3 font-medium text-xs flex items-center ${activeTab === 'dependents' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Users className="w-4 h-4 mr-2" />
              Dependents
            </button>
          </nav>
        </div>

        <div className="p-6 md:p-8">
          {/* Modern Profile Image Section - Only shown on personal tab */}
          {activeTab === 'personal' && (
            <div className="mb-8">
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
                            <img
                              src="/avat.png"
                              alt="Default avatar"
                              className="w-50 h-50 opacity-70"
                            />
                            <div className="absolute inset-0 bg-gradient-to-br from-transparent to-white opacity-20 rounded-full" />
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

                {/* Employee Number and Basic Info */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    label="Employee Number (Autogenerated)"
                    name="Employee Number"
                    value={newEmployee['Employee Number'] || `MCL-${Date.now().toString().slice(-6)}`}
                    onChange={handleInputChange}
                    disabled
                  />
                  <FormField
                    label="First Name"
                    name="First Name"
                    value={newEmployee['First Name'] || ''}
                    onChange={handleInputChange}
                    error={errors['First Name']}
                    required
                  />
                  <FormField
                    label="Middle Name"
                    name="Middle Name"
                    value={newEmployee['Middle Name'] || ''}
                    onChange={handleInputChange}
                  />
                  <FormField
                    label="Last Name"
                    name="Last Name"
                    value={newEmployee['Last Name'] || ''}
                    onChange={handleInputChange}
                    error={errors['Last Name']}
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Tab Content */}
          <div className="space-y-8">
            {/* Personal Information Tab */}
            {activeTab === 'personal' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <SectionHeader
                    title="Personal Information"
                    icon={User}
                  />
                  <div className="grid grid-cols-1 gap-6 mt-4">
                    <FormField
                      label="Date of Birth"
                      name="Date of Birth"
                      type="date"
                      value={newEmployee['Date of Birth'] || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="Gender"
                      name="Gender"
                      type="select"
                      value={newEmployee.Gender || ''}
                      onChange={handleInputChange}
                      options={['Male', 'Female', 'Other']}
                    />
                    <FormField
                      label="National ID"
                      name="ID Number"
                      type="text"
                      required
                      value={newEmployee['ID Number'] ? String(newEmployee['ID Number']) : ''}
                      onChange={(e) => {
                        const numValue = e.target.value ? parseInt(e.target.value) : null;
                        setNewEmployee(prev => ({
                          ...prev,
                          "ID Number": numValue
                        }));

                        validateField('ID Number', e.target.value);
                      }}
                      error={errors['ID Number']}
                    />
                    <FormField
                      label="Passport Number"
                      name="passport_number"
                      value={newEmployee.passport_number || ''}
                      onChange={handleInputChange}
                      error={errors['passport_number']}
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
                      type="select"
                      value={newEmployee['Marital Status'] || ''}
                      onChange={handleInputChange}
                      options={['Single', 'Married', 'Divorced', 'Widowed']}
                    />
                    <FormField
                      label="Blood Group"
                      name="blood_group"
                      type="select"
                      value={newEmployee.blood_group || ''}
                      onChange={handleInputChange}
                      options={['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']}
                    />
                    <FormField
                      label="Disability Status"
                      name="Disability Cert No"
                      type="select"
                      value={newEmployee['Disability Cert No'] || ''}
                      onChange={handleInputChange}
                      options={['None', 'Physical', 'Visual', 'Hearing', 'Other']}
                    />
                    <FormField
                      label="Religion"
                      name="religion"
                      value={newEmployee.religion || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="Nationality"
                      name="Country"
                      type="select"
                      value={newEmployee.Country || ''}
                      onChange={handleInputChange}
                      options={[
                        'Kenyan Citizen',
                        'East African Community',
                        'Other African',
                        'International'
                      ]}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Employment Information Tab */}
            {activeTab === 'employment' && (
              <div className="grid grid-cols-1 gap-6">
                <SectionHeader
                  title="Employment Information"
                  icon={Briefcase}
                />

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <FormField
                    label="Employee Type"
                    name="Employee Type"
                    type="select"
                    value={newEmployee['Employee Type'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.employmentTypes}
                    error={errors['Employee Type']}
                    required
                  />
                  <FormField
                    label="Employment Start Date"
                    name="Start Date"
                    type="date"
                    value={newEmployee['Start Date'] || ''}
                    onChange={handleInputChange}
                    error={errors['Start Date']}
                    required
                  />
                  <FormField
                    label="Department"
                    name="Job Level"
                    type="select"
                    value={newEmployee['Job Level'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.jobLevels}
                    error={errors['Job Level']}
                  />
                  <FormField
                    label="Job Title"
                    name="Job Title"
                    type="select"
                    value={newEmployee['Job Title'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.jobTitles}
                    error={errors['Job Title']}
                  />

                  <FormField
                    label="Branch"
                    name="Branch"
                    type="select"
                    value={newEmployee.Branch || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.branches}
                  />
                  <FormField
                    label="Office"
                    name="Town"
                    type="select"
                    value={newEmployee.Town || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.office}
                  />

                  <FormField
                    label="Manager"
                    name="Manager"
                    type="select"
                    value={newEmployee['Manager'] || ''}
                    onChange={handleInputChange}
                    options={dropdownOptions.supervisors}
                  />
                  <FormField
                    label="Work Email"
                    name="Work Email"
                    type="email"
                    value={newEmployee['Work Email'] || ''}
                    onChange={handleInputChange}
                    error={errors['Work Email']}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                  <div>
                    <SectionHeader
                      title="Leave Approvers"
                      icon={User}
                    />
                    <div className="grid grid-cols-1 gap-6 mt-4">
                      <FormField
                        label="Leave Approver"
                        name="Leave Approver"
                        type="select"
                        value={newEmployee['Leave Approver'] || ''}
                        onChange={handleInputChange}
                        options={dropdownOptions.supervisors}
                      />
                      <FormField
                        label="Alternate Leave Approver"
                        name="Alternate Approver"
                        type="select"
                        value={newEmployee['Alternate Approver'] || ''}
                        onChange={handleInputChange}
                        options={dropdownOptions.supervisors}
                      />
                      <FormField
                        label="Second Level Leave Approver"
                        name="second_level_leave_approver"
                        type="select"
                        value={newEmployee['second_level_leave_approver'] || ''}
                        onChange={handleInputChange}
                        options={dropdownOptions.supervisors}
                      />
                      <FormField
                        label="Alternate Second Level Leave Approver"
                        name="alternate_second_level_approver"
                        type="select"
                        value={newEmployee['alternate_second_level_approver'] || ''}
                        onChange={handleInputChange}
                        options={dropdownOptions.supervisors}
                      />
                      <FormField
                        label="Internship Start Date"
                        name="internship_start_date"
                        type="date"
                        value={newEmployee['internship_start_date'] || ''}
                        onChange={handleInputChange}
                      />
                    </div>
                  </div>
                  <div>
                    <SectionHeader
                      title="Contract Dates"
                      icon={Briefcase}
                    />
                    <div className="grid grid-cols-1 gap-6 mt-4">
                      <FormField
                        label="Internship End Date"
                        name="Internship End Date"
                        type="date"
                        value={newEmployee['Internship End Date'] || ''}
                        onChange={handleInputChange}
                      />
                      <FormField
                        label="Probation Start Date"
                        name="Probation Start Date"
                        type="date"
                        value={newEmployee['Probation Start Date'] || ''}
                        onChange={handleInputChange}
                      />
                      <FormField
                        label="Probation End Date"
                        name="Probation End Date"
                        type="date"
                        value={newEmployee['Probation End Date'] || ''}
                        onChange={handleInputChange}
                      />
                      <FormField
                        label="Contract Start Date"
                        name="Contract Start Date"
                        type="date"
                        value={newEmployee['Contract Start Date'] || ''}
                        onChange={handleInputChange}
                      />
                      <FormField
                        label="Contract End Date"
                        name="Contract End Date"
                        type="date"
                        value={newEmployee['Contract End Date'] || ''}
                        onChange={handleInputChange}
                      />
                    </div>
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
                      value={newEmployee['Personal Email'] || ''}
                      onChange={handleInputChange}
                      error={errors['Personal Email']}
                      required
                    />
                    <FormField
                      label="Primary Mobile Number"
                      name="Mobile Number"
                      type="tel"
                      value={newEmployee['Mobile Number'] || ''}
                      onChange={handleInputChange}
                      error={errors['Mobile Number']}
                      required
                      placeholder="e.g., +254712345678"
                    />
                    <FormField
                      label="Work Mobile Number"
                      name="Work Mobile"
                      type="tel"
                      value={newEmployee['Work Mobile'] || ''}
                      onChange={handleInputChange}
                      error={errors['Work Mobile']}
                      placeholder="Optional work mobile"
                      required
                    />
                    <FormField
                      label="Personal Mobile Number"
                      name="Personal Mobile"
                      type="tel"
                      value={newEmployee['Personal Mobile'] || ''}
                      onChange={handleInputChange}
                      error={errors['Personal Mobile']}
                      placeholder="Optional personal mobile"
                    />
                    <FormField
                      label="Alternative Mobile Number"
                      name="Alternative Mobile Number"
                      type="tel"
                      value={newEmployee['Alternative Mobile Number'] || ''}
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
                      value={newEmployee.Area || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="City/Town"
                      name="City"
                      value={newEmployee.City || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="Postal Code"
                      name="Postal Code"
                      value={newEmployee['Postal Code'] || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="Country"
                      name="Country"
                      value={newEmployee.Country || ''}
                      onChange={handleInputChange}
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
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                    <FormField
                      label="Bank"
                      name="Bank"
                      value={newEmployee['Bank'] || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="Account Number"
                      name="Account Number"
                      value={newEmployee['Account Number'] || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="Account Name"
                      name="account_number_name"
                      value={newEmployee.account_number_name || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="Branch Name"
                      name="Bank Branch"
                      value={newEmployee['Bank Branch'] || ''}
                      onChange={handleInputChange}
                    />
                    <FormField
                      label="Payment Method"
                      name="payment_method"
                      type="select"
                      value={newEmployee['payment_method'] || ''}
                      onChange={handleInputChange}
                      options={['Bank Transfer', 'Cash', 'MPESA']}
                    />
                  </div>
                </div>

                {(isAdmin || isHR) && (
                  <div>
                    <SectionHeader
                      title="Salary Information"
                      icon={CreditCard}
                    />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
                      <FormField
                        label="Job Group"
                        name="Job Group"
                        type="select"
                        value={newEmployee['Job Group'] || ''}
                        onChange={handleInputChange}
                        options={dropdownOptions.jobGroup}
                      />
                      {isAdmin && (
                        <FormField
                          label="Basic Salary"
                          name="Basic Salary"
                          type="number"
                          value={newEmployee['Basic Salary'] ? String(newEmployee['Basic Salary']) : ''}
                          onChange={(e) => {
                            const numValue = e.target.value ? parseFloat(e.target.value) : null;
                            setNewEmployee(prev => ({
                              ...prev,
                              "Basic Salary": numValue
                            }));
                          }}
                        />
                      )}
                      <FormField
                        label="Currency"
                        name="Currency"
                        type="select"
                        value={newEmployee['Currency'] || 'KES'}
                        onChange={handleInputChange}
                        options={['KES', 'USD', 'EUR', 'GBP']}
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
                          <button
                            type="button"
                            className={`w-6 h-6 rounded flex items-center justify-center border ${deduction.isActive ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'}`}
                            onClick={() => handleStatutoryDeductionChange(index, 'isActive', !deduction.isActive)}
                          >
                            {deduction.isActive && <Check className="w-4 h-4 text-white" />}
                          </button>
                          <span className="ml-2 font-medium min-w-[100px]">{deduction.name}</span>
                        </div>
                        {deduction.isActive && (
                          <div className="flex-1">
                            <input
                              type="text"
                              value={deduction.number}
                              onChange={(e) => handleStatutoryDeductionChange(index, 'number', e.target.value)}
                              className="w-full h-11 bg-gray-50 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm"
                              placeholder={`Enter ${deduction.name}`}
                              onBlur={() => validateField(deduction.columnName, deduction.number)}
                            />
                            {errors[`deduction${deduction.columnName}`] && (
                              <p className="mt-1 text-xs text-red-500">{errors[`deduction${deduction.columnName}`]}</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Emergency Contacts Tab */}
            {activeTab === 'emergency' && (
              <div>
                <SectionHeader
                  title="Emergency Contacts"
                  icon={AlertCircle}
                />
                <p className="text-gray-600 mb-6">Add at least one emergency contact for this employee</p>

                <div className="space-y-6">
                  {emergencyContacts.map((contact, index) => (
                    <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium text-gray-700">Contact #{index + 1}</h3>
                        {emergencyContacts.length > 1 && (
                          <button
                            onClick={() => removeEmergencyContact(index)}
                            className="text-red-500 hover:text-red-700 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <input
                            type="text"
                            value={contact.name}
                            onChange={(e) => handleEmergencyContactChange(index, 'name', e.target.value)}
                            className="w-full h-11 bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm"
                            placeholder="Full Name"
                            onBlur={() => {
                              if (!contact.name) {
                                setErrors(prev => ({ ...prev, [`emergencyContactName${index}`]: 'Name is required' }));
                              } else {
                                const newErrors = { ...errors };
                                delete newErrors[`emergencyContactName${index}`];
                                setErrors(newErrors);
                              }
                            }}
                          />
                          {errors[`emergencyContactName${index}`] && (
                            <p className="mt-1 text-xs text-red-500">{errors[`emergencyContactName${index}`]}</p>
                          )}
                        </div>
                        <div>
                          <input
                            type="text"
                            value={contact.relationship}
                            onChange={(e) => handleEmergencyContactChange(index, 'relationship', e.target.value)}
                            className="w-full h-11 bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm"
                            placeholder="Relationship"
                            onBlur={() => {
                              if (!contact.relationship) {
                                setErrors(prev => ({ ...prev, [`emergencyContactRelationship${index}`]: 'Relationship is required' }));
                              } else {
                                const newErrors = { ...errors };
                                delete newErrors[`emergencyContactRelationship${index}`];
                                setErrors(newErrors);
                              }
                            }}
                          />
                          {errors[`emergencyContactRelationship${index}`] && (
                            <p className="mt-1 text-xs text-red-500">{errors[`emergencyContactRelationship${index}`]}</p>
                          )}
                        </div>
                        <div>
                          <input
                            type="tel"
                            value={contact.phone}
                            onChange={(e) => handleEmergencyContactChange(index, 'phone', e.target.value)}
                            className="w-full h-11 bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm"
                            placeholder="Phone Number"
                            onBlur={() => validateField(`emergencyContactPhone${index}`, contact.phone)}
                          />
                          {errors[`emergencyContactPhone${index}`] && (
                            <p className="mt-1 text-xs text-red-500">{errors[`emergencyContactPhone${index}`]}</p>
                          )}
                        </div>
                        <div>
                          <input
                            type="email"
                            value={contact.email || ''}
                            onChange={(e) => handleEmergencyContactChange(index, 'email', e.target.value)}
                            className="w-full h-11 bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm"
                            placeholder="Email (Optional)"
                            onBlur={() => {
                              if (contact.email) {
                                validateField(`emergencyContactEmail${index}`, contact.email);
                              }
                            }}
                          />
                          {errors[`emergencyContactEmail${index}`] && (
                            <p className="mt-1 text-xs text-red-500">{errors[`emergencyContactEmail${index}`]}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addEmergencyContact}
                  className="mt-4 flex items-center text-emerald-600 hover:text-emerald-800 transition-colors"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Another Emergency Contact
                </button>
              </div>
            )}

            {/* Dependents Tab */}
            {activeTab === 'dependents' && (
              <div>
                <SectionHeader
                  title="Dependents"
                  icon={Users}
                />
                <p className="text-gray-600 mb-6">Add dependents for this employee (spouse, children, etc.)</p>

                <div className="space-y-6">
                  {dependents.map((dependent, index) => (
                    <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-medium text-gray-700">Dependent #{index + 1}</h3>
                        {dependents.length > 1 && (
                          <button
                            onClick={() => removeDependent(index)}
                            className="text-red-500 hover:text-red-700 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input
                          type="text"
                          value={dependent.name}
                          onChange={(e) => handleDependentChange(index, 'name', e.target.value)}
                          className="w-full h-11 bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm"
                          placeholder="Full Name"
                        />
                        <input
                          type="text"
                          value={dependent.relationship}
                          onChange={(e) => handleDependentChange(index, 'relationship', e.target.value)}
                          className="w-full h-11 bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm"
                          placeholder="Relationship"
                        />
                        <input
                          type="date"
                          value={dependent.dateOfBirth || ''}
                          onChange={(e) => handleDependentChange(index, 'dateOfBirth', e.target.value)}
                          className="w-full h-11 bg-white border border-gray-300 rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm"
                          placeholder="Date of Birth (Optional)"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={addDependent}
                  className="mt-4 flex items-center text-emerald-600 hover:text-emerald-800 transition-colors"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Another Dependent
                </button>
              </div>
            )}
          </div>

          {(errors.form || (Object.keys(errors).length > 0 && Object.values(errors).some(error => error))) && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-600"
            >
              <h3 className="font-medium mb-2">Please complete the required fields or correct the following errors to proceed</h3>
              <ul className="list-disc pl-5 space-y-1">
                {errors.form ? (
                  <li>{errors.form}</li>
                ) : (
                  Object.entries(
                    Object.keys(errors).reduce<Record<string, string[]>>((acc, fieldName) => {
                      if (errors[fieldName]) {
                        const tab = getTabForField(fieldName);
                        if (!acc[tab]) {
                          acc[tab] = [];
                        }
                        acc[tab].push(`${getFieldLabel(fieldName)}: ${errors[fieldName]}`);
                      }
                      return acc;
                    }, {})
                  ).map(([tab, tabErrors]) => (
                    <li key={tab}>
                      <span className="font-medium">{getTabName(tab)}:</span>
                      <ul className="list-disc pl-5 mt-1">
                        {tabErrors.map((error, i) => (
                          <li key={i}>{error}</li>
                        ))}
                      </ul>
                    </li>
                  ))
                )}
              </ul>
            </motion.div>
          )}

          <div className="flex justify-end space-x-3 mt-8 pt-6 border-t border-gray-100">
            <GlowButton
              variant="secondary"
              onClick={() => navigate('/employees')}
              disabled={loading}
            >
              Cancel
            </GlowButton>
            <GlowButton
              onClick={handleAddEmployee}
              icon={Plus}
              className="bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white"
            >
              {loading ? 'Adding Employee...' : 'Add Employee'}
            </GlowButton>
          </div>
        </div>
      </motion.div>
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

// Reusable Form Field Component
const FormField = ({
  label,
  value,
  onChange,
  name,
  type = 'text',
  required = false,
  options = [],
  disabled = false,
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
  error?: string;
  placeholder?: string;
}) => (
  <div className="space-y-1">
    <label className="block font-medium text-gray-700">
      {label}
      {required && <span className="text-red-500 ml-1">*</span>}
    </label>
    {type === 'select' ? (
      <SearchableDropdown
        options={options}
        value={value}
        onChange={(val) => {
          // Create a synthetic event or just call onChange with the expected structure
          onChange({ target: { name, value: val } } as any);
        }}
        placeholder={`Select ${label}`}
        className={error ? 'border-red-300' : ''}
      />
    ) : (
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        className={`w-full h-11 bg-gray-50 border ${error ? 'border-red-300' : 'border-gray-300'} rounded-lg px-4 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all duration-200 shadow-sm ${disabled ? 'opacity-70 cursor-not-allowed' : ''}`}
      />
    )}
    {error && (
      <p className="mt-1 text-xs text-red-500">{error}</p>
    )}
  </div>
);

export default AddEmployeePage;