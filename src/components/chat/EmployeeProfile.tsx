// EmployeeProfile.tsx
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Building2, Mail, Phone, MapPin, Calendar, Users, Briefcase } from "lucide-react";
import type { Employee } from "../chat/types/types";

interface EmployeeProfileProps {
  employee: Employee;
  children: React.ReactNode;
}

export function EmployeeProfile({ employee, children }: EmployeeProfileProps) {
  const formatDate = (dateString: string) => {
    if (!dateString) return 'Not specified';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-white border border-gray-200 rounded-xl shadow-lg">
        {/* Header with gradient background */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white rounded-t-xl">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 ring-4 ring-white/20 shadow-lg">
              <AvatarImage src={employee.profileImage} />
              <AvatarFallback className="bg-white/20 text-white font-semibold">
                {employee.initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg truncate">{employee.fullName}</h3>
              <p className="text-blue-100 truncate">{employee.jobTitle}</p>
              <div className="flex items-center gap-1 mt-1">
                <span className={`w-2 h-2 rounded-full ${
                  employee.status === 'online' ? 'bg-green-400' :
                  employee.status === 'away' ? 'bg-yellow-400' :
                  'bg-gray-400'
                }`}></span>
                <span className="text-xs text-blue-200 capitalize">{employee.status}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Details section */}
        <div className="p-4 space-y-3">
          {/* Department & Entity */}
          <div className="flex items-center gap-3 text-sm">
            <Building2 className="h-4 w-4 text-gray-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-medium text-gray-900 truncate">
                {employee.department || 'Not specified'}
              </div>
              <div className="text-gray-500 text-xs truncate">
                {employee.entity || 'Company'}
                {employee.branch && ` • ${employee.branch}`}
              </div>
            </div>
          </div>
          
          {/* Job Details */}
          {employee.jobGroup && (
            <div className="flex items-center gap-3 text-sm">
              <Briefcase className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-gray-700 truncate">{employee.jobGroup}</div>
                {employee.jobTitle && employee.jobTitle !== employee.jobGroup && (
                  <div className="text-gray-500 text-xs truncate">{employee.jobTitle}</div>
                )}
              </div>
            </div>
          )}
          
          {/* Email */}
          <div className="flex items-center gap-3 text-sm">
            <Mail className="h-4 w-4 text-gray-500 flex-shrink-0" />
            <span className="text-gray-700 truncate">{employee.workEmail}</span>
          </div>
          
          {/* Phone Numbers */}
          {(employee.mobileNumber || employee.workMobile) && (
            <div className="flex items-center gap-3 text-sm">
              <Phone className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-gray-700">
                  {employee.mobileNumber || employee.workMobile}
                </div>
                {employee.mobileNumber && employee.workMobile && (
                  <div className="text-gray-500 text-xs">Work: {employee.workMobile}</div>
                )}
              </div>
            </div>
          )}
          
          {/* Start Date */}
          {employee.startDate && (
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <span className="text-gray-700">
                Since {formatDate(employee.startDate)}
              </span>
            </div>
          )}
          
          {/* Manager */}
          {employee.manager && (
            <div className="flex items-center gap-3 text-sm">
              <Users className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-gray-500">Reports to</div>
                <div className="text-gray-700 truncate">{employee.manager}</div>
              </div>
            </div>
          )}
        </div>
        
        {/* Action buttons */}
        <div className="px-4 pb-4 pt-2 border-t border-gray-100">
          <div className="flex gap-2">
            <button className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              Send Message
            </button>
            <button className="px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
              View Profile
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}