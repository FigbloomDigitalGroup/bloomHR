// Profile.tsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, User, UploadCloud, Edit, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

const Profile = () => {
  const [employeeData, setEmployeeData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [activeSection, setActiveSection] = useState('statutory');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // Fetch employee data
  useEffect(() => {
    const fetchEmployeeData = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user?.email) {
        try {
          const { data, error } = await supabase
            .from('employees')
            .select(`
              "Employee Number", "First Name", "Last Name", "Profile Image",
              "NSSF Number", "SHIF Number", "SHIF Number", "Tax PIN",
              "NSSF Deduction", "NHIF Deduction", "Housing Levy Deduction",
              "Tax Exempted", "Disability Cert No", "NITA", "NITA Deductions",
              "HELB", "HELB option",
              "Pension Deduction", "Employee AVC", "Employer AVC", "WIBA"
            `)
            .eq('"Work Email"', user.email)
            .single();

          if (error) throw error;
          setEmployeeData(data);
          if (data?.["Profile Image"]) {
            setProfileImage(data["Profile Image"]);
          }
        } catch (error) {
          console.error('Error fetching employee data:', error);
          toast.error('Could not fetch employee information');
        } finally {
          setIsLoading(false);
        }
      }
    };

    fetchEmployeeData();
  }, []);

  // Handle profile image upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !employeeData) return;

    setImageUploading(true);
    
    try {
      // Upload file to Supabase Storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${employeeData["Employee Number"]}-${Date.now()}.${fileExt}`;
      const filePath = `profile-images/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('employeeavatar')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('employeeavatar')
        .getPublicUrl(filePath);

      // Update employee record with new image URL
      const { error: updateError } = await supabase
        .from('employees')
        .update({ "Profile Image": publicUrl })
        .eq('"Employee Number"', employeeData["Employee Number"]);

      if (updateError) throw updateError;

      setProfileImage(publicUrl);
      toast.success('Profile image updated successfully');
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error('Failed to upload profile image');
    } finally {
      setImageUploading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEmployeeData((prev: any) => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async () => {
    if (!employeeData) return;

    setIsUpdating(true);
    
    try {
      const updateData = {
        "NSSF Number": employeeData["NSSF Number"],
        "SHIF Number": employeeData["SHIF Number"],
        "Tax PIN": employeeData["Tax PIN"],
        "NSSF Deduction": employeeData["NSSF Deduction"],
        "NHIF Deduction": employeeData["NHIF Deduction"],
        "Housing Levy Deduction": employeeData["Housing Levy Deduction"],
        "Tax Exempted": employeeData["Tax Exempted"],
        "Disability Cert No": employeeData["Disability Cert No"],
        "NITA": employeeData["NITA"],
        "NITA Deductions": employeeData["NITA Deductions"],
        "HELB": employeeData["HELB"],
        "HELB option": employeeData["HELB option"],
        "Pension Deduction": employeeData["Pension Deduction"],
        "Employee AVC": employeeData["Employee AVC"],
        "Employer AVC": employeeData["Employer AVC"],
        "WIBA": employeeData["WIBA"]
      };

      const { error } = await supabase
        .from('employees')
        .update(updateData)
        .eq('"Employee Number"', employeeData["Employee Number"]);

      if (error) throw error;

      toast.success('Deductions updated successfully');
      setIsEditing(false); // Exit edit mode after successful update
    } catch (error) {
      console.error('Error updating deductions:', error);
      toast.error('Failed to update deductions');
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-green-600" />
      </div>
    );
  }

  if (!employeeData) {
    return (
      <div className="text-center py-8 text-gray-500">
        Could not load employee data. Please try again later.
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Profile Image Section */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="relative">
              {profileImage ? (
                <img 
                  src={profileImage} 
                  alt="Profile" 
                  className="h-16 w-16 rounded-full object-cover border-2 border-green-600"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-300">
                  <User className="h-8 w-8 text-gray-400" />
                </div>
              )}
              <label 
                htmlFor="profile-upload"
                className={`absolute -bottom-1 -right-1 bg-green-600 text-white p-1 rounded-full cursor-pointer ${imageUploading ? 'opacity-50' : ''}`}
              >
                {imageUploading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <UploadCloud className="h-3 w-3" />
                )}
              </label>
              <input
                id="profile-upload"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                disabled={imageUploading}
              />
            </div>
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                {employeeData["First Name"]} {employeeData["Last Name"]}
              </h3>
              <p className="text-xs text-gray-500">{employeeData["Employee Number"]}</p>
            </div>
          </div>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-xs font-medium"
          >
            {isEditing ? (
              <>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </>
            ) : (
              <>
                <Edit className="h-4 w-4 mr-2" />
                Edit Information
              </>
            )}
          </button>
        </div>
      </div>

      {/* Deductions Sections */}
      <div className="flex mb-4 border-b">
        <button
          onClick={() => setActiveSection('statutory')}
          className={`px-4 py-2 font-medium text-xs ${
            activeSection === 'statutory'
              ? 'border-b-2 border-green-600 text-green-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Statutory Deductions
        </button>
        <button
          onClick={() => setActiveSection('voluntary')}
          className={`px-4 py-2 font-medium text-xs ${
            activeSection === 'voluntary'
              ? 'border-b-2 border-green-600 text-green-700'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Voluntary Deductions
        </button>
      </div>

      {activeSection === 'statutory' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-white rounded-lg p-6 border border-gray-200 mb-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* NSSF */}
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-3">NSSF</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">NSSF Number</label>
                  <input
                    type="text"
                    name="NSSF Number"
                    value={employeeData["NSSF Number"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div>
                {/* <div>
                  <label className="block text-xs text-gray-600 mb-1">NSSF Deduction</label>
                  <input
                    type="text"
                    name="NSSF Deduction"
                    value={employeeData["NSSF Deduction"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div> */}
              </div>
            </div>

            {/* SHIF */}
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-3">SHIF</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">SHIF Number</label>
                  <input
                    type="text"
                    name="SHIF Number"
                    value={employeeData["SHIF Number"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div>
                {/* <div>
                  <label className="block text-xs text-gray-600 mb-1">SHIF Deduction</label>
                  <input
                    type="text"
                    name="SHIF Deduction"
                    value={employeeData["SHIF Deduction"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div> */}
              </div>
            </div>

            {/* Tax */}
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-3">Tax Information</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">KRA PIN</label>
                  <input
                    type="text"
                    name="Tax PIN"
                    value={employeeData["Tax PIN"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div>
                {/* <div>
                  <label className="block text-xs text-gray-600 mb-1">Housing Levy</label>
                  <input
                    type="text"
                    name="Housing Levy Deduction"
                    value={employeeData["Housing Levy Deduction"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div> */}
              </div>
            </div>

            {/* Other */}
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-3">Other</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">HELB</label>
                  <input
                    type="text"
                    name="HELB"
                    value={employeeData["HELB"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div>
                {employeeData["HELB"] === "Yes" && (
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">HELB Option</label>
                    <input
                      type="text"
                      name="HELB option"
                      value={employeeData["HELB option"] || ''}
                      onChange={handleChange}
                      className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                      readOnly={!isEditing}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {activeSection === 'voluntary' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-white rounded-lg p-6 border border-gray-200 mb-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pension */}
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-3">Pension</h4>
              <div className="space-y-4">
                {/* <div>
                  <label className="block text-xs text-gray-600 mb-1">Pension Deduction</label>
                  <input
                    type="text"
                    name="Pension Deduction"
                    value={employeeData["Pension Deduction"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div> */}
                {employeeData["Pension Deduction"] === "Yes" && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Employee AVC</label>
                      <input
                        type="text"
                        name="Employee AVC"
                        value={employeeData["Employee AVC"] || ''}
                        onChange={handleChange}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                        readOnly={!isEditing}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Employer AVC</label>
                      <input
                        type="text"
                        name="Employer AVC"
                        value={employeeData["Employer AVC"] || ''}
                        onChange={handleChange}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                        readOnly={!isEditing}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Other Voluntary */}
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-3">Other Voluntary</h4>
              <div className="space-y-4">
                {/* <div>
                  <label className="block text-xs text-gray-600 mb-1">S</label>
                  <input
                    type="text"
                    name="WIBA"
                    value={employeeData["WIBA"] || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded"
                    readOnly={!isEditing}
                  />
                </div> */}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {isEditing && (
        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={() => setIsEditing(false)}
            className="px-4 py-2 border border-gray-300 text-xs font-medium rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isUpdating}
            className="px-4 py-2 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700"
          >
            {isUpdating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                Updating...
              </>
            ) : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
};

export default Profile;