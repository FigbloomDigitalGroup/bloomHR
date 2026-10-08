// EmployeeProfile.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Building2, Mail, Phone, Calendar, Users, Briefcase } from "lucide-react";
import { findEmployee, useChatPeople, type ChatPerson } from "./lib/chatPeople";
import { initialsOf } from "./lib/names";
import { isOnline, useOnlinePeople } from "./lib/presence";
import { useMyCompanies } from "../../hooks/useMyCompanies";

interface EmployeeProfileProps {
  /** a message's author, a conversation or an employee: the card looks up their employee record */
  employee: ChatPerson;
  children: React.ReactNode;
}

export function EmployeeProfile({ employee: person, children }: EmployeeProfileProps) {
  const { employees, currentEmail, onMessage, canViewRecords } = useChatPeople();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const onlinePeople = useOnlinePeople();
  const { data: companies } = useMyCompanies();
  const companyName = companies?.find((c) => c.is_current)?.name;
  const employee = findEmployee(employees, person);

  const name = employee?.fullName || person.fullName || person.name || 'Colleague';
  const email = employee?.workEmail || person.workEmail || person.email || '';
  // live presence by email, the same source as the chat header and lists; unknown without an email
  const status = email ? (isOnline(onlinePeople, email) ? 'online' : 'offline') : null;
  const isMe = !!email && email.toLowerCase() === (currentEmail || '').toLowerCase();
  const canMessage = !!employee && !!onMessage && !isMe;
  const canView = !!employee?.employeeNumber && canViewRecords;

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-white border border-gray-200 rounded-xl shadow-lg">
        {/* Header */}
        <div className="bg-brand p-6 text-white rounded-t-xl">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 ring-4 ring-white/20 shadow-lg">
              <AvatarImage src={employee?.profileImage || person.profileImage || person.avatar} />
              <AvatarFallback className="bg-white/20 text-white font-semibold">
                {employee?.initials || initialsOf(name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-lg truncate">{name}{isMe && <span className="font-normal text-white/70"> (you)</span>}</h3>
              {employee?.jobTitle && <p className="text-white/70 truncate">{employee.jobTitle}</p>}
              {status && <div className="flex items-center gap-1 mt-1">
                <span className={`w-2 h-2 rounded-full ${
                  status === 'online' ? 'bg-green-400' : 'bg-gray-400'
                }`}></span>
                <span className="text-xs text-white/70 capitalize">{status}</span>
              </div>}
            </div>
          </div>
        </div>

        {/* Details section */}
        <div className="p-4 space-y-3">
          {employee ? (
            <div className="flex items-center gap-3 text-sm">
              <Building2 className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-gray-900 truncate">
                  {companyName || employee.entity}
                </div>
                {(employee.branch || employee.department) && (
                  <div className="text-gray-500 text-xs truncate">
                    {[employee.branch, employee.department !== employee.branch ? employee.department : null].filter(Boolean).join(' • ')}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-500">No employee record is linked to this login.</p>
          )}

          {/* Job Details */}
          {employee?.jobGroup && (
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
          {email && (
            <div className="flex items-center gap-3 text-sm">
              <Mail className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <a href={`mailto:${email}`} className="text-gray-700 truncate hover:underline">{email}</a>
            </div>
          )}

          {/* Phone Numbers */}
          {(employee?.mobileNumber || employee?.workMobile) && (
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
          {employee?.startDate && (
            <div className="flex items-center gap-3 text-sm">
              <Calendar className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <span className="text-gray-700">
                Since {formatDate(employee.startDate)}
              </span>
            </div>
          )}

          {/* Manager */}
          {employee?.manager && (
            <div className="flex items-center gap-3 text-sm">
              <Users className="h-4 w-4 text-gray-500 flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-gray-500">Reports to</div>
                <div className="text-gray-700 truncate">{employee.manager}</div>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons: only the ones that can work for this person */}
        {(canMessage || canView) && (
          <div className="px-4 pb-4 pt-2 border-t border-gray-100">
            <div className="flex gap-2">
              {canMessage && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onMessage!(employee!.id);
                  }}
                  className="flex-1 px-3 py-2 bg-brand text-white text-sm font-medium rounded-lg hover:bg-brand-dark transition-colors"
                >
                  Send Message
                </button>
              )}
              {canView && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(`/view-employee/${encodeURIComponent(employee!.employeeNumber)}`);
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  View Profile
                </button>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
