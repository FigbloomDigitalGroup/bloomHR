// Profile.tsx
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, User, UploadCloud, Edit, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { NOT_SAVED_NOT_LINKED, requireUpdatedRows, saveFailureMessage } from '../../lib/requireUpdated';
import { uploadEmployeeAvatar } from '../../lib/avatarStorage';
import FigbloomLoader from '../UI/FigbloomLoader';
import MyTwoStepCard from '../Settings/MyTwoStep';
import MyContributions from './MyContributions';
import { LeavingTheCompany, ResignationStatusCard } from './ResignationCards';
import { useMyOpenResignation } from './useMyOpenResignation';
import { useFormDraft } from '../../hooks/useFormDraft';

interface ProfileProps {
  /** opens the Resignation section (it is no longer in the menu; resigning starts here) */
  onOpenResignation?: () => void;
}

const Profile = ({ onOpenResignation }: ProfileProps) => {
  const [employeeData, setEmployeeData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [activeSection, setActiveSection] = useState('statutory');
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  // what was loaded (or last saved): unsaved edits are kept in the tab against it, so a refresh doesn't lose them
  const [loadedData, setLoadedData] = useState<any>(null);
  const draft = useFormDraft<any>(loadedData ? `profile:${loadedData['Employee Number']}` : null, employeeData, loadedData, (d) => {
    setEmployeeData(d);
    // a restored draft is being edited; discarding goes back to viewing
    setIsEditing(d !== loadedData);
  });
  // a resignation under way shows at the top; otherwise resigning starts at the bottom
  const openResignation = useMyOpenResignation();

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
          setLoadedData(data);
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
      // saved in the company's folder, named after the employee (see avatarStorage.ts)
      const publicUrl = await uploadEmployeeAvatar(file, String(employeeData["Employee Number"]));

      // Update employee record with new image URL
      const { data: savedRows, error: updateError } = await supabase
        .from('employees')
        .update({ "Profile Image": publicUrl })
        .eq('"Employee Number"', employeeData["Employee Number"])
        .select('"Employee Number"');

      if (updateError) throw updateError;
      requireUpdatedRows(savedRows, NOT_SAVED_NOT_LINKED);

      setProfileImage(publicUrl);
      toast.success('Profile image updated successfully');
    } catch (error) {
      console.error('Error uploading image:', error);
      toast.error(saveFailureMessage(error, 'Failed to upload profile image'));
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
      // only what staff fill in themselves; deductions, pension and AVCs are set by HR (the database refuses the rest)
      const updateData = {
        "NSSF Number": employeeData["NSSF Number"],
        "SHIF Number": employeeData["SHIF Number"],
        "Tax PIN": employeeData["Tax PIN"],
        "Disability Cert No": employeeData["Disability Cert No"],
        "HELB": employeeData["HELB"],
        "HELB option": employeeData["HELB option"],
      };

      const { data: savedRows, error } = await supabase
        .from('employees')
        .update(updateData)
        .eq('"Employee Number"', employeeData["Employee Number"])
        .select('"Employee Number"');

      if (error) throw error;
      requireUpdatedRows(savedRows, NOT_SAVED_NOT_LINKED);

      toast.success('Deductions updated successfully');
      setLoadedData(employeeData);
      draft.clear();
      setIsEditing(false); // Exit edit mode after successful update
    } catch (error) {
      console.error('Error updating deductions:', error);
      toast.error(saveFailureMessage(error, 'Failed to update deductions'));
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <FigbloomLoader label="Loading your profile" />
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
      {openResignation && onOpenResignation && <ResignationStatusCard exit={openResignation} onView={onOpenResignation} />}

      {draft.restoredAt !== null && (
        <div className="bg-white rounded-lg p-4 border border-gray-200 mb-6 flex flex-wrap items-center gap-3" role="status">
          <p className="m-0 flex-1 min-w-[200px] text-sm text-gray-900">
            We kept what you typed before the page reloaded (last change at{' '}
            {new Date(draft.restoredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). Save to keep it.
          </p>
          <button onClick={draft.discard} className="px-4 py-2 border border-gray-300 text-xs font-medium rounded hover:bg-gray-50">
            Discard it
          </button>
        </div>
      )}

      {/* Profile Image Section */}
      <div className="bg-white rounded-lg p-6 border border-gray-200 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-4 min-w-0">
            <div className="relative shrink-0">
              {profileImage ? (
                <img 
                  src={profileImage} 
                  alt="Profile" 
                  className="h-16 w-16 rounded-full object-cover border-2 border-primary"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-300">
                  <User className="h-8 w-8 text-gray-400" />
                </div>
              )}
              <label 
                htmlFor="profile-upload"
                className={`absolute -bottom-1 -right-1 bg-primary text-white p-1 rounded-full cursor-pointer ${imageUploading ? 'opacity-50' : ''}`}
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
            <div className="min-w-0">
              <h3 className="text-lg font-medium text-gray-900 truncate">
                {employeeData["First Name"]} {employeeData["Last Name"]}
              </h3>
              <p className="text-xs text-gray-500 truncate">{employeeData["Employee Number"]}</p>
            </div>
          </div>
          <button
            onClick={() => (isEditing ? draft.discard() : setIsEditing(true))}
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
              ? 'border-b-2 border-primary text-brand'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Statutory Deductions
        </button>
        <button
          onClick={() => setActiveSection('voluntary')}
          className={`px-4 py-2 font-medium text-xs ${
            activeSection === 'voluntary'
              ? 'border-b-2 border-primary text-brand'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          My contributions
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
                {/* the NITA training levy is paid by the employer (KES 50 a month), never taken from pay (FIG-898) */}
                <div>
                  <label htmlFor="profile-nita" className="block text-xs text-gray-600 mb-1">NITA number</label>
                  <input
                    id="profile-nita"
                    type="text"
                    value={employeeData["NITA"] || ''}
                    placeholder="Not recorded"
                    className="w-full px-3 py-2 text-xs border border-gray-300 rounded bg-gray-50"
                    title="Set by HR"
                    readOnly
                  />
                  <p className="text-[11px] text-gray-500 mt-1">The NITA training levy is paid by your employer, not taken from your pay.</p>
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
        <div className="mb-6">
          {/* contributions you ask payroll for (FIG-898) */}
          <MyContributions />
        </div>
      )}

      {activeSection === 'voluntary' && employeeData["Pension Deduction"] === "Yes" && (
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
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded bg-gray-50"
                        title="Set by HR"
                        readOnly
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Employer AVC</label>
                      <input
                        type="text"
                        name="Employer AVC"
                        value={employeeData["Employer AVC"] || ''}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded bg-gray-50"
                        title="Set by HR"
                        readOnly
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
            onClick={draft.discard}
            className="px-4 py-2 border border-gray-300 text-xs font-medium rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isUpdating}
            className="px-4 py-2 bg-primary text-white text-xs font-medium rounded hover:bg-primary/90"
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

      {/* your own sign-in code (FIG-891) */}
      <MyTwoStepCard className="mt-6" />

      {/* resigning lives here, behind a confirmation, rather than in the menu */}
      {!openResignation && onOpenResignation && <LeavingTheCompany onStart={onOpenResignation} />}
    </div>
  );
};

export default Profile;