import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Switch } from "./ui/switch";
import type { User } from "../chat/types/types";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User;
}

export function SettingsDialog({ open, onOpenChange, user }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Profile Section */}
          <div className="space-y-4">
            <h3 className="font-medium">Profile</h3>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user.avatar} />
                <AvatarFallback>{user.initials}</AvatarFallback>
              </Avatar>
              <Button variant="outline" size="sm">
                Change Avatar
              </Button>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="display-name">Display Name</Label>
              <Input id="display-name" defaultValue={user.name} />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" defaultValue={user.email} />
            </div>
          </div>

          {/* Preferences Section */}
          <div className="space-y-4">
            <h3 className="font-medium">Preferences</h3>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="desktop-notifications" className="flex flex-col space-y-1">
                <span>Desktop Notifications</span>
                <span className="font-normal text-sm text-muted-foreground">
                  Receive desktop notifications
                </span>
              </Label>
              <Switch id="desktop-notifications" defaultChecked />
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="sound-notifications" className="flex flex-col space-y-1">
                <span>Sound Notifications</span>
                <span className="font-normal text-sm text-muted-foreground">
                  Play sounds for new messages
                </span>
              </Label>
              <Switch id="sound-notifications" defaultChecked />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => onOpenChange(false)}>
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}