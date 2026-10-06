// components/CreateChannelDialog.tsx
import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Hash, Lock, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { supabase } from "../../lib/supabase";
import { chatService } from "./services/chatServices";
import { InvitePicker } from "./InvitePicker";
import { buildGroups, notJoinedCount, resolveInvitees, type DirectoryPerson, type Member } from "./lib/groups";

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateChannel: (name: string, isPrivate: boolean, jobTitle?: string, inviteeIds?: string[]) => void | Promise<void>;
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  onCreateChannel,
}: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [jobTitle, setJobTitle] = useState("all");
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingJobTitles, setLoadingJobTitles] = useState(false);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const groups = useMemo(() => buildGroups(people, members), [people, members]);

  // who can be invited (the colleagues who have joined, and the groups from the employee directory)
  useEffect(() => {
    if (!open) return;
    chatService.getInviteOptions().then(
      (o) => {
        setMembers(o.members);
        setPeople(o.people);
      },
      () => undefined // the rest of the dialog works without it
    );
  }, [open]);

  // Fetch job titles from employees table
  useEffect(() => {
    const fetchJobTitles = async () => {
      if (!open) return;
      
      setLoadingJobTitles(true);
      try {
        const { data, error } = await supabase
          .from('employee_directory')
          .select('"Job Title"')
          .not('"Job Title"', 'is', null)
          .order('"Job Title"', { ascending: true });

        if (error) {
          console.error('Error fetching job titles:', error);
          return;
        }

        // Extract unique job titles, filter out empty/null values, and sort them
        const uniqueJobTitles = [...new Set(
          data
            .map(emp => emp["Job Title"])
            .filter(title => title && title.trim() !== "") // Filter out empty strings
        )] as string[];
        
        setJobTitles(uniqueJobTitles);
        
      } catch (error) {
        console.error('Error fetching job titles:', error);
      } finally {
        setLoadingJobTitles(false);
      }
    };

    fetchJobTitles();
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Channel name is required");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const selectedJobTitle = jobTitle === "all" ? undefined : jobTitle;
      await onCreateChannel(name.trim(), isPrivate, selectedJobTitle, resolveInvitees(groups, groupIds, userIds));
      setName("");
      setIsPrivate(false);
      setJobTitle("all");
      setGroupIds([]);
      setUserIds([]);
    } catch (err: any) {
      setError(err.message || "Failed to create channel");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form when closing
      setName("");
      setIsPrivate(false);
      setJobTitle("all");
      setGroupIds([]);
      setUserIds([]);
      setError("");
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Channel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="channel-name">Channel Name</Label>
            <div className="relative">
              {isPrivate ? (
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              ) : (
                <Hash className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              )}
              <Input
                id="channel-name"
                placeholder="channel-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError("");
                }}
                className="pl-10"
                disabled={loading}
              />
            </div>
          </div>

          {/* Job Title Selection - Dynamically Populated */}
          <div className="space-y-2">
            <Label htmlFor="job-title">Restrict to Job Title (Optional)</Label>
            <Select 
              value={jobTitle} 
              onValueChange={setJobTitle}
              disabled={loading || loadingJobTitles}
            >
              <SelectTrigger>
                <SelectValue placeholder={
                  loadingJobTitles ? "Loading job titles..." : "Select job title to restrict access"
                } />
              </SelectTrigger>
              <SelectContent className="bg-white border shadow-lg">
                <SelectItem value="all">All employees</SelectItem>
                {jobTitles.map((title) => (
                  <SelectItem key={title} value={title}>
                    {title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only employees with this job title will be able to access the channel
            </p>
          </div>
          
          <div className="flex items-center justify-between">
            <Label htmlFor="private-channel" className="flex flex-col space-y-1">
              <span>Private Channel</span>
              <span className="font-normal text-sm text-muted-foreground">
                Only invited members can join
              </span>
            </Label>
            <Switch
              id="private-channel"
              checked={isPrivate}
              onCheckedChange={setIsPrivate}
              disabled={loading}
            />
          </div>
          
          <div className="space-y-2">
            <Label>Add people (optional)</Label>
            <InvitePicker
              groups={groups}
              members={members}
              people={people}
              selectedGroupIds={groupIds}
              selectedUserIds={userIds}
              onGroupsChange={setGroupIds}
              onUsersChange={setUserIds}
              notJoined={notJoinedCount(groups, groupIds)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              {isPrivate ? "Only you, the people you add, administrators and anyone matching the job title will see this channel." : "Everyone can find this channel; people you add are added as members."}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={!name.trim() || loading || loadingJobTitles}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Channel"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}