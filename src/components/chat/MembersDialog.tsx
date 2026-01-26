// components/MembersDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Badge } from "./ui/badge";
import type { Channel, Employee } from "../chat/types/types";

interface MembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel;
  employees: Employee[]; // Add employees prop
}

export function MembersDialog({ 
  open, 
  onOpenChange, 
  channel, 
  employees = [] 
}: MembersDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Channel Members</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            {employees.length} members in #{channel.name}
          </div>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {employees.map((employee) => (
              <div key={employee.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={employee.profileImage} />
                  <AvatarFallback>
                    {employee.initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {employee.fullName}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {employee.status}
                    </Badge>
                  </div>
                  <div className="text-sm text-gray-500">
                    {employee.jobTitle}
                  </div>
                  <div className="text-xs text-gray-400">
                    {employee.department}
                    {employee.town && ` • ${employee.town}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}