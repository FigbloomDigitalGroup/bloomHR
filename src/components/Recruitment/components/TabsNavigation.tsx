interface TabsNavigationProps {
  selectedTab: string;
  setSelectedTab: (tab: string) => void;
  jobPositionsCount: number;
  applicationsCount: number;
  branchesCount: number;
}

export const TabsNavigation = ({
  selectedTab,
  setSelectedTab,
  jobPositionsCount,
  applicationsCount,
  branchesCount,
}: TabsNavigationProps) => {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px">
          <button
            onClick={() => setSelectedTab('positions')}
            className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${selectedTab === 'positions' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            Open Positions ({jobPositionsCount})
          </button>
          <button
            onClick={() => setSelectedTab('applications')}
            className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${selectedTab === 'applications' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            Applications ({applicationsCount})
          </button>
          <button
            onClick={() => setSelectedTab('branches')}
            className={`py-4 px-6 text-center border-b-2 font-medium text-xs ${selectedTab === 'branches' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
          >
            Branches ({branchesCount})
          </button>
        </nav>
      </div>
    </div>
  );
};