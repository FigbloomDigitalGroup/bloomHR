import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Users, Filter } from 'lucide-react';
import { PageHeader, Button } from '../UI';
import { StatusBadge } from './components/StatusBadge';
import { SummaryCard } from './components/SummaryCard';
import { FiltersSection } from './components/FiltersSection';
import { TabsNavigation } from './components/TabsNavigation';
import PositionsTable from './components/PositionsTable';
import { ApplicationsTable } from './components/ApplicationsTable';
import { BranchesSection } from './components/BranchesSection';
import { NewPositionModal } from './components/NewPositionModal';
import { ApplicationDetailModal } from './components/ApplicationDetailModal';
import { branches } from './components/constants/branches';
import { jobPositions } from './components/constants/jobPositions';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

interface Position {
  id: string | number;
  title: string;
  department: string;
  type: string;
  branch: string;
  status: 'open' | 'closed' | 'pending';
  applications?: string;
  created_at: string;
  updated_at?: string;
}

export default function RecruitmentDashboard() {
  const [selectedTab, setSelectedTab] = useState('positions');
  const [selectedBranch, setSelectedBranch] = useState('all');
  const [selectedDepartment, setSelectedDepartment] = useState('All Departments');
  const [selectedStatus, setSelectedStatus] = useState('All Statuses');
  const [selectedType, setSelectedType] = useState('All Types');
  const [searchTerm, setSearchTerm] = useState('');
  const [showNewPositionModal, setShowNewPositionModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [applications, setApplications] = useState<any[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedApplication, setSelectedApplication] = useState<any | null>(null);

  // Fetch positions from Supabase
  const fetchPositions = async () => {
    try {
      const { data, error } = await supabase
        .from('job_positions')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching positions:', error);
        // Fallback to static data if Supabase fails
        setPositions(jobPositions);
      } else {
        setPositions(data || []);
      }
    } catch (error) {
      console.error('Error fetching positions:', error);
      setPositions(jobPositions); // Fallback to static data
    }
  };

  // Fetch applications from Supabase
  const fetchApplications = async () => {
    try {
      const { data, error } = await supabase
        .from('job_applications')
        .select('*');
      
      if (!error) {
        setApplications(data || []);
      } else {
        console.error('Error fetching applications:', error);
      }
    } catch (error) {
      console.error('Error fetching applications:', error);
    }
  };

  // Initial data fetch
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchPositions(), fetchApplications()]);
      setLoading(false);
    };

    loadData();
  }, []);

  // Filter positions based on selections
  const filteredPositions = positions.filter(position => {
    const matchesBranch = selectedBranch === 'all' || position.branch === selectedBranch;
    const matchesDepartment = selectedDepartment === 'All Departments' || position.department === selectedDepartment;
    const matchesStatus = selectedStatus === 'All Statuses' || position.status === selectedStatus;
    const matchesType = selectedType === 'All Types' || position.type === selectedType;
    const matchesSearch = position.title.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesBranch && matchesDepartment && matchesStatus && matchesType && matchesSearch;
  });

  const filteredApplications = applications.filter(application => {
    const matchesBranch = selectedBranch === 'all' || 
      application.preferred_location?.toLowerCase().includes(selectedBranch.toLowerCase());
    const matchesDepartment = selectedDepartment === 'All Departments' || 
      application.department?.toLowerCase().includes(selectedDepartment.toLowerCase());
    const matchesStatus = selectedStatus === 'All Statuses' || application.status === selectedStatus;
    const matchesSearch = 
      `${application.first_name} ${application.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) || 
      application.position?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      application.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesBranch && matchesDepartment && matchesStatus && matchesSearch;
  });

  const statusCounts = {
    'open': positions.filter(p => p.status === 'open').length,
    'closed': positions.filter(p => p.status === 'closed').length,
    'pending': positions.filter(p => p.status === 'pending').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg">Loading recruitment data...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-[18px] max-w-screen-2xl mx-auto">
      <PageHeader
        title="Employee Recruitment Portal"
        subtitle="Manage open positions, applications, and hiring needs"
        actions={
          <Button variant="secondary" onClick={() => setShowFilters(!showFilters)} icon={<Filter className="w-3.5 h-3.5" />}>
            {showFilters ? 'Hide Filters' : 'Show Filters'}
          </Button>
        }
      />

      {showNewPositionModal && (
        <NewPositionModal 
          onClose={() => setShowNewPositionModal(false)}
          onPositionAdded={fetchPositions}
        />
      )}

      {showFilters && (
        <FiltersSection
          selectedBranch={selectedBranch}
          setSelectedBranch={setSelectedBranch}
          selectedDepartment={selectedDepartment}
          setSelectedDepartment={setSelectedDepartment}
          selectedStatus={selectedStatus}
          setSelectedStatus={setSelectedStatus}
          selectedType={selectedType}
          setSelectedType={setSelectedType}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
        />
      )}

      <TabsNavigation 
        selectedTab={selectedTab}
        setSelectedTab={setSelectedTab}
        jobPositionsCount={positions.length}
        applicationsCount={applications.length}
        branchesCount={branches.length}
      />

      {selectedTab === 'positions' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard 
            label="Open Positions" 
            value={statusCounts['open']} 
            icon="" 
            color="blue"
            isCount={true}
          />
          <SummaryCard 
            label="Pending Positions" 
            value={statusCounts['pending']} 
            icon="" 
            color="orange"
            isCount={true}
          />
          <SummaryCard 
            label="Closed Positions" 
            value={statusCounts['closed']} 
            icon="" 
            color="green"
            isCount={true}
          />
        </div>
      )}

      {selectedTab === 'positions' && (
        <PositionsTable 
          positions={filteredPositions} 
          onUpdate={fetchPositions}
        />
      )}

      {selectedTab === 'applications' && (
        <ApplicationsTable 
          applications={filteredApplications} 
          setSelectedApplication={setSelectedApplication}
          onUpdate={fetchApplications}
        />
      )}

      {selectedTab === 'branches' && (
        <BranchesSection />
      )}

      {selectedApplication && (
        <ApplicationDetailModal 
          application={selectedApplication} 
          onClose={() => setSelectedApplication(null)} 
        />
      )}
    </div>
  );
}