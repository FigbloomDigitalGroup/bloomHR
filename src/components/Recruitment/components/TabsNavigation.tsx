import { TabBar } from '../../UI';

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
    <div className="pb-[18px] border-b border-border">
      <TabBar
        items={[
          { id: 'positions', label: `Open Positions (${jobPositionsCount})` },
          { id: 'applications', label: `Applications (${applicationsCount})` },
          { id: 'branches', label: `Branches (${branchesCount})` },
        ]}
        activeId={selectedTab}
        onChange={setSelectedTab}
      />
    </div>
  );
};
