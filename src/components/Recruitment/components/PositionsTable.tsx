import { useState, useEffect } from 'react';
import { Download, Edit, Users, Save, X, Plus, Trash2, CheckCircle, AlertCircle, XCircle, Info, FileText, Award } from 'lucide-react';
import { GlowButton } from './GlowButton';
import { StatusBadge } from './StatusBadge';
import { branches } from './constants/branches';
import { supabase } from '../../../lib/supabase';

// Toast component
const Toast = ({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'warning' | 'info'; onClose: () => void }) => {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info
  };
  
  const colors = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800'
  };
  
  const Icon = icons[type];
  
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [onClose]);
  
  return (
    <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg border shadow-lg flex items-center gap-3 max-w-md ${colors[type]}`}>
      <Icon size={20} />
      <span className="flex-1">{message}</span>
      <button onClick={onClose} className="ml-2">
        <X size={16} />
      </button>
    </div>
  );
};

// Job Description & Qualifications Modal
const JobDetailModal = ({ position, onClose }: { position: Position; onClose: () => void }) => {
  const [activeTab, setActiveTab] = useState<'description' | 'qualifications'>('description');

  const jobDetails = {
    // Relationship Management
    'Relationship Manager': {
      description: 'Drive client portfolio growth by developing strategic relationships with high-net-worth individuals and corporate clients. Manage a portfolio of 50+ key accounts with assets under management exceeding $10M. Implement client retention strategies that achieve 95% satisfaction scores.',
      qualifications: [
        'Bachelor\'s degree in Finance, Business Administration, or Economics (MBA preferred)',
        '5+ years in private banking or wealth management relationship management',
        'CFA Level II or CFP certification required',
        'Proven track record of growing AUM by 20%+ annually',
        'Expert knowledge of investment products, portfolio management, and risk assessment',
        'Experience with CRM systems (Salesforce) and financial modeling tools'
      ],
      responsibilities: [
        'Manage and grow a portfolio of 50+ high-value client relationships',
        'Develop customized wealth management strategies for clients with $500K+ investable assets',
        'Cross-sell banking products achieving 15% quarterly growth targets',
        'Conduct quarterly portfolio reviews and risk assessment meetings',
        'Collaborate with investment advisors to optimize client portfolio performance',
        'Resolve escalated client issues within 24-hour service level agreement'
      ]
    },
    'Client Relations Specialist': {
      description: 'Serve as the primary escalation point for VIP clients, ensuring seamless service delivery and maintaining 98% client retention rate. Implement client feedback systems that drive continuous service improvement.',
      qualifications: [
        'Bachelor\'s degree in Business Communications or related field',
        '3+ years in client service within financial services industry',
        'Certified Customer Experience Professional (CCXP) preferred',
        'Expertise in conflict resolution and difficult conversation management',
        'Experience with Zendesk, JIRA, or similar customer service platforms',
        'Knowledge of banking compliance and regulatory requirements'
      ],
      responsibilities: [
        'Manage VIP client escalations and ensure resolution within 4 business hours',
        'Maintain client relationship metrics and NPS scores above industry average',
        'Develop and implement client satisfaction improvement initiatives',
        'Coordinate with branches to ensure consistent service delivery standards',
        'Conduct client feedback sessions and focus groups quarterly',
        'Train frontline staff on premium client service protocols'
      ]
    },

    // Credit and Risk
    'Credit Analyst': {
      description: 'Conduct comprehensive credit analysis for commercial loan applications ranging from $250K to $5M. Utilize advanced financial modeling to assess borrower creditworthiness and maintain portfolio delinquency below 2%.',
      qualifications: [
        'Bachelor\'s degree in Finance, Accounting, or Economics (Master\'s preferred)',
        '3+ years commercial credit analysis experience in banking',
        'Advanced Excel skills with experience in financial modeling and scenario analysis',
        'Knowledge of Moody\'s Risk Analyst or similar credit assessment tools',
        'Understanding of Basel III regulations and credit risk frameworks',
        'CPA or CFA certification preferred'
      ],
      responsibilities: [
        'Analyze financial statements, cash flow projections, and business plans',
        'Prepare detailed credit memos with risk ratings for credit committee review',
        'Monitor portfolio of 100+ commercial loans for early warning signs',
        'Conduct industry and market analysis for loan applications',
        'Collaborate with relationship managers on credit structure recommendations',
        'Ensure compliance with lending policies and regulatory requirements'
      ]
    },
    'Risk Manager': {
      description: 'Develop and implement enterprise risk management framework covering credit, market, and operational risk. Monitor risk exposure across $500M+ portfolio and ensure regulatory compliance.',
      qualifications: [
        'Master\'s degree in Risk Management, Finance, or Quantitative Finance',
        '7+ years in banking risk management with 3+ years in leadership role',
        'FRM (Financial Risk Manager) or PRM (Professional Risk Manager) certification',
        'Expert knowledge of VaR models, stress testing, and scenario analysis',
        'Experience with Bloomberg Terminal, Reuters, and risk management software',
        'Deep understanding of Dodd-Frank, Basel III, and local regulatory requirements'
      ],
      responsibilities: [
        'Develop and maintain enterprise risk management framework and policies',
        'Conduct monthly stress testing on $500M+ investment portfolio',
        'Monitor counterparty risk exposure and set concentration limits',
        'Prepare risk reports for Board Risk Committee meetings',
        'Implement fraud detection systems reducing losses by 25% annually',
        'Lead regulatory compliance audits and examinations'
      ]
    },

    // Customer Service
    'Customer Service Representative': {
      description: 'Deliver exceptional frontline banking services, handling 100+ daily customer interactions across multiple channels while maintaining 90%+ customer satisfaction scores.',
      qualifications: [
        'Associate\'s degree in Business or related field (Bachelor\'s preferred)',
        '2+ years in customer-facing role in financial services',
        'Series 6 and 63 licenses (or ability to obtain within 90 days)',
        'Typing speed of 45+ WPM with 95% accuracy',
        'Bilingual in Spanish/English preferred',
        'Experience with core banking systems (Fiserv, Jack Henry)'
      ],
      responsibilities: [
        'Handle 50+ daily inbound calls with 2-minute average handle time',
        'Process account transactions, transfers, and payment requests accurately',
        'Cross-sell 3+ banking products monthly to existing customers',
        'Maintain 95% accuracy in transaction processing and documentation',
        'Educate customers on digital banking platforms and mobile app features',
        'Escalate complex issues to appropriate departments within service guidelines'
      ]
    },

    // Operations
    'Operations Manager': {
      description: 'Oversee daily banking operations for 15+ branch network, managing team of 25+ operations staff and ensuring 99.9% transaction processing accuracy.',
      qualifications: [
        'Bachelor\'s degree in Business Administration or Operations Management',
        '8+ years in banking operations with 5+ years in management role',
        'Six Sigma Green Belt or Black Belt certification',
        'Experience with process automation and digital transformation projects',
        'Knowledge of Fedwire, CHIPS, and SWIFT payment systems',
        'Proven track record of reducing operational costs by 15%+'
      ],
      responsibilities: [
        'Manage daily operations across 15+ branches with $2M+ daily transaction volume',
        'Lead team of 25+ operations staff with focus on performance optimization',
        'Implement process improvements reducing operational errors by 30%',
        'Oversee cash management and vault operations maintaining optimal liquidity',
        'Coordinate with IT on system upgrades and business continuity planning',
        'Ensure compliance with Reg CC, Reg D, and other banking regulations'
      ]
    },

    // Branch Management
    'Branch Manager': {
      description: 'Lead high-volume branch generating $15M+ annual revenue, managing team of 12+ staff and driving market share growth in competitive urban market.',
      qualifications: [
        'Bachelor\'s degree in Business, Finance, or related field (MBA preferred)',
        '8+ years in retail banking with 5+ years in branch management',
        'Proven track record of exceeding deposit growth targets by 15%+ annually',
        'Experience managing P&L for $2M+ annual budget',
        'Strong knowledge of consumer lending regulations and compliance',
        'NMLS certification required'
      ],
      responsibilities: [
        'Manage branch P&L with focus on achieving 20% annual profit growth',
        'Lead team of 12+ banking professionals with focus on sales performance',
        'Drive deposit growth of 15% annually through targeted marketing initiatives',
        'Maintain branch audit scores of 95%+ in regulatory compliance',
        'Develop and execute local market penetration strategies',
        'Build community relationships resulting in 50+ new business referrals monthly'
      ]
    },

    // Area Management
    'Area Manager': {
      description: 'Oversee performance of 8 branches across 3 counties, driving $50M+ deposit growth and managing regional market expansion strategies.',
      qualifications: [
        'MBA in Finance or Business Administration',
        '10+ years in retail banking with 5+ years multi-unit management',
        'Proven experience growing regional market share by 10%+ annually',
        'Strong understanding of regional economic trends and competitive landscape',
        'Experience with mergers and acquisitions integration',
        'Certified Branch Manager Executive (CBME) certification preferred'
      ],
      responsibilities: [
        'Manage $150M+ deposit portfolio across 8-branch network',
        'Drive regional revenue growth of 12% annually through strategic initiatives',
        'Coach and develop 8 branch managers with focus on leadership development',
        'Implement standardized operating procedures across all locations',
        'Lead market expansion projects including 2+ new branch openings annually',
        'Maintain regional compliance audit scores above 95%'
      ]
    },

    // Regional Management
    'Regional Director': {
      description: 'Lead strategic direction for 25+ branches across 5 states, managing $500M+ asset portfolio and driving enterprise-wide growth initiatives.',
      qualifications: [
        'MBA from top-tier business school',
        '15+ years in banking with 8+ years in regional/executive leadership',
        'Proven track record of growing regional revenue by 20%+ annually',
        'Experience with digital banking transformation and fintech partnerships',
        'Strong relationships with regulatory bodies and industry associations',
        'Previous P&L responsibility for $50M+ annual budget'
      ],
      responsibilities: [
        'Set strategic direction for 25+ branches with $500M+ assets under management',
        'Achieve regional profitability targets of 25% ROE',
        'Lead digital transformation initiatives impacting 200,000+ customers',
        'Develop and execute M&A strategies for market consolidation',
        'Represent institution in industry forums and regulatory meetings',
        'Mentor and develop next-generation banking leadership talent'
      ]
    },

    // IT and Systems Support
    'IT Support Specialist': {
      description: 'Provide Level 2 technical support for 500+ banking staff, maintaining 99.9% system availability and implementing cybersecurity protocols across the network.',
      qualifications: [
        'Bachelor\'s degree in Computer Science or Information Technology',
        '3+ years in IT support within financial services environment',
        'CompTIA Security+, Network+, and A+ certifications required',
        'Experience with Active Directory, Windows Server, and VMware',
        'Knowledge of PCI DSS compliance requirements',
        'Programming skills in PowerShell or Python preferred'
      ],
      responsibilities: [
        'Provide technical support for 500+ users across 25+ locations',
        'Maintain core banking systems with 99.9% uptime requirement',
        'Implement security patches and updates within 48 hours of release',
        'Manage user access controls and permissions following SOX compliance',
        'Document IT procedures and maintain knowledge base articles',
        'Participate in disaster recovery testing and business continuity planning'
      ]
    },
    'Systems Administrator': {
      description: 'Manage enterprise banking infrastructure supporting 50,000+ daily transactions, ensuring system security, performance, and regulatory compliance.',
      qualifications: [
        'Bachelor\'s degree in Computer Science or related field',
        '5+ years in systems administration with banking/financial services experience',
        'MCSE, CCNA, or CISSP certifications required',
        'Expert knowledge of Windows/Linux server environments and virtualization',
        'Experience with SQL Server, Oracle databases, and storage area networks',
        'Knowledge of NIST cybersecurity framework and FFIEC guidelines'
      ],
      responsibilities: [
        'Administer 100+ virtual servers supporting core banking operations',
        'Implement and maintain cybersecurity controls meeting FFIEC requirements',
        'Manage database systems processing 50,000+ daily transactions',
        'Lead infrastructure projects with budgets up to $500K',
        'Ensure 99.95% system availability through proactive monitoring',
        'Coordinate with vendors on system upgrades and technology refresh cycles'
      ]
    }
  };

  const details = jobDetails[position.title as keyof typeof jobDetails] || {
    description: 'Responsible for performing duties related to the position and contributing to organizational success.',
    qualifications: [
      'Relevant educational background',
      'Previous experience in similar role',
      'Strong communication skills',
      'Ability to work in team environment'
    ],
    responsibilities: [
      'Perform duties as assigned by management',
      'Collaborate with team members to achieve department goals',
      'Maintain accurate records and documentation',
      'Adhere to company policies and procedures'
    ]
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{position.title}</h2>
              <div className="flex items-center gap-4 mt-2 text-xs">
                <span className="text-gray-600">{position.department}</span>
                <span className="text-gray-600">•</span>
                <span className="text-gray-600">{branches.find(b => b.id === position.branch)?.name}</span>
                <StatusBadge status={position.status} />
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            <button
              onClick={() => setActiveTab('description')}
              className={`py-4 px-1 border-b-2 font-medium text-xs flex items-center gap-2 ${
                activeTab === 'description'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <FileText size={16} />
              Job Description
            </button>
            <button
              onClick={() => setActiveTab('qualifications')}
              className={`py-4 px-1 border-b-2 font-medium text-xs flex items-center gap-2 ${
                activeTab === 'qualifications'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Award size={16} />
              Qualifications & Requirements
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'description' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Position Overview</h3>
                <p className="text-gray-700 leading-relaxed text-xs">
                  {details.description}
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Key Responsibilities</h3>
                <ul className="list-disc list-inside space-y-2 text-gray-700 text-xs">
                  {details.responsibilities.map((responsibility, index) => (
                    <li key={index} className="leading-relaxed">{responsibility}</li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 text-xs">
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Employment Type</h4>
                  <p className="text-gray-700">{position.type}</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Location</h4>
                  <p className="text-gray-700">{branches.find(b => b.id === position.branch)?.name}</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Department</h4>
                  <p className="text-gray-700">{position.department}</p>
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Reporting Structure</h4>
                  <p className="text-gray-700">
                    {position.department === 'Branch Management' ? 'Reports to Area Manager' :
                     position.department === 'Area Management' ? 'Reports to Regional Director' :
                     position.department === 'Regional Management' ? 'Reports to Chief Operating Officer' :
                     'Reports to Department Head'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'qualifications' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Required Qualifications & Experience</h3>
                <ul className="space-y-3">
                  {details.qualifications.map((qualification, index) => (
                    <li key={index} className="flex items-start gap-3">
                      <div className="w-2 h-2 bg-blue-500 rounded-full mt-1.5 flex-shrink-0"></div>
                      <span className="text-gray-700 leading-relaxed text-xs">{qualification}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-blue-900 mb-2 text-xs">Application Requirements</h4>
                <ul className="list-disc list-inside space-y-1 text-blue-800 text-xs">
                  <li>Updated professional resume/CV with quantifiable achievements</li>
                  <li>Cover letter addressing position requirements</li>
                  <li>Copies of relevant certifications and educational transcripts</li>
                  <li>3 professional references with contact information</li>
                  <li>Salary expectations and availability timeline</li>
                </ul>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h4 className="font-semibold text-green-900 mb-2 text-xs">Compensation & Benefits</h4>
                <ul className="list-disc list-inside space-y-1 text-green-800 text-xs">
                  <li>Competitive salary with performance-based bonuses</li>
                  <li>Comprehensive health insurance (medical, dental, vision)</li>
                  <li>401(k) retirement plan with company matching</li>
                  <li>Professional development and certification support</li>
                  <li>Paid time off and flexible work arrangements</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-xs text-gray-600">
                Posted: {new Date(position.created_at).toLocaleDateString()}
                {position.updated_at && ` • Updated: ${new Date(position.updated_at).toLocaleDateString()}`}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-xs"
              >
                Close
              </button>
              
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

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
  description?: string;
  qualifications?: string[];
}

interface PositionsTableProps {
  positions: Position[];
  onUpdate?: () => void;
}

interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

const PositionsTable = ({ positions, onUpdate = () => {} }: PositionsTableProps) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedPosition, setEditedPosition] = useState<Partial<Position> | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newPosition, setNewPosition] = useState<Partial<Position>>({
    title: '',
    department: '',
    type: '',
    branch: '',
    status: 'open'
  });
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);

  // Toast helper functions
  const addToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  const isValidUUID = (id: string | number): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return typeof id === 'string' && uuidRegex.test(id);
  };

  // Ensure status is always one of the allowed values
  const sanitizeStatus = (status: string): 'open' | 'closed' | 'pending' => {
    const allowedStatuses = ['open', 'closed', 'pending'];
    return allowedStatuses.includes(status) ? status as 'open' | 'closed' | 'pending' : 'open';
  };

  const handleEdit = (position: Position) => {
    setEditingId(String(position.id));
    setEditedPosition({ 
      ...position,
      status: sanitizeStatus(position.status)
    });
  };

  const handleSave = async () => {
    if (!editingId || !editedPosition) return;
    
    setIsLoading(true);
    try {
      const isLegacyId = !isValidUUID(editingId);
      
      const positionData = {
        title: editedPosition.title,
        department: editedPosition.department,
        type: editedPosition.type,
        branch: editedPosition.branch,
        status: sanitizeStatus(editedPosition.status || 'open'),
        applications: editedPosition.applications || '0',
        updated_at: new Date().toISOString()
      };

      let result;

      if (isLegacyId) {
        // For legacy IDs, create new record
        result = await supabase
          .from('job_positions')
          .insert([positionData])
          .select();

        if (result.error) throw result.error;
        addToast('New position created successfully!', 'success');
      } else {
        // For UUIDs, update existing record
        result = await supabase
          .from('job_positions')
          .update(positionData)
          .eq('id', editingId)
          .select();

        if (result.error) throw result.error;
        addToast('Position updated successfully!', 'success');
      }

      setEditingId(null);
      setEditedPosition(null);
      
      // Call the parent's update function to refresh data from database
      onUpdate();
      
    } catch (error: any) {
      console.error('Error saving position:', error);
      addToast(error.message || 'Failed to save position. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditedPosition(null);
  };

  const handleDelete = async (id: string | number) => {
    if (!isValidUUID(String(id))) {
      addToast('Cannot delete legacy records. Please create a new record instead.', 'warning');
      return;
    }

    if (!confirm('Are you sure you want to delete this position? This action cannot be undone.')) return;

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('job_positions')
        .delete()
        .eq('id', String(id));

      if (error) throw error;
      
      addToast('Position deleted successfully!', 'success');
      onUpdate();
    } catch (error: any) {
      console.error('Error deleting position:', error);
      addToast(error.message || 'Error deleting position', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newPosition.title || !newPosition.department || !newPosition.type || !newPosition.branch) {
      addToast('Please fill in all required fields', 'warning');
      return;
    }

    setIsLoading(true);
    try {
      const positionData = {
        title: newPosition.title,
        department: newPosition.department,
        type: newPosition.type,
        branch: newPosition.branch,
        status: sanitizeStatus(newPosition.status || 'open'),
        applications: newPosition.applications || '0',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('job_positions')
        .insert([positionData])
        .select();

      if (error) throw error;

      setIsAdding(false);
      setNewPosition({
        title: '',
        department: '',
        type: '',
        branch: '',
        status: 'open'
      });
      addToast('Position added successfully!', 'success');
      onUpdate();
    } catch (error: any) {
      console.error('Error adding position:', error);
      addToast(error.message || 'Error adding position', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const headers = ['Title', 'Department', 'Type', 'Branch', 'Status', 'Applications', 'Created Date'];
      const csvData = positions.map(pos => [
        `"${pos.title}"`,
        `"${pos.department}"`,
        `"${pos.type}"`,
        `"${branches.find(b => b.id === pos.branch)?.name || pos.branch}"`,
        `"${pos.status}"`,
        `"${pos.applications || '0'}"`,
        `"${new Date(pos.created_at).toLocaleDateString()}"`
      ]);

      const csvContent = [
        headers.join(','),
        ...csvData.map(row => row.join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `job-positions-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      addToast('Positions data exported successfully!', 'success');
    } catch (error) {
      console.error('Error exporting data:', error);
      addToast('Error exporting data', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  // Department options for dropdown
  const departments = [
    'Relationship Management',
    'Credit and Risk',
    'Customer Service',
    'Operations',
    'Branch Management',
    'Area Management',
    'Regional Management',
    'IT and Systems Support'
  ];

  // Position types
  const positionTypes = [
    'Full-Time',
    'Part-Time',
    'Contract',
    'Temporary',
    'Internship'
  ];

  // Allowed status values
  const allowedStatuses = [
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Closed' },
    { value: 'pending', label: 'Pending' }
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Toast notifications */}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
      
      {/* Job Detail Modal */}
      {selectedPosition && (
        <JobDetailModal 
          position={selectedPosition} 
          onClose={() => setSelectedPosition(null)} 
        />
      )}
      
      <div className="p-4 md:p-6 border-b border-gray-200">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Job Positions</h2>
            <p className="text-gray-600 text-xs">{positions.length} active positions</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <GlowButton 
              variant="secondary" 
              icon={Download} 
              size="sm"
              onClick={handleExport}
              disabled={isExporting || positions.length === 0}
            >
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </GlowButton>
            <GlowButton 
              variant="primary" 
              icon={Plus} 
              size="sm"
              onClick={() => setIsAdding(true)}
              disabled={isLoading}
            >
              Add New Position
            </GlowButton>
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-gray-700 font-semibold">Position Title</th>
              <th className="text-left py-3 px-4 text-gray-700 font-semibold">Department</th>
              <th className="text-left py-3 px-4 text-gray-700 font-semibold">Type</th>
              <th className="text-left py-3 px-4 text-gray-700 font-semibold">Branch</th>
              <th className="text-left py-3 px-4 text-gray-700 font-semibold">Status</th>
              <th className="text-center py-3 px-4 text-gray-700 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* Add new position row */}
            {isAdding && (
              <tr className="bg-blue-50 border-b border-blue-100">
                <td className="py-4 px-4">
                  <input
                    type="text"
                    value={newPosition.title || ''}
                    onChange={(e) => setNewPosition({...newPosition, title: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Enter position title"
                  />
                </td>
                <td className="py-4 px-4">
                  <select
                    value={newPosition.department || ''}
                    onChange={(e) => setNewPosition({...newPosition, department: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select Department</option>
                    {departments.map(dept => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-4 px-4">
                  <select
                    value={newPosition.type || ''}
                    onChange={(e) => setNewPosition({...newPosition, type: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select Type</option>
                    {positionTypes.map(type => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-4 px-4">
                  <select
                    value={newPosition.branch || ''}
                    onChange={(e) => setNewPosition({...newPosition, branch: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select branch</option>
                    {branches.map(branch => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-4 px-4">
                  <select
                    value={newPosition.status || 'open'}
                    onChange={(e) => setNewPosition({...newPosition, status: e.target.value as any})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    {allowedStatuses.map(status => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-4 px-4">
                  <div className="flex justify-center gap-2">
                    <button
                      onClick={handleAdd}
                      disabled={isLoading}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      <Save size={16} />
                      {isLoading ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setIsAdding(false)}
                      disabled={isLoading}
                      className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 flex items-center gap-2"
                    >
                      <X size={16} />
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {/* Existing positions */}
            {positions.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 px-4 text-center text-gray-500">
                  <Users size={48} className="mx-auto mb-2 opacity-50" />
                  <p>No positions found</p>
                  <p className="text-sm">Click "Add New Position" to create your first job posting</p>
                </td>
              </tr>
            ) : (
              positions.map((position) => {
                const branch = branches.find(b => b.id === position.branch);
                const isEditing = editingId === String(position.id);

                return (
                  <tr key={position.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedPosition?.title || ''}
                          onChange={(e) => setEditedPosition({...editedPosition, title: e.target.value})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <div className="space-y-1">
                          <p 
                            className="text-gray-900 font-semibold cursor-pointer hover:text-blue-600 transition-colors"
                            onClick={() => setSelectedPosition(position)}
                          >
                            {position.title}
                          </p>
                          <button 
                            onClick={() => setSelectedPosition(position)}
                            className="text-blue-600 hover:text-blue-800 text-xs flex items-center gap-1 transition-colors"
                          >
                            <FileText size={12} />
                            View Details & Requirements
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <select
                          value={editedPosition?.department || ''}
                          onChange={(e) => setEditedPosition({...editedPosition, department: e.target.value})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select Department</option>
                          {departments.map(dept => (
                            <option key={dept} value={dept}>
                              {dept}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-gray-700">{position.department}</p>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <select
                          value={editedPosition?.type || ''}
                          onChange={(e) => setEditedPosition({...editedPosition, type: e.target.value})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select Type</option>
                          {positionTypes.map(type => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-gray-700">{position.type}</p>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <select
                          value={editedPosition?.branch || ''}
                          onChange={(e) => setEditedPosition({...editedPosition, branch: e.target.value})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          {branches.map(branch => (
                            <option key={branch.id} value={branch.id}>
                              {branch.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-gray-700">{branch?.name}</p>
                      )}
                    </td>
                    <td className="py-4 px-4">
                      {isEditing ? (
                        <select
                          value={editedPosition?.status || 'open'}
                          onChange={(e) => setEditedPosition({...editedPosition, status: e.target.value as any})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                          {allowedStatuses.map(status => (
                            <option key={status.value} value={status.value}>
                              {status.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge status={position.status} />
                      )}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex justify-center gap-2">
                        {isEditing ? (
                          <>
                            <button
                              onClick={handleSave}
                              disabled={isLoading}
                              className="px-3 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1 text-xs"
                            >
                              <Save size={14} />
                              {isLoading ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              onClick={handleCancel}
                              disabled={isLoading}
                              className="px-3 py-1 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 flex items-center gap-1 text-xs"
                            >
                              <X size={14} />
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEdit(position)}
                              disabled={isLoading}
                              className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1 text-xs"
                            >
                              <Edit size={14} />
                              {isValidUUID(String(position.id)) ? 'Edit' : 'Adjust'}
                            </button>
                            {isValidUUID(String(position.id)) && (
                              <button
                                onClick={() => handleDelete(position.id)}
                                disabled={isLoading}
                                className="px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1 text-xs"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PositionsTable;