import React from 'react';
import { Download, Printer, Share2, X, ArrowLeft, ArrowRight, Shield, Award, Building2 } from 'lucide-react';
import  GlowButton  from '../UI/GlowButton';

interface PayslipModalProps {
  record: any;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const PayslipModal: React.FC<PayslipModalProps> = ({ record, onClose, onPrevious, onNext }) => {
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Payslip - ${record.employee_name}</title>
            <style>
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
              
              * { margin: 0; padding: 0; box-sizing: border-box; }
              
              body { 
                font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
                line-height: 1.5;
                color: #1f2937; 
                background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
                -webkit-font-smoothing: antialiased;
                -moz-osx-font-smoothing: grayscale;
              }
              
              .payslip-container { 
                max-width: 900px; 
                margin: 40px auto; 
                background: white;
                border-radius: 24px;
                overflow: hidden;
                box-shadow: 
                  0 32px 64px -12px rgba(0, 0, 0, 0.25),
                  0 0 0 1px rgba(255, 255, 255, 0.05);
                position: relative;
              }
              
              .payslip-container::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 8px;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4, #10b981);
                background-size: 400% 400%;
                animation: gradient 8s ease infinite;
              }
              
              @keyframes gradient {
                0%, 100% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
              }
              
              .header { 
                background: linear-gradient(135deg, #0f172a 0%, #1e293b 25%, #334155 100%);
                color: white; 
                padding: 48px 48px 56px;
                text-align: center;
                position: relative;
                overflow: hidden;
              }
              
              .header::before {
                content: '';
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: 
                  radial-gradient(circle at 30% 20%, rgba(59, 130, 246, 0.15) 0%, transparent 50%),
                  radial-gradient(circle at 70% 80%, rgba(139, 92, 246, 0.15) 0%, transparent 50%);
                animation: float 20s ease-in-out infinite;
              }
              
              @keyframes float {
                0%, 100% { transform: translate(0px, 0px) rotate(0deg); }
                33% { transform: translate(30px, -30px) rotate(120deg); }
                66% { transform: translate(-20px, 20px) rotate(240deg); }
              }
              
              .company-logo {
                width: 72px;
                height: 72px;
                background: linear-gradient(135deg, #3b82f6, #8b5cf6);
                border-radius: 20px;
                margin: 0 auto 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                z-index: 2;
                box-shadow: 0 20px 40px rgba(59, 130, 246, 0.3);
              }
              
              .company-name { 
                font-size: 32px; 
                font-weight: 800; 
                letter-spacing: -0.5px; 
                margin-bottom: 8px;
                position: relative;
                z-index: 2;
                background: linear-gradient(135deg, #ffffff 0%, #e2e8f0 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                text-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
              }
              
              .company-slogan { 
                font-weight: 400; 
                font-size: 16px; 
                opacity: 0.9; 
                margin-bottom: 32px;
                position: relative;
                z-index: 2;
                letter-spacing: 0.5px;
              }
              
              .payslip-title { 
                font-size: 28px; 
                font-weight: 700; 
                margin: 20px 0 16px;
                position: relative;
                z-index: 2;
                letter-spacing: 1px;
              }
              
              .pay-period { 
                font-size: 18px; 
                font-weight: 500;
                position: relative;
                z-index: 2;
                opacity: 0.95;
              }
              
              .employee-section {
                padding: 48px;
                background: linear-gradient(135deg, #f8fafc 0%, #ffffff 100%);
                border-bottom: 1px solid #e2e8f0;
              }
              
              .employee-grid { 
                display: grid; 
                grid-template-columns: 1fr 1fr 1fr; 
                gap: 40px;
              }
              
              .employee-card {
                background: white;
                padding: 32px;
                border-radius: 20px;
                box-shadow: 
                  0 10px 25px -5px rgba(0, 0, 0, 0.08),
                  0 8px 10px -6px rgba(0, 0, 0, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1);
                position: relative;
                overflow: hidden;
                transition: transform 0.2s ease, box-shadow 0.2s ease;
              }
              
              .employee-card::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6);
              }
              
              .card-icon {
                width: 48px;
                height: 48px;
                background: linear-gradient(135deg, #dbeafe, #ede9fe);
                border-radius: 16px;
                margin-bottom: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              
              .card-title { 
                font-size: 14px; 
                color: #6b7280; 
                text-transform: uppercase; 
                letter-spacing: 1px;
                font-weight: 600;
                margin-bottom: 16px;
              }
              
              .card-content {
                display: flex;
                flex-direction: column;
                gap: 8px;
              }
              
              .card-value { 
                font-size: 16px; 
                font-weight: 600;
                color: #111827;
                line-height: 1.4;
              }
              
              .section { 
                padding: 48px; 
                margin: 0;
              }
              
              .section:nth-child(odd) {
                background: linear-gradient(135deg, #fafbfc 0%, #ffffff 100%);
              }
              
              .section-header {
                display: flex;
                align-items: center;
                margin-bottom: 32px;
                padding-bottom: 20px;
                border-bottom: 3px solid #e2e8f0;
                position: relative;
              }
              
              .section-header::after {
                content: '';
                position: absolute;
                bottom: -3px;
                left: 0;
                width: 60px;
                height: 3px;
                background: linear-gradient(90deg, #3b82f6, #8b5cf6);
                border-radius: 2px;
              }
              
              .section-icon {
                width: 32px;
                height: 32px;
                background: linear-gradient(135deg, #dbeafe, #ede9fe);
                border-radius: 12px;
                margin-right: 16px;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              
              .section-title { 
                font-size: 24px; 
                font-weight: 700; 
                color: #111827;
                letter-spacing: -0.25px;
              }
              
              .premium-table { 
                width: 100%; 
                border-collapse: separate;
                border-spacing: 0;
                background: white;
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 
                  0 4px 6px -1px rgba(0, 0, 0, 0.05),
                  0 2px 4px -1px rgba(0, 0, 0, 0.03);
              }
              
              .premium-table thead tr {
                background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
              }
              
              .premium-table th { 
                text-align: left; 
                padding: 20px 24px; 
                color: #374151; 
                font-weight: 700; 
                font-size: 14px; 
                text-transform: uppercase; 
                letter-spacing: 0.75px;
                border-bottom: 2px solid #e5e7eb;
              }
              
              .premium-table td { 
                padding: 20px 24px; 
                border-bottom: 1px solid #f3f4f6; 
                font-size: 15px;
                font-weight: 500;
                transition: background-color 0.15s ease;
              }
              
              .premium-table tbody tr:hover {
                background-color: #f9fafb;
              }
              
              .amount { 
                text-align: right; 
                font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
                font-weight: 600;
                color: #059669;
              }
              
              .deduction-amount {
                color: #dc2626;
              }
              
              .total-row {
                background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%) !important;
                border-top: 2px solid #0ea5e9;
              }
              
              .total-row td { 
                font-weight: 800; 
                font-size: 16px;
                color: #0c4a6e;
              }
              
              .net-pay-section { 
                background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); 
                margin: 48px;
                padding: 40px; 
                border-radius: 24px;
                text-align: center;
                position: relative;
                overflow: hidden;
                box-shadow: 
                  0 20px 25px -5px rgba(5, 150, 105, 0.1),
                  0 10px 10px -5px rgba(5, 150, 105, 0.04);
              }
              
              .net-pay-section::before {
                content: '';
                position: absolute;
                top: -50%;
                left: -50%;
                width: 200%;
                height: 200%;
                background: radial-gradient(circle, rgba(16, 185, 129, 0.08) 0%, transparent 70%);
                animation: pulse 4s ease-in-out infinite;
              }
              
              @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
              }
              
              .net-pay-label {
                font-size: 16px;
                font-weight: 600;
                color: #065f46;
                margin-bottom: 12px;
                letter-spacing: 2px;
                text-transform: uppercase;
                position: relative;
                z-index: 2;
              }
              
              .net-pay-value { 
                font-size: 48px; 
                font-weight: 900; 
                color: #064e3b;
                font-family: 'SF Mono', 'Monaco', 'Cascadia Code', monospace;
                position: relative;
                z-index: 2;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
              }
              
              .signature-section { 
                display: grid; 
                grid-template-columns: 1fr 1fr; 
                gap: 60px; 
                margin: 60px 48px 48px;
              }
              
              .signature-block { 
                display: flex; 
                flex-direction: column; 
                align-items: center; 
                text-align: center;
              }
              
              .signature-line { 
                width: 240px; 
                height: 2px; 
                background: linear-gradient(90deg, #e5e7eb, #9ca3af, #e5e7eb);
                margin-top: 60px; 
                position: relative;
                border-radius: 1px;
              }
              
              .signature-line::after { 
                content: ''; 
                position: absolute; 
                width: 80px; 
                height: 3px; 
                background: linear-gradient(90deg, #3b82f6, #8b5cf6);
                left: 50%; 
                transform: translateX(-50%);
                top: -1px;
                border-radius: 2px;
              }
              
              .signature-label { 
                margin-top: 16px; 
                font-size: 14px; 
                color: #6b7280;
                font-weight: 500;
                letter-spacing: 0.25px;
              }
              
              .footer { 
                padding: 40px 48px; 
                text-align: center; 
                font-size: 13px; 
                color: #9ca3af; 
                border-top: 1px solid #e5e7eb;
                background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
                line-height: 1.6;
              }
              
              .footer-content {
                max-width: 600px;
                margin: 0 auto;
              }
              
              .watermark { 
                position: absolute; 
                opacity: 0.03; 
                font-size: 180px; 
                font-weight: 900; 
                color: #1f2937;
                transform: rotate(-30deg); 
                z-index: 1; 
                pointer-events: none;
                font-family: 'Inter', sans-serif;
                letter-spacing: -4px;
              }
              
              .security-features {
                position: absolute;
                top: 20px;
                right: 20px;
                display: flex;
                gap: 8px;
                z-index: 10;
              }
              
              .security-badge {
                width: 32px;
                height: 32px;
                background: rgba(255, 255, 255, 0.9);
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.2);
              }
              
              @media print {
                body { padding: 0; background: none; }
                .no-print { display: none !important; }
                .payslip-container { 
                  box-shadow: none; 
                  margin: 0; 
                  border-radius: 0;
                }
                .security-features { display: none; }
              }
            </style>
          </head>
          <body>
            ${document.getElementById('payslip-content')?.innerHTML}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 500);
    }
  };

  const handleDownload = () => {
    const htmlContent = document.getElementById('payslip-content')?.innerHTML;
    const blob = new Blob([`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Payslip - ${record.employee_name}</title>
          <style>
            ${/* Include the same styles from handlePrint here */ ''}
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
      </html>
    `], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payslip_${record.employee_id}_${record.pay_period}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    try {
      const htmlContent = document.getElementById('payslip-content')?.innerHTML;
      const blob = new Blob([htmlContent || ''], { type: 'text/html' });
      const file = new File([blob], `payslip_${record.employee_id}.html`, { type: 'text/html' });
      
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Payslip - ${record.employee_name}`,
          text: `Payslip for ${record.employee_name} (${record.pay_period})`,
          files: [file]
        });
      } else {
        const text = `Payslip for ${record.employee_name}\n\n` +
          `Employee ID: ${record.employee_id}\n` +
          `Period: ${record.pay_period}\n` +
          `Gross Pay: KSh ${record.gross_pay.toLocaleString()}\n` +
          `Net Pay: KSh ${record.net_pay.toLocaleString()}\n\n` +
          `View full payslip in the payroll system.`;
        
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          alert('Payslip information copied to clipboard');
        } else {
          alert('Sharing not supported in this browser');
        }
      }
    } catch (err) {
      console.error('Error sharing:', err);
      alert('Failed to share payslip');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[95vh] overflow-auto">
        {/* Modal Header */}
        <div className="sticky top-0 bg-gradient-to-r from-slate-900 via-blue-900 to-slate-900 p-6 flex justify-between items-center z-10">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Employee Payslip</h2>
              <p className="text-blue-200 text-xs">{record.employee_name} • {record.pay_period}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <GlowButton 
              variant="ghost" 
              icon={Download} 
              size="sm" 
              onClick={handleDownload}
              className="text-white hover:bg-white/10 border border-white/20"
            >
              Download
            </GlowButton>
            <GlowButton 
              variant="ghost" 
              icon={Printer} 
              size="sm" 
              onClick={handlePrint}
              className="text-white hover:bg-white/10 border border-white/20"
            >
              Print
            </GlowButton>
            <GlowButton 
              variant="ghost" 
              icon={Share2} 
              size="sm" 
              onClick={handleShare}
              className="text-white hover:bg-white/10 border border-white/20"
            >
              Share
            </GlowButton>
            <GlowButton 
              variant="ghost" 
              icon={X} 
              size="sm" 
              onClick={onClose}
              className="text-white hover:bg-white/10 border border-white/20"
            >
              Close
            </GlowButton>
          </div>
        </div>

        {/* Payslip Content */}
        <div className="p-0">
          <div id="payslip-content" className="payslip-container">
            <div className="relative overflow-hidden">
              {/* Security Features */}
              <div className="security-features">
                <div className="security-badge">
                  <Shield className="w-4 h-4 text-blue-600" />
                </div>
                <div className="security-badge">
                  <Award className="w-4 h-4 text-green-600" />
                </div>
              </div>

              {/* Watermark */}
              <div className="watermark" style={{ top: '300px', left: '150px' }}>OFFICIAL</div>
              
              {/* Header */}
              <div className="header">
                <div className="company-logo">
                  <Building2 className="w-8 h-8 text-white" />
                </div>
                <div className="company-name">CORPORATE ENTERPRISES LTD</div>
                <div className="company-slogan">Innovation • Excellence • Integrity</div>
                <div className="payslip-title">EMPLOYEE COMPENSATION STATEMENT</div>
                <div className="pay-period">
                  {new Date(record.pay_period + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </div>
              </div>

              {/* Employee Information */}
              <div className="employee-section">
                <div className="employee-grid">
                  <div className="employee-card">
                    <div className="card-icon">
                      <Building2 className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="card-title">Employee Information</div>
                    <div className="card-content">
                      <div className="card-value">{record.employee_name}</div>
                      <div className="card-value">ID: {record.employee_id}</div>
                      <div className="card-value">{record.department} Department</div>
                      <div className="card-value">{record.position}</div>
                    </div>
                  </div>
                  
                  <div className="employee-card">
                    <div className="card-icon">
                      <Award className="w-6 h-6 text-purple-600" />
                    </div>
                    <div className="card-title">Payment Details</div>
                    <div className="card-content">
                      <div className="card-value">{record.payment_method}</div>
                      {record.payment_method === 'Bank Transfer' && (
                        <>
                          <div className="card-value">{record.bank_name}</div>
                          <div className="card-value">A/C: ••••{record.account_number.slice(-4)}</div>
                        </>
                      )}
                      {record.payment_method === 'M-Pesa' && (
                        <div className="card-value">Phone: {record.account_number}</div>
                      )}
                      <div className="card-value">Pay Date: {new Date().toLocaleDateString()}</div>
                    </div>
                  </div>
                  
                  <div className="employee-card">
                    <div className="card-icon">
                      <Shield className="w-6 h-6 text-green-600" />
                    </div>
                    <div className="card-title">Security & Compliance</div>
                    <div className="card-content">
                      <div className="card-value">Document Verified</div>
                      <div className="card-value">Tax Compliant</div>
                      <div className="card-value">Digitally Signed</div>
                      <div className="card-value">Audit Trail: Active</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Earnings Section */}
              <div className="section">
                <div className="section-header">
                  <div className="section-icon">
                    <Award className="w-5 h-5 text-green-600" />
                  </div>
                  <div className="section-title">Earnings & Compensation</div>
                </div>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th style={{textAlign: 'right'}}>Amount (KSh)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Basic Salary</td>
                      <td className="amount">{record.basic_salary.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>House Allowance</td>
                      <td className="amount">{record.house_allowance.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Transport Allowance</td>
                      <td className="amount">{record.transport_allowance.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Medical Allowance</td>
                      <td className="amount">{record.medical_allowance.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Other Allowances</td>
                      <td className="amount">{record.other_allowances.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Overtime ({record.overtime_hours} hrs @ {record.overtime_rate}/hr)</td>
                      <td className="amount">{(record.overtime_hours * record.overtime_rate).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Performance Commission</td>
                      <td className="amount">{record.commission.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Bonus & Incentives</td>
                      <td className="amount">{record.bonus.toLocaleString()}</td>
                    </tr>
                    <tr className="total-row">
                      <td><strong>Total Gross Earnings</strong></td>
                      <td className="amount"><strong>{record.gross_pay.toLocaleString()}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Deductions Section */}
              <div className="section">
                <div className="section-header">
                  <div className="section-icon">
                    <Shield className="w-5 h-5 text-red-600" />
                  </div>
                  <div className="section-title">Statutory & Other Deductions</div>
                </div>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th style={{textAlign: 'right'}}>Amount (KSh)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>PAYE Tax</td>
                      <td className="amount deduction-amount">{Math.round(record.paye_tax).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>NHIF Contribution</td>
                      <td className="amount deduction-amount">{record.nhif_deduction.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>NSSF Contribution</td>
                      <td className="amount deduction-amount">{record.nssf_deduction.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Housing Development Levy</td>
                      <td className="amount deduction-amount">{record.housing_levy.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Staff Loan Repayment</td>
                      <td className="amount deduction-amount">{record.loan_deduction.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Salary Advance Recovery</td>
                      <td className="amount deduction-amount">{record.advance_deduction.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Welfare Fund Contribution</td>
                      <td className="amount deduction-amount">{record.welfare_deduction.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td>Other Deductions</td>
                      <td className="amount deduction-amount">{record.other_deductions.toLocaleString()}</td>
                    </tr>
                    <tr className="total-row">
                      <td><strong>Total Deductions</strong></td>
                      <td className="amount deduction-amount"><strong>{record.total_deductions.toLocaleString()}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Net Pay Section */}
              <div className="net-pay-section">
                <div className="net-pay-label">Net Pay</div>
                <div className="net-pay-value">KSh {Math.round(record.net_pay).toLocaleString()}</div>
              </div>

              {/* Signature Section */}
              <div className="signature-section">
                <div className="signature-block">
                  <div className="signature-line"></div>
                  <div className="signature-label">Employee Acknowledgment</div>
                </div>
                <div className="signature-block">
                  <div className="signature-line"></div>
                  <div className="signature-label">HR Director Authorization</div>
                </div>
              </div>

              {/* Footer */}
              <div className="footer">
                <div className="footer-content">
                  <div style={{ marginBottom: '12px', fontWeight: '600' }}>
                    This is a computer-generated payslip and does not require a physical signature
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    Generated on {new Date().toLocaleDateString('en-US', { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })} at {new Date().toLocaleTimeString('en-US', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                  </div>
                  <div style={{ marginBottom: '16px' }}>
                    Document ID: PAY-{record.employee_id}-{record.pay_period}-{Date.now().toString().slice(-6)}
                  </div>
                  <div style={{ fontSize: '12px', opacity: '0.8' }}>
                    © 2024 Corporate Enterprises Ltd. All rights reserved. | 
                    Confidential and Proprietary Information | 
                    For authorized personnel only
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        {(onPrevious || onNext) && (
          <div className="sticky bottom-0 bg-gradient-to-r from-slate-50 to-blue-50 p-6 border-t border-gray-200 flex justify-between items-center">
            {onPrevious ? (
              <GlowButton 
                variant="outline" 
                icon={ArrowLeft} 
                onClick={onPrevious}
                className="border-blue-600 text-blue-600 hover:bg-blue-50 shadow-lg"
              >
                Previous Employee
              </GlowButton>
            ) : <div></div>}
            
            {onNext && (
              <GlowButton 
                variant="outline" 
                icon={ArrowRight} 
                onClick={onNext} 
                className="border-blue-600 text-blue-600 hover:bg-blue-50 shadow-lg"
              >
                Next Employee
              </GlowButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PayslipModal;