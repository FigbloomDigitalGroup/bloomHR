import { describe, expect, it } from 'vitest';
import {
  BANK_HEADERS, MPESA_HEADERS, NSSF_HEADERS, P10_HEADERS, SHA_HEADERS,
  bankFile, equityFile, localBankCode, lastDayOf, mpesaFile, mpesaPhone, nitaFile, nssfFile, p10Figures, p10File, remittanceTotals, shaFile, toCsv,
} from './payrollExports';

const rates = {
  pension_deduction_cap: 30000, prmf_deduction_cap: 15000, mortgage_interest_cap: 30000,
  insurance_relief_rate: 0.15, insurance_relief_cap: 5000, shif_deductible: 1, ahl_deductible: 1,
};

const amina = {
  'Employee Number': 'E1', 'Payroll Number': 'PR-00001', 'First Name': 'Amina', 'Middle Name': 'Njeri', 'Last Name': 'Wanjiru',
  'Type of Identification': 'National ID', 'ID Number': '28123456', 'Tax PIN': 'A012345678Z', 'SHIF Number': 'CR1234567',
  'NSSF Number': '2012345678', 'Mobile Number': '0712345678', kra_residency: 'Resident', kra_employee_type: 'Primary Employee',
  is_pwd: false, car_benefit: 5000, housing_benefit: 10000, other_pension_contribution: 40000, mortgage_interest: 20000,
  insurance_premium: 50000, nssf_voluntary_contribution: 1000, payment_method: 'Bank Transfer', Bank: 'KCB', bank_code: '01',
  'Bank Branch': 'Moi Avenue', branch_code: '091', account_number_name: 'Amina Wanjiru', 'Account Number': '1234567890',
};
const juma = {
  'Employee Number': 'E2', 'Payroll Number': 'PR-00002', 'First Name': 'Juma', 'Last Name': 'Otieno', 'Tax PIN': '',
  'NSSF Number': '', 'Mobile Number': '0722 000 111', payment_method: 'M-Pesa', is_pwd: true,
};
const payslip = (employee_id: string, extra: Record<string, unknown> = {}) => ({
  employee_id, employee_name: employee_id, gross_pay: 200000, nhif_deduction: 5500, nssf_deduction: 4320, housing_levy: 3000,
  tax_relief: 2400, paye_tax: 40000, net_pay: 140000, ...extra,
});

describe('toCsv', () => {
  it('writes a header row and quotes only what needs quoting', () => {
    expect(toCsv(['A', 'B'], [['plain', 'with, comma'], ['say "hi"', 'two\nlines']])).toBe('A,B\r\nplain,"with, comma"\r\n"say ""hi""","two\nlines"\r\n');
  });

  it('keeps a value a spreadsheet would run as a formula as text', () => {
    expect(toCsv(['A'], [['=1+1'], ['@cmd']])).toBe("A\r\n'=1+1\r\n'@cmd\r\n");
  });
});

describe('KRA P10', () => {
  it('has the iTax columns, in order', () => {
    expect(P10_HEADERS).toHaveLength(24);
    // finance's own spellings
    expect(toCsv(P10_HEADERS, []).trim()).toBe(
      'Employee pin,Employee name,Resident,Type of Employee,PWD,Exemption certificate No,Total cash pay,Value of Car benefit,' +
      'Value of meals,Non cash,Housing benefit,Other benefits,Total gross pay,Social health insuarance fund,NSSF,' +
      'other pension contribution,Post retirement medical fund,Mortgage Intrest,AHL,Taxable pay,Personal relief,' +
      'Insuarance relief,Paye,Self assessed paye');
  });

  it('adds benefits to cash pay, and takes capped pension and mortgage interest, NSSF, SHIF and AHL off taxable pay', () => {
    const f = p10Figures(payslip('E1'), amina, rates);
    expect(f.totalGross).toBe(215000);
    expect(f.pension).toBe(30000); // capped
    expect(f.mortgage).toBe(20000);
    expect(f.taxablePay).toBe(215000 - 4320 - 30000 - 20000 - 5500 - 3000);
    expect(f.insuranceRelief).toBe(5000); // 15% of 50,000 is 7,500, capped at 5,000
  });

  it('does not take off SHIF or AHL in months when they were not deductible', () => {
    const f = p10Figures(payslip('E1'), amina, { ...rates, shif_deductible: 0, ahl_deductible: 0 });
    expect(f.taxablePay).toBe(215000 - 4320 - 30000 - 20000);
  });

  it('writes one row per payslip from the record and the payslip', () => {
    const file = p10File([payslip('E1')], [amina], rates);
    const [row] = file.rows;
    expect(row.slice(0, 7)).toEqual(['A012345678Z', 'Amina Njeri Wanjiru', 'Resident', 'Primary Employee', 'No', '', '200000.00']);
    expect(row[22]).toBe('40000.00');
    expect(row[23]).toBe('40000.00');
    expect(file.problems).toEqual([]);
  });

  it('lists who is missing what the return needs', () => {
    const file = p10File([payslip('E1'), payslip('E2')], [amina, juma], rates);
    expect(file.problems).toEqual([
      { name: 'Juma Otieno', employeeNumber: 'E2', missing: ['KRA PIN', 'Residency', 'Type of employee', 'Exemption certificate number'] },
    ]);
  });
});

describe('cash pay leaves out the per diem, as payroll and finance’s returns do', () => {
  it('P10 total cash pay and taxable pay, and NSSF gross pay', () => {
    // basic 98,315.46 with a 33% per diem: 65,870.76 is what SHIF, NSSF, AHL and PAYE are worked on (Ian Duncan, Sept 2026)
    const slip = payslip('E1', { gross_pay: 98315.46, per_diem: 32444.7, nhif_deduction: 1811.45, nssf_deduction: 3952.25, housing_levy: 988.06, paye_tax: 10119.05 });
    const e = { ...amina, car_benefit: 0, housing_benefit: 0, other_pension_contribution: 0, mortgage_interest: 0, insurance_premium: 0 };
    const f = p10Figures(slip, e, { ...rates, personal_relief: 2400 });
    expect(f.cashPay).toBeCloseTo(65870.76, 2);
    expect(f.taxablePay).toBeCloseTo(59119, 2);
    expect(f.personalRelief).toBe(2400);
    expect(nssfFile([slip], [e]).rows[0][6]).toBe('65870.76');
  });
});

describe('SHIF (SHA) and NSSF', () => {
  it('SHIF: the employee number (not the payroll number), names apart, identity, numbers, the contribution and phone', () => {
    const file = shaFile([payslip('E1')], [amina]);
    expect(file.headers).toBe(SHA_HEADERS);
    expect(file.headers[0]).toBe('EMPLOYEE NUMBER');
    expect(file.rows).toEqual([['E1', 'Amina', 'Wanjiru', 'National ID', '28123456', 'A012345678Z', 'CR1234567', '5500.00', '0712345678']]);
  });

  it('SHA: an older record keeps its health number in NHIF Number', () => {
    const file = shaFile([payslip('E1')], [{ ...amina, 'SHIF Number': '', 'NHIF Number': 'NH-77' }]);
    expect(file.rows[0][6]).toBe('NH-77');
    expect(file.problems).toEqual([]);
  });

  it('NSSF: surname, other names, gross pay and the voluntary contribution', () => {
    const file = nssfFile([payslip('E1')], [amina]);
    expect(file.headers).toBe(NSSF_HEADERS);
    expect(file.rows).toEqual([['E1', 'Wanjiru', 'Amina Njeri', '28123456', 'A012345678Z', '2012345678', '200000.00', '1000.00']]);
  });

  it('NSSF: lists missing numbers', () => {
    expect(nssfFile([payslip('E2')], [juma]).problems[0].missing).toEqual(['ID number', 'KRA PIN', 'NSSF number']);
  });
});

describe('bulk payment files', () => {
  it('M-Pesa: only staff paid by M-Pesa, phone as 2547…, net pay', () => {
    const file = mpesaFile([payslip('E1'), payslip('E2', { net_pay: 30000 })], [amina, juma], '2026-10');
    expect(file.headers).toBe(MPESA_HEADERS);
    expect(file.rows).toEqual([['254722000111', 'Juma Otieno', '30000.00', 'Salary 2026-10', 'PR-00002']]);
  });

  it('bank: only staff paid by bank, with bank and branch codes', () => {
    const file = bankFile([payslip('E1'), payslip('E2')], [amina, juma], '2026-10');
    expect(file.headers).toBe(BANK_HEADERS);
    expect(file.rows).toEqual([['PR-00001', 'Amina Njeri Wanjiru', 'KCB', '01', 'Moi Avenue', '091', 'Amina Wanjiru', '1234567890', '140000.00', 'Salary 2026-10']]);
  });

  it('uses the method saved on the payslip, and leaves out nothing-to-pay and cash', () => {
    const file = mpesaFile([payslip('E1', { payment_method: 'MPESA' }), payslip('E2', { net_pay: 0 })], [amina, juma], '2026-10');
    expect(file.rows.map((r) => r[4])).toEqual(['PR-00001']);
    expect(bankFile([payslip('E1', { payment_method: 'Cash' })], [amina], '2026-10').rows).toEqual([]);
  });

  it('M-Pesa Kenya: only KES payslips; TZS, UGX and USD ones are left out with a note', () => {
    const others = [
      { ...juma, 'Employee Number': 'T1' },
      { ...juma, 'Employee Number': 'U1' },
      { ...juma, 'Employee Number': 'D1' },
    ];
    const file = mpesaFile(
      [payslip('E2', { net_pay: 30000 }), payslip('T1', { currency: 'TZS' }), payslip('U1', { currency: 'UGX' }), payslip('D1', { currency: 'USD' })],
      [juma, ...others],
      '2026-10'
    );
    expect(file.rows.map((r) => r[2])).toEqual(['30000.00']);
    expect(file.note).toBe("3 payslips in TZS/UGX/USD aren't paid through M-Pesa Kenya. Use the bank or mobile money file for their currency.");
    // KES and old payslips with no currency are paid as before, with no note
    const kes = mpesaFile([payslip('E2', { currency: 'KES' }), payslip('E2', { currency: null })], [juma], '2026-10');
    expect(kes.rows).toHaveLength(2);
    expect(kes).not.toHaveProperty('note');
  });

  it('Equity Eazzy Biz: only KES payslips, with a note on the M-Pesa ones left out', () => {
    const file = equityFile([payslip('E1'), payslip('E2', { currency: 'TZS' })], [amina, juma], '1234567890');
    expect(file.rows).toHaveLength(1);
    expect(file.rows[0][3]).toBe('Amina Wanjiru');
    expect(file.note).toBe("1 payslip in TZS isn't paid through M-Pesa Kenya. Use the bank or mobile money file for its currency.");
  });

  it('flags a missing M-Pesa number or bank account', () => {
    expect(mpesaFile([payslip('E2')], [{ ...juma, 'Mobile Number': '12' }], '2026-10').problems[0].missing).toEqual(['M-Pesa number']);
    expect(bankFile([payslip('E1')], [{ ...amina, 'Account Number': '' }], '2026-10').problems[0].missing).toEqual(['Account number']);
  });
});

describe('helpers', () => {
  it('mpesaPhone accepts the usual Kenyan forms only', () => {
    expect(['0712345678', '712345678', '+254712345678', '0112345678'].map(mpesaPhone)).toEqual(['254712345678', '254712345678', '254712345678', '254112345678']);
    expect(['', '0812345678', '+447911123456'].map(mpesaPhone)).toEqual(['', '', '']);
  });

  it('lastDayOf gives the month’s last day', () => {
    expect(lastDayOf('2026-02')).toBe('2026-02-28');
    expect(lastDayOf('2024-02')).toBe('2024-02-29');
    expect(lastDayOf('2026-12')).toBe('2026-12-31');
  });
});

describe('Equity Bank Eazzy Biz file', () => {
  const coop = { ...amina, 'Employee Number': 'E3', Bank: 'Co-operative Bank', bank_code: '11', branch_code: '002', account_number_name: 'Amina N Wanjiru' };
  const equity = { ...amina, 'Employee Number': 'E4', 'First Name': 'Esther', 'Last Name': 'Nalenyi', Bank: 'Equity Bank', bank_code: '', branch_code: '', account_number_name: '' , 'Account Number': '0180291234567' };
  const slips = [payslip('E2', { net_pay: 30000 }), payslip('E3', { net_pay: 1250000.5 }), payslip('E4', { net_pay: 20000 }), payslip('E1', { net_pay: 0 })];

  it('has the template’s header row, trailing empty column included', () => {
    expect(toCsv(equityFile([], [], '0123456789').headers, []).trim()).toBe(
      'Transaction Type Code,Debit Account No.,Beneficiary Account No.,Beneficiary Name,Beneficiary Bank Swift Code / Local Bank Code,' +
      'Purpose Code,Transaction Currency,Payment Amount,Payment Type,Service Provider,Beneficiary Mobile No,');
  });

  it('M-Pesa as MW, Equity accounts as BT, other banks as LBT, all from the company’s account; nothing to pay is left out', () => {
    const file = equityFile(slips, [amina, juma, coop, equity], '0123456789');
    expect(file.rows).toEqual([
      ['MW', '0123456789', '', 'Juma Otieno', '', 'SAL', 'KES', '30,000.00', '', 'MPESA', '0722000111', ''],
      ['LBT', '0123456789', '1234567890', 'Amina N Wanjiru', '11002', 'SAL', 'KES', '1,250,000.50', 'RTGS', '', '', ''],
      ['BT', '0123456789', '0180291234567', 'Esther Njeri Nalenyi', '68000', 'SAL', 'KES', '20,000.00', '', '', '', ''],
    ]);
    // the M-Pesa row as it appears in the file (first row after the header)
    expect(toCsv(file.headers, file.rows).split('\r\n')[1]).toBe('MW,0123456789,,Juma Otieno,,SAL,KES,"30,000.00",,MPESA,0722000111,');
  });

  it('pays smaller amounts to other banks by EFT', () => {
    expect(equityFile([payslip('E3', { net_pay: 50000 })], [coop], '0123456789').rows[0][8]).toBe('EFT');
  });

  it('leaves out staff paid in cash', () => {
    expect(equityFile([payslip('E1', { payment_method: 'Cash' })], [amina], '1').rows).toEqual([]);
  });

  it('flags another bank without its 5-digit code, a missing account, or a missing M-Pesa number', () => {
    const file = equityFile(
      [payslip('E3'), payslip('E2')],
      [{ ...coop, branch_code: '' }, { ...juma, 'Mobile Number': '' }],
      '0123456789'
    );
    expect(file.problems.map((p) => p.missing)).toEqual([['Bank and branch code (5 digits)'], ['M-Pesa number']]);
  });

  it('localBankCode joins the 2-digit bank and 3-digit branch, or takes a full 5-digit branch code', () => {
    expect(localBankCode({ bank_code: '11', branch_code: '002' })).toBe('11002');
    expect(localBankCode({ bank_code: '', branch_code: '68000' })).toBe('68000');
    expect(localBankCode({ bank_code: '1', branch_code: '2' })).toBe('');
  });
});

describe('NITA levy and the month\'s amounts to pay (FIG-898)', () => {
  const payslips = [
    { employee_id: 'E1', employee_name: 'Amina', paye_tax: 6000, nhif_deduction: 1375, nssf_deduction: 3000, housing_levy: 750, nita_levy: 50 },
    { employee_id: 'C1', employee_name: 'Carl', paye_tax: 0, nhif_deduction: 0, nssf_deduction: 0, housing_levy: 0, nita_levy: 0 },
  ];
  const employees = [{ 'Employee Number': 'E1', 'Payroll Number': 'PR-1', 'First Name': 'Amina', 'Last Name': 'W', 'ID Number': '12345678', 'Tax PIN': 'A012345678Z', NITA: 'N-77' }];

  it('the NITA file lists only payslips with a levy', () => {
    const f = nitaFile(payslips, employees as never);
    expect(f.rows).toEqual([['E1', 'Amina W', '12345678', 'A012345678Z', 'N-77', '50.00']]);
  });

  it('totals PAYE, SHIF, both shares of NSSF and the housing levy, and the employer\'s NITA levy', () => {
    expect(remittanceTotals(payslips, { nssf_rate: 0.06, nssf_employer_rate: 0.06, ahl_rate: 0.015, ahl_employer_rate: 0.015 })).toEqual({
      paye: 6000, shif: 1375, nssf: { employee: 3000, employer: 3000 }, ahl: { employee: 750, employer: 750 }, nita: { total: 50, employees: 1 },
    });
  });
});
