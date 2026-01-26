// InviteDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Search, UserPlus, Check } from "lucide-react";
import { useState } from "react";
import type { User } from "../chat/types/types";

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  onInvite: (userIds: string[]) => void;
  channelName: string;
}

export function InviteDialog({
  open,
  onOpenChange,
  users,
  onInvite,
  channelName
}: InviteDialogProps) {
  const [search, setSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(search.toLowerCase()) ||
    user.email.toLowerCase().includes(search.toLowerCase())
  );

  const toggleUserSelection = (userId: string) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleInvite = () => {
    if (selectedUsers.length > 0) {
      onInvite(selectedUsers);
      setSelectedUsers([]);
      setSearch("");
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedUsers([]);
      setSearch("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite to #{channelName}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
              autoFocus
            />
          </div>

          <div className="max-h-60 overflow-y-auto space-y-2">
            {filteredUsers.map(user => (
              <div
                key={user.id}
                className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                  selectedUsers.includes(user.id) 
                    ? 'bg-blue-50 border border-blue-200' 
                    : 'hover:bg-gray-50'
                }`}
                onClick={() => toggleUserSelection(user.id)}
              >
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.avatar} />
                  <AvatarFallback>{user.initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{user.name}</div>
                  <div className="text-xs text-gray-500 truncate">{user.email}</div>
                </div>
                {selectedUsers.includes(user.id) && (
                  <Check className="h-4 w-4 text-blue-600 flex-shrink-0" />
                )}
              </div>
            ))}
            {filteredUsers.length === 0 && (
              <div className="text-center py-4 text-gray-500">
                <Search className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">No users found</p>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">
              {selectedUsers.length} user{selectedUsers.length !== 1 ? 's' : ''} selected
            </span>
            <Button 
              onClick={handleInvite} 
              disabled={selectedUsers.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Invite Users
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}