import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Search, Building2, Mail, Phone } from "lucide-react";
import { useState } from "react";
import type { User } from "../chat/types/types";

interface CreateDMDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  onCreateDM: (userId: string) => void;
}

export function CreateDMDialog({
  open,
  onOpenChange,
  users,
  onCreateDM,
}: CreateDMDialogProps) {
  const [search, setSearch] = useState("");

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(search.toLowerCase()) ||
    user.employeeData?.jobTitle?.toLowerCase().includes(search.toLowerCase()) ||
    user.employeeData?.department?.toLowerCase().includes(search.toLowerCase()) ||
    user.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleUserSelect = (userId: string) => {
    onCreateDM(userId);
    setSearch(""); // Reset search when dialog closes
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSearch(""); // Reset search when closing
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-gray-900">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
              <Mail className="h-4 w-4 text-white" />
            </div>
            New Direct Message
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name, department, or role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-gray-50 border-gray-200 focus:bg-white"
              autoFocus
            />
          </div>
          
          <div className="max-h-96 overflow-y-auto space-y-2">
            {filteredUsers.map((user) => (
              <Button
                key={user.id}
                variant="ghost"
                className="w-full justify-start h-auto p-3 hover:bg-green-50 hover:border-green-200 transition-all rounded-lg border border-transparent"
                onClick={() => handleUserSelect(user.id)}
              >
                <div className="flex items-center gap-3 w-full">
                  <div className="relative">
                    <Avatar className="h-12 w-12 ring-2 ring-white shadow-sm">
                      <AvatarImage src={user.avatar} />
                      <AvatarFallback className="bg-gradient-to-br from-green-500 to-green-600 text-white">
                        {user.initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 border-2 border-white rounded-full ${
                      user.status === 'online' ? 'bg-green-500' :
                      user.status === 'away' ? 'bg-yellow-500' :
                      'bg-gray-400'
                    }`} />
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">
                      {user.name}
                    </div>
                    {user.employeeData && (
                      <div className="text-sm text-gray-600 space-y-1">
                        <div className="flex items-center gap-1 truncate">
                          <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="truncate">{user.employeeData.department}</span>
                        </div>
                        <div className="text-gray-500 truncate">
                          {user.employeeData.jobTitle}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-gray-400 truncate">
                      <Mail className="h-3 w-3" />
                      <span>{user.email}</span>
                    </div>
                  </div>
                </div>
              </Button>
            ))}
            {filteredUsers.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Search className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="font-medium">No employees found</p>
                <p className="text-sm mt-1">Try a different search term</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}