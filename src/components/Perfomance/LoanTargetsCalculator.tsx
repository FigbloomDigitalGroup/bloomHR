import React from 'react';
import { Building, Target, Calendar, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';

interface Branch {
  id: number;
  "Branch Office": string;
  "Area": string;
  "Date Opened": string;
  [key: string]: any;
}

interface LoanTargetMetrics {
  branchName: string;
  branchAge: number;
  ageCategory: 'New' | 'Old';
  newLoanTarget: number;
  repeatLoanTarget: number;
  totalLoanCount: number;
  averageLoanValue: number;
  projectedDisbursement: number;
  targetedOLB: number;
  retentionRate: number;
  actualNewLoans: number;
  actualRepeatLoans: number;
  achievementRate: number;
}

interface LoanTargetsCalculatorProps {
  branches: Branch[];
  loans: any[];
  clients: any[];
}

const LoanTargetsCalculator: React.FC<LoanTargetsCalculatorProps> = ({ 
  branches, 
  loans, 
  clients 
}) => {
  // Calculate branch age in months
  const calculateBranchAge = (dateOpened: string): number => {
    const openDate = new Date(dateOpened);
    const currentDate = new Date();
    const diffTime = Math.abs(currentDate.getTime() - openDate.getTime());
    const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30));
    return diffMonths;
  };

  // Calculate loan target metrics for each branch
  const calculateLoanTargets = (): LoanTargetMetrics[] => {
    return branches.map(branch => {
      const branchAge = calculateBranchAge(branch["Date Opened"] || '2024-01-01');
      const ageCategory: 'New' | 'Old' = branchAge <= 3 ? 'New' : 'Old';
      
      // Target rules
      const newLoanTarget = ageCategory === 'New' ? 30 : 25;
      const repeatLoanTarget = Math.round(newLoanTarget * 0.8); // 80% retention
      const totalLoanCount = newLoanTarget + repeatLoanTarget;
      const averageLoanValue = 250000 / 50; // 5,000
      const projectedDisbursement = totalLoanCount * averageLoanValue;
      const targetedOLB = totalLoanCount * averageLoanValue;
      
      // Calculate actual performance
      const branchLoans = loans.filter(loan => {
        const loanOfficer = loan.loan_officer;
        const employee = clients.find(c => c.client_id === loan.client_id);
        // This is a simplified calculation - you might need to adjust based on your data structure
        return loan.branch === branch["Branch Office"] || 
               (employee && employee.branch === branch["Branch Office"]);
      });
      
      const currentMonth = new Date().toISOString().slice(0, 7);
      const currentMonthLoans = branchLoans.filter(loan => 
        loan.disbursement_date && loan.disbursement_date.startsWith(currentMonth)
      );
      
      // Calculate new vs repeat loans (simplified - you may need to adjust logic)
      const actualNewLoans = currentMonthLoans.filter(loan => loan.loan_cycle === 1).length;
      const actualRepeatLoans = currentMonthLoans.filter(loan => loan.loan_cycle > 1).length;
      
      // Calculate retention rate
      const previousMonthClients = clients.filter(client => {
        const lastLoan = branchLoans
          .filter(loan => loan.client_id === client.client_id)
          .sort((a, b) => new Date(b.disbursement_date).getTime() - new Date(a.disbursement_date).getTime())[0];
        return lastLoan && lastLoan.disbursement_date < currentMonth + '-01';
      });
      
      const retainedClients = previousMonthClients.filter(client => {
        return currentMonthLoans.some(loan => loan.client_id === client.client_id);
      });
      
      const retentionRate = previousMonthClients.length > 0 ? 
        Math.round((retainedClients.length / previousMonthClients.length) * 100) : 0;
      
      // Calculate achievement rate
      const totalActualLoans = actualNewLoans + actualRepeatLoans;
      const achievementRate = totalLoanCount > 0 ? 
        Math.round((totalActualLoans / totalLoanCount) * 100) : 0;
      
      return {
        branchName: branch["Branch Office"] || '',
        branchAge,
        ageCategory,
        newLoanTarget,
        repeatLoanTarget,
        totalLoanCount,
        averageLoanValue,
        projectedDisbursement,
        targetedOLB,
        retentionRate,
        actualNewLoans,
        actualRepeatLoans,
        achievementRate
      };
    });
  };

  const loanTargetMetrics = calculateLoanTargets();

  const StatusBadge: React.FC<{ value: number; type: 'retention' | 'achievement' | 'age' }> = ({ value, type }) => {
    let colorClass = '';
    let displayValue = '';
    
    if (type === 'age') {
      colorClass = value <= 3 ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
      displayValue = value <= 3 ? 'New' : 'Established';
    } else if (type === 'retention') {
      colorClass = value >= 80 ? 'bg-green-100 text-green-800' : 
                   value >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
      displayValue = `${value}%`;
    } else {
      colorClass = value >= 100 ? 'bg-green-100 text-green-800' : 
                   value >= 80 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800';
      displayValue = `${value}%`;
    }
    
    return (
      <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${colorClass}`}>
        {displayValue}
      </span>
    );
  };

  // Summary metrics
  const totalBranches = loanTargetMetrics.length;
  const newBranches = loanTargetMetrics.filter(m => m.ageCategory === 'New').length;
  const totalProjectedDisbursement = loanTargetMetrics.reduce((sum, m) => sum + m.projectedDisbursement, 0);
  const averageRetentionRate = loanTargetMetrics.reduce((sum, m) => sum + m.retentionRate, 0) / totalBranches;
  const averageAchievementRate = loanTargetMetrics.reduce((sum, m) => sum + m.achievementRate, 0) / totalBranches;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
              <Building className="w-5 h-5" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide">Total Branches</p>
            <p className="text-gray-900 text-xl font-bold">{totalBranches}</p>
            <p className="text-gray-500 text-xs">{newBranches} new, {totalBranches - newBranches} established</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-green-100 text-green-600">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide">Projected Disbursement</p>
            <p className="text-gray-900 text-xl font-bold">KSh {totalProjectedDisbursement.toLocaleString()}</p>
            <p className="text-gray-500 text-xs">All branches combined</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-purple-100 text-purple-600">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide">Avg Retention Rate</p>
            <p className="text-gray-900 text-xl font-bold">{Math.round(averageRetentionRate)}%</p>
            <p className="text-gray-500 text-xs">Target: 80%</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-orange-100 text-orange-600">
              <BarChart3 className="w-5 h-5" />
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-gray-600 text-xs font-semibold uppercase tracking-wide">Avg Achievement</p>
            <p className="text-gray-900 text-xl font-bold">{Math.round(averageAchievementRate)}%</p>
            <p className="text-gray-500 text-xs">Overall target achievement</p>
          </div>
        </div>
      </div>

      {/* Loan Targets Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Target className="w-5 h-5 text-green-500" />
                Branch Loan Targets & Performance
              </h2>
              <p className="text-gray-600 text-xs">Monthly loan targeting based on branch age and retention metrics</p>
            </div>
            <div className="text-xs text-gray-500">
              Average Loan Value: KSh 5,000
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-gray-700 font-semibold">Branch Details</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Branch Age</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">New Loan Target</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Repeat Loan Target</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Total Target</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Actual Performance</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Projected Disbursement</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Targeted OLB</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Retention Rate</th>
                <th className="text-center py-3 px-4 text-gray-700 font-semibold">Achievement</th>
              </tr>
            </thead>
            <tbody>
              {loanTargetMetrics.map((metrics, index) => (
                <tr key={index} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="py-4 px-4">
                    <div>
                      <p className="font-semibold text-gray-900">{metrics.branchName}</p>
                      <p className="text-gray-500 text-xs">
                        {branches.find(b => b["Branch Office"] === metrics.branchName)?.[" Area"] || ''}
                      </p>
                    </div>
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <div className="space-y-1">
                      <p className="font-medium">{metrics.branchAge} months</p>
                      <StatusBadge value={metrics.branchAge} type="age" />
                    </div>
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <div className="space-y-1">
                      <p className="font-bold text-gray-900">{metrics.newLoanTarget}</p>
                      <p className="text-gray-500">loans</p>
                    </div>
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <div className="space-y-1">
                      <p className="font-bold text-gray-900">{metrics.repeatLoanTarget}</p>
                      <p className="text-gray-500">loans (80% retention)</p>
                    </div>
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <div className="space-y-1">
                      <p className="font-bold text-lg text-green-600">{metrics.totalLoanCount}</p>
                      <p className="text-gray-500">total loans</p>
                    </div>
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 justify-center">
                        <span className="text-green-600 font-medium">{metrics.actualNewLoans}</span>
                        <span className="text-gray-400">+</span>
                        <span className="text-blue-600 font-medium">{metrics.actualRepeatLoans}</span>
                      </div>
                      <p className="text-gray-500">new + repeat</p>
                    </div>
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <div className="space-y-1">
                      <p className="font-bold text-gray-900">
                        KSh {metrics.projectedDisbursement.toLocaleString()}
                      </p>
                      <p className="text-gray-500">@ KSh 5,000 avg</p>
                    </div>
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <div className="space-y-1">
                      <p className="font-bold text-gray-900">
                        KSh {metrics.targetedOLB.toLocaleString()}
                      </p>
                      <p className="text-gray-500">outstanding</p>
                    </div>
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <StatusBadge value={metrics.retentionRate} type="retention" />
                  </td>
                  
                  <td className="py-4 px-4 text-center">
                    <div className="space-y-2">
                      <StatusBadge value={metrics.achievementRate} type="achievement" />
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${
                            metrics.achievementRate >= 100 ? 'bg-green-500' : 
                            metrics.achievementRate >= 80 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(100, metrics.achievementRate)}%` }}
                        ></div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Summary Footer */}
        <div className="bg-gray-50 p-4 border-t border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide">Total Target Loans</p>
              <p className="text-lg font-bold text-gray-900">
                {loanTargetMetrics.reduce((sum, m) => sum + m.totalLoanCount, 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide">Total Projected Disbursement</p>
              <p className="text-lg font-bold text-green-600">
                KSh {totalProjectedDisbursement.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide">Average Retention</p>
              <p className="text-lg font-bold text-blue-600">
                {Math.round(averageRetentionRate)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-600 uppercase tracking-wide">Average Achievement</p>
              <p className="text-lg font-bold text-purple-600">
                {Math.round(averageAchievementRate)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Performance Insights */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-green-500" />
          Performance Insights
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-gray-900 mb-3">Top Performing Branches</h4>
            <div className="space-y-2">
              {loanTargetMetrics
                .sort((a, b) => b.achievementRate - a.achievementRate)
                .slice(0, 3)
                .map((metrics, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                    <span className="font-medium text-gray-900">{metrics.branchName}</span>
                    <StatusBadge value={metrics.achievementRate} type="achievement" />
                  </div>
                ))}
            </div>
          </div>
          
          <div>
            <h4 className="font-medium text-gray-900 mb-3">Branches Needing Attention</h4>
            <div className="space-y-2">
              {loanTargetMetrics
                .filter(m => m.achievementRate < 80 || m.retentionRate < 80)
                .sort((a, b) => a.achievementRate - b.achievementRate)
                .slice(0, 3)
                .map((metrics, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                    <span className="font-medium text-gray-900">{metrics.branchName}</span>
                    <div className="flex gap-2">
                      {metrics.achievementRate < 80 && (
                        <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Low Achievement</span>
                      )}
                      {metrics.retentionRate < 80 && (
                        <span className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">Low Retention</span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoanTargetsCalculator;