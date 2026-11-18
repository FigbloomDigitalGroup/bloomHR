import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { formatKsh, interestMethodLabel, rateText, type LoanInstalment } from '../../lib/loans';
import { CHECKLIST, employmentBox, formDate, keyFacts, loanReference, type LoanForm, type LoanGuarantor } from '../../lib/loanForm';
import type { LoanFormContext } from '../../lib/loanFormApi';
import type { EmployeeLoan } from '../../lib/loansApi';

// The loan agreement form as one A4 document, in the lender's order: application (A, B), key facts statement and
// repayment schedule (C, D), the guarantor's details, undertakings and signature, the terms, the salary deduction
// authority with the employer undertaking, the borrower's declaration with the witness, "For Official Use" (approval
// and payout) and the checklist. It is filled in from the loan, and carries the signatures put on it in the app: the
// borrower's, the guarantor's and the approver's saved signatures, the HR officer's who accepted the form (employer
// undertaking), and the witness's drawn on the screen. Only the stamps are left to the paper copy. Inline styles, so
// the PDF looks the same anywhere. For the guarantor, the borrower's personal details come in empty.

const INK = '#111827';
const MUTED = '#4b5563';
const RULE = '#1f2937';

const page: CSSProperties = { width: 794 - 96, margin: '0 auto', color: INK, fontFamily: '"Times New Roman", Times, serif', fontSize: 12.5, lineHeight: 1.35, background: '#fff' };
const table: CSSProperties = { width: '100%', borderCollapse: 'collapse', marginBottom: 14 };
const cell: CSSProperties = { border: `1px solid ${RULE}`, padding: '5px 7px', verticalAlign: 'top', width: '50%' };
const label: CSSProperties = { color: INK };
const value: CSSProperties = { display: 'block', marginTop: 2, fontWeight: 600, minHeight: 15 };
const h2: CSSProperties = { fontSize: 13.5, fontWeight: 700, margin: '14px 0 4px', textTransform: 'uppercase' };
const note: CSSProperties = { fontStyle: 'italic', margin: '0 0 6px', fontSize: 12 };
const clause: CSSProperties = { margin: '0 0 7px', textAlign: 'justify' };
const pageBreak: CSSProperties = { pageBreakBefore: 'always', breakBefore: 'page' };

const Box = ({ on, children }: { on: boolean; children: ReactNode }) => (
  <span style={{ marginRight: 10, whiteSpace: 'nowrap' }}>
    {on ? '☑' : '☐'} {children}
  </span>
);

const Field = ({ name, children }: { name: ReactNode; children?: ReactNode }) => (
  <td style={cell}>
    <span style={label}>{name}</span>
    <span style={value}>{children}</span>
  </td>
);

const Signature = ({ src, alt }: { src: string | null | undefined; alt: string }) =>
  src ? <img src={src} alt={alt} style={{ display: 'block', height: 44, maxWidth: 220, objectFit: 'contain', marginTop: 2 }} /> : <span style={{ display: 'block', height: 44 }} />;

const blankDate = '____ / ____ / 20____';
const money = (n: number | null | undefined) => (n === null || n === undefined ? '' : formatKsh(n));
const day = (d: Date | string | null | undefined) => formDate(d) || blankDate;

export interface LoanAgreementDocumentProps {
  loan: EmployeeLoan;
  form: LoanForm | null;
  context: LoanFormContext;
  /** the loan's schedule (from the database once approved; worked out for a request) */
  schedule: LoanInstalment[];
  /** the borrower had a loan paid out before this one */
  renewal?: boolean;
  /** the colleague guaranteeing it, once asked */
  guarantor?: LoanGuarantor | null;
}

const LoanAgreementDocument = forwardRef<HTMLDivElement, LoanAgreementDocumentProps>(function LoanAgreementDocument(
  { loan, form, context, schedule, renewal = false, guarantor = null },
  ref
) {
  const { lender, borrower, settings, latestPay, payout } = context;
  const facts = keyFacts(loan, schedule);
  const approved = ['approved', 'disbursed', 'repaying', 'completed'].includes(loan.status);
  const upfront = loan.interest_method === 'upfront';
  const late = settings.late_charge_percent;
  const box = employmentBox(borrower.employmentType);
  const reference = loanReference(loan.id);
  const borrowerSignedOn = form?.borrower_signed_at ?? null;
  const lenderContact = [lender.postalAddress, lender.phone && `Tel: ${lender.phone}`, lender.email].filter(Boolean).join(' | ');
  const complaints = [lender.complaintsEmail && `by email to ${lender.complaintsEmail}`, lender.phone && `telephone ${lender.phone}`].filter(Boolean).join(', ');
  const L = lender.name;
  // fixed terms: the lender's tick boxes ("Up to 3 months", "20% (up to 3 months)"), the loan's term ticked
  const terms = settings.term_rates ?? [];
  const termBoxes = terms.map((t) => (
    <Box key={t.months} on={t.months === loan.months}>
      Up to {t.months} months
    </Box>
  ));
  const rateBoxes = terms.map((t) => (
    <Box key={t.months} on={t.months === loan.months}>
      {t.rate}% (up to {t.months} months)
    </Box>
  ));
  const g = guarantor && guarantor.status !== 'declined' ? guarantor : null;
  const dots = (v: string | null | undefined, width = 160) => (
    <span style={{ display: 'inline-block', minWidth: width, borderBottom: '1px dotted #6b7280', fontWeight: 600, marginRight: 10 }}>{v || '\u00a0'}</span>
  );

  return (
    <div ref={ref} style={page} data-testid="loan-agreement">
      {/* heading */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        {lender.logoUrl && <img src={lender.logoUrl} alt="" crossOrigin="anonymous" style={{ height: 48, objectFit: 'contain', marginBottom: 6 }} />}
        <div style={{ fontWeight: 700, fontSize: 15, textTransform: 'uppercase' }}>{L}</div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>CHECK OFF LOAN APPLICATION</div>
        {lender.licence && <div style={{ fontWeight: 700, color: MUTED, textTransform: 'uppercase' }}>{lender.licence}</div>}
        {lender.address && <div>{lender.address}</div>}
        {lenderContact && <div>{lenderContact}</div>}
      </div>

      <table style={table}>
        <tbody>
          <tr>
            <Field name={<strong>Agreement / Application Reference:</strong>}>{reference}</Field>
            <Field name={<strong>Date:</strong>}>{formDate(loan.created_at)}</Field>
          </tr>
          <tr>
            <Field name="Branch / Loan Officer:">{[borrower.workstation, form?.approver_name].filter(Boolean).join(' / ')}</Field>
            <td style={cell}>
              Application Status: <Box on={!renewal}>New</Box>
              <Box on={renewal}>Renewal</Box>
              <Box on={false}>Other</Box>
            </td>
          </tr>
        </tbody>
      </table>

      <div style={h2}>A. Borrower / Applicant details</div>
      <table style={table}>
        <tbody>
          <tr>
            <Field name="Full name (as shown on ID)">{borrower.fullName}</Field>
            <Field name="National ID / Passport number:">{borrower.idNumber}</Field>
          </tr>
          <tr>
            <Field name="KRA PIN">{borrower.kraPin}</Field>
            <Field name="Date of birth">{formDate(borrower.dateOfBirth)}</Field>
          </tr>
          <tr>
            <Field name="Mobile number (registered M-Pesa line)">{borrower.mobile}</Field>
            <Field name="Email address">{borrower.email}</Field>
          </tr>
          <tr>
            <Field name="Residential address">{loan.residential_address}</Field>
            <Field name="County / Town">{borrower.town}</Field>
          </tr>
          <tr>
            <Field name="Employer name:">{borrower.employer}</Field>
            <Field name="Workstation / Department">{borrower.workstation}</Field>
          </tr>
          <tr>
            <Field name="Job title">{borrower.jobTitle}</Field>
            <Field name="Employee / Payroll number">{[borrower.employeeNumber, borrower.payrollNumber].filter(Boolean).join(' / ')}</Field>
          </tr>
          <tr>
            <td style={cell}>
              Employment type: <Box on={box === 'permanent'}>Permanent</Box>
              <Box on={box === 'fixed_term'}>Fixed term</Box>
              <Box on={box === 'probation'}>Probation</Box>
            </td>
            <Field name="Contract end date (if applicable)">{formDate(borrower.contractEndDate)}</Field>
          </tr>
          <tr>
            <Field name="Gross monthly salary (KSh)">{money(latestPay?.gross ?? borrower.basicSalary)}</Field>
            <Field name="Net monthly salary before this loan (KSh)">{money(latestPay?.net)}</Field>
          </tr>
          <tr>
            <Field name="Other monthly loan liability (KSh)">{money(loan.other_loan_repayments)}</Field>
            <Field name="Preferred disbursement account / M-Pesa number">{loan.disbursement_account}</Field>
          </tr>
        </tbody>
      </table>

      <div style={h2}>B. Loan request</div>
      <table style={table}>
        <tbody>
          <tr>
            <Field name="Amount requested (KSh)">{formatKsh(loan.principal)}</Field>
            <Field name="Type of loan">{loan.product_name || 'Staff loan'}</Field>
          </tr>
          <tr>
            {terms.length ? (
              <td style={cell}>Loan term requested: {termBoxes}</td>
            ) : (
              <Field name="Loan term requested">
                {loan.months} {loan.months === 1 ? 'month' : 'months'}
              </Field>
            )}
            <Field name="Purpose of loan">{loan.reason}</Field>
          </tr>
        </tbody>
      </table>

      {/* page 2 */}
      <div style={pageBreak} className="html2pdf__page-break" />
      <div style={h2}>C. Loan offer &amp; key facts statement</div>
      <p style={note}>The lender must complete this section and provide it to the borrower before the borrower signs the agreement.</p>
      <table style={table} className="loan-form-keep">
        <tbody>
          <tr>
            <td style={{ ...cell, fontWeight: 700 }}>Loan particulars</td>
            <td style={{ ...cell, fontWeight: 700 }}>Amount / Details</td>
          </tr>
          {(
            [
              ['Gross Loan Amount (principal repayable)', formatKsh(facts.grossLoan)],
              ['Selected term', terms.length ? termBoxes : `${facts.months} ${facts.months === 1 ? 'month' : 'months'}`],
              [
                upfront ? 'Upfront interest rate' : 'Interest rate',
                terms.length ? rateBoxes : `${rateText(facts.rate, facts.method)} (${interestMethodLabel(facts.method).toLowerCase()})`,
              ],
              ['Upfront interest deducted', upfront ? formatKsh(facts.upfrontInterest) : 'None'],
              ...(!upfront ? [['Interest charged over the term', formatKsh(facts.termInterest)]] : []),
              ['Net Disbursement (cash borrower receives)', formatKsh(facts.netDisbursement)],
              ['Total amount repayable', formatKsh(facts.totalRepayable)],
              ['Annual Percentage Rate (APR)', facts.apr === null ? '' : `${facts.apr.toLocaleString('en-KE', { maximumFractionDigits: 1 })}% a year`],
              ['Number of instalments', String(facts.instalments)],
              ['Monthly instalment', formatKsh(facts.monthlyInstalment)],
              ['First instalment date', day(facts.firstDue)],
              ['Final repayment date', day(facts.finalDue)],
              ['Late payment charge', late === null ? 'None' : `${late}% of overdue amount, charged once; not compounded`],
              ['If the borrower dies or becomes permanently incapacitated', settings.incapacity_terms ?? ''],
              ['Disbursement channel', loan.disbursement_account ? `Paid to ${loan.disbursement_account}` : ''],
            ] as [string, ReactNode][]
          ).map(([k, v]) => (
            <tr key={k}>
              <td style={cell}>{k}</td>
              <td style={{ ...cell, fontWeight: 600 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!approved && (
        <p style={{ ...note, color: '#9a3412' }}>
          Draft: these figures are worked out from the request. They are confirmed when the loan is approved, and the approved form is the one to sign.
        </p>
      )}

      <div style={h2}>D. Repayment schedule</div>
      <table style={table}>
        <thead>
          <tr>
            {['Instalment No.', 'Due date', 'Instalment (KSh)', 'Balance after payment (KSh)'].map((h) => (
              <th key={h} style={{ ...cell, width: '25%', textAlign: 'left' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {facts.schedule.map((r) => (
            <tr key={r.no}>
              <td style={{ ...cell, width: '25%' }}>{r.no}</td>
              <td style={{ ...cell, width: '25%' }}>{formDate(r.due)}</td>
              <td style={{ ...cell, width: '25%' }}>{formatKsh(r.payment)}</td>
              <td style={{ ...cell, width: '25%' }}>{formatKsh(r.balanceAfter)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={note}>The completed schedule must match the total amount repayable and the selected loan term. Each instalment is due on the last day of its month, through payroll.</p>

      <div style={h2}>Guarantor personal detail</div>
      <p style={note}>The guarantor must be employed by the same employer as the borrower/loan applicant.</p>
      <div className="loan-form-keep" style={{ lineHeight: 2.1, marginBottom: 10 }}>
        <div>
          Full name {dots(g?.guarantor_name, 200)} National ID / Passport NO. {dots(g?.id_number, 110)} KRA PIN {dots(g?.kra_pin, 100)}
        </div>
        <div>
          Date of birth {dots(formDate(g?.date_of_birth), 100)} Mobile number {dots(g?.mobile, 120)} Alternative telephone number {dots(g?.alternative_phone, 110)}
        </div>
        <div>
          Email address {dots(g?.email, 190)} Residential address {dots(g?.residential_address, 150)} County / Town {dots(g?.town, 90)}
        </div>
        <div>Relationship to borrower {dots(g?.relationship, 160)}</div>
      </div>

      <div style={h2}>Guarantor's declarations &amp; undertakings</div>
      {[
        'I am at least 18 years old and the identity, employment and income information I have provided is true, accurate and complete.',
        'I confirm that I am currently employed by the same employer named by the borrower in this form.',
        'I authorize the Lender to verify my identity, employment status, payroll number, salary and relevant employment information with my employer for the purpose of assessing and administering this guarantee.',
        'I have had the opportunity to read the related loan agreement and this Guarantor Form, and to ask questions or seek independent advice.',
        'I understand the gross loan amount, net amount disbursed, total amount repayable, repayment term, instalments and late payment penalty disclosed in the loan agreement.',
        'I understand that signing as guarantor may make me personally responsible for the guaranteed amount if the borrower defaults and the conditions of this undertaking are met.',
        'I have considered my income, deductions and financial commitments and believe I can meet the guarantee up to the maximum amount stated, if lawfully called upon.',
        'I am signing voluntarily and have not been threatened, pressured or coerced.',
      ].map((t) => (
        <p key={t} style={{ margin: '0 0 3px' }}>
          {t}
        </p>
      ))}
      {[
        `Subject to this form and applicable law, I undertake to guarantee payment to ${L} of the borrower's obligations under the loan agreement identified in this form.`,
        "The Lender may call on this guarantee only after an event of default has occurred under the loan agreement, the Lender has given the borrower the written default notice and opportunity to remedy the default described in that agreement, and the guaranteed amount remains unpaid. The Lender shall give the guarantor written notice stating the amount claimed and the basis of the claim. The guarantor's liability is limited to the pending loan balance. Any claim must relate to sums lawfully due under the loan.",
        "This guarantee does not by itself authorize the Lender or employer to deduct money from the guarantor's salary. Any salary deduction from the guarantor must be covered by a separate, specific written authorization and comply with employment law and statutory deduction limits. A change of employment does not automatically cancel liability already validly incurred, subject to applicable law and this form.",
        'The Lender shall release the guarantor once the guaranteed obligations have been settled or the loan liability is cleared.',
        'The Lender and its agents shall deal with the guarantor lawfully, fairly and respectfully and shall not use threats, abusive language, intimidation or public shaming. Recovery action must comply with applicable law and regulatory obligations.',
        'This form is governed by the laws of Kenya. The parties shall first seek to resolve disputes through discussion and negotiation. If unresolved, a dispute may be referred to mediation or the competent courts of Kenya, as applicable.',
        `I authorize ${L} to collect and use my personal data for assessing, documenting, administering and, where lawfully necessary, enforcing this guarantee. This may include verifying my identity, employment, payroll details and income with my employer, and sharing relevant information with service providers, regulators or other parties where required or permitted by law. My data shall be handled in accordance with the Data Protection Act and applicable regulations.`,
      ].map((t) => (
        <p key={t} style={{ ...clause, marginTop: 7 }}>
          {t}
        </p>
      ))}

      <div style={{ ...h2, textTransform: 'none', fontWeight: 400 }}>GUARANTOR'S ACKNOWLEDGEMENT &amp; SIGNATURE</div>
      <p style={clause}>
        I confirm that I have read and understood this Guarantor Form and the guarantee obligations described in it. I confirm that I am employed by the same employer as the borrower and that I am fully liable for this loan. I understand that I should retain a copy of this signed form and the related loan details.
      </p>
      <table style={table} className="loan-form-keep">
        <tbody>
          <tr>
            <Field name="Name">{g?.guarantor_name}</Field>
            <Field name="ID NO">{g?.id_number}</Field>
          </tr>
          <tr>
            <Field name="Signature">
              <Signature src={g?.signature} alt="Guarantor's signature" />
            </Field>
            <Field name="Date">{formDate(g?.signed_at)}</Field>
          </tr>
        </tbody>
      </table>

      {/* terms */}
      <div style={pageBreak} className="html2pdf__page-break" />
      <div style={{ ...h2, fontSize: 14.5 }}>Terms &amp; conditions</div>
      {[
        <>You must be an adult in active employment and provide documents that allow {L} to confirm your identity, job and ability to repay. Approval is not automatic. If your contract is fixed term, it should run beyond the date your last instalment is due.</>,
        <>Before releasing funds, the Lender must receive and accept this signed form and Key Facts Statement, the signed salary deduction authority and employer acknowledgement where payroll deduction applies, a copy of the applicant’s ID or passport, KRA PIN certificate, the latest three months’ payslips or written salary confirmation, and any other reasonable legally required customer due-diligence information.</>,
        <>The Gross Loan Amount is the principal amount approved and repayable. {upfront ? 'Upfront interest and any other expressly disclosed lawful deduction are' : 'Any expressly disclosed lawful deduction is'} taken from it before the balance (Net Disbursement) is paid to the account stated in this form. Disbursement is expected within two Business Days after all pre-disbursement conditions are met. Bank or mobile-money receiving fees charged by the provider are the borrower’s responsibility.</>,
        upfront ? (
          <>Interest is a flat, one-off charge calculated on the Gross Loan Amount and deducted once at disbursement: {rateText(loan.annual_rate, loan.interest_method)} for this loan’s term of {loan.months} {loan.months === 1 ? 'month' : 'months'}. It is not charged again, does not compound and does not change during the term. The selected rate remains fixed after disbursement, including where early or part repayment is made. No fee not listed in the Key Facts Statement is payable. The APR must be disclosed in the Key Facts Statement before signing.</>
        ) : (
          <>Interest is charged at {rateText(loan.annual_rate, loan.interest_method)} ({interestMethodLabel(loan.interest_method).toLowerCase()}) and is included in the instalments in the Key Facts Statement. The rate does not change during the term. No fee not listed in the Key Facts Statement is payable. The APR must be disclosed in the Key Facts Statement before signing.</>
        ),
        <>The borrower must pay the instalments in the amounts and on the dates in the Key Facts Statement. Repayment may be made by authorized payroll deduction, the Lender’s designated M-Pesa Paybill, bank transfer or another channel confirmed in writing. Do not pay cash to an individual or pay an account not designated by the Lender in writing. Payments are applied first to any lawful disclosed late charge and then to the Outstanding Balance. The Lender will send payment confirmation and provide a loan statement on request at no charge.</>,
        <>With this check-off system, the borrower authorizes the employer in writing to deduct each instalment and remit it to the Lender. The employer is expected to remit deductions within five Business Days after each payroll date, subject to its signed undertaking. Deductions must remain within applicable statutory limits under the Employment Act, 2007. If the employer does not deduct, or deducts less than due, the borrower must pay the shortfall directly within seven days after notice. If the employer has deducted money from salary but failed to remit it, the borrower is treated as having paid that instalment and the Lender must pursue the employer for the remittance. The employer is a payroll facilitator, not a guarantor or co-borrower. The borrower must notify the Lender within five days if deductions stop or salary falls.</>,
        <>If the borrower resigns, retires, is dismissed, is declared redundant or otherwise leaves employment before full repayment, the Outstanding Balance remains due. The borrower must notify the Lender in writing within five days after giving or receiving termination notice. The borrower authorizes lawful deductions from final salary and terminal dues, subject to legal limits. Any remaining balance must be addressed through a written repayment arrangement within 14 days after leaving employment. No additional interest is charged solely because employment ends.</>,
        <>The treatment of the Outstanding Balance if the borrower dies or becomes permanently incapacitated is: {settings.incapacity_terms ? <strong>{settings.incapacity_terms}</strong> : '____________________________________________'}</>,
        <>The borrower may repay all or part of the Outstanding Balance at any time. No early repayment penalty or fee applies. A settlement statement must be provided within two Business Days of request at no charge.{upfront ? ' Early repayment does not create a refund, rebate or reduction of the upfront interest.' : ''} After full repayment, the Lender will issue a clearance letter within five Business Days, notify the employer to stop deductions and update relevant Credit Reference Bureau records as required.</>,
        <>The borrower confirms that all information and documents supplied are true, accurate and complete; that they have capacity to sign; that the application is voluntary; that they understand the gross loan, {upfront ? 'upfront interest' : 'interest'}, net disbursement and total repayment; and that the instalments are affordable after considering other commitments. The borrower must disclose any known pending termination, disciplinary process or salary reduction, must not use the loan unlawfully, and must notify the Lender within five days of changes to employment, salary, phone number, email or residential address.</>,
        <>An event of default includes an instalment remaining unpaid for 14 days after its due date without a written repayment plan; false or misleading application information; revocation of salary deduction authority without an alternative repayment method; leaving employment without settling or agreeing a plan; or bankruptcy/insolvency. On default, the Lender will send written SMS or email notice stating the overdue amount. The borrower has 14 days after notice to pay or agree a plan. If not remedied, the Lender may demand the full Outstanding Balance. {late === null ? 'No late repayment penalty applies.' : `A late repayment penalty of ${late}% of the overdue amount (arrears) may be charged once on that overdue amount; it is not compounded and does not itself attract another penalty.`} No other default interest or penalty applies. All charges remain subject to applicable law and CBK requirements. Legal costs may be recovered only if awarded by a court or otherwise lawfully recoverable.</>,
        <>The Lender and its agents must collect debts lawfully, fairly and respectfully. They must not threaten, abuse, intimidate, publicly shame the borrower or disclose the debt to family, friends, colleagues or phone contacts. Debt details may be shared with the employer only as reasonably necessary to administer authorized payroll deductions. Contact must take place during lawful and reasonable hours. The Lender remains responsible for agents it appoints and must notify the borrower in writing if an agent is appointed.</>,
        <>The Lender may share relevant positive and negative credit information with licensed Credit Reference Bureaus where permitted by law and subject to notice, accuracy and dispute requirements. Required notice must be given before negative information is submitted. The borrower may dispute inaccurate information with the Lender or bureau. Information must be corrected or updated within the period required by law after repayment or dispute resolution.</>,
        <>The Lender processes personal data under the Data Protection Act and applicable regulations to assess and administer the loan, verify identity/employment/income, manage payroll deductions, report to licensed CRBs where permitted, prevent fraud, meet legal and regulatory duties and recover debts lawfully. The employer may share salary, employment, payroll and exit information only as reasonably necessary for this loan. The Lender will not access phone contacts, photos or other device data for this loan and will not sell or use personal data for marketing without a separate lawful basis and, where required, separate consent. Data may be shared with the employer, licensed CRBs, CBK and other regulators, confidential service providers or others where law permits or requires. Records are retained as required by law. {lender.complaintsEmail ? `Data access/correction requests may be sent to ${lender.complaintsEmail}; complaints` : 'Complaints'} may also be made to the Office of the Data Protection Commissioner.</>,
        <>Each party must keep the agreement terms and information received from the other party confidential. The Lender may disclose information only as allowed by the agreement or required/permitted by law.</>,
        <>A borrower may complain {complaints ? `${complaints} ` : ''}or in person at the Lender’s office. The Lender will acknowledge and respond within the timelines in its complaints policy and applicable CBK requirements. An unresolved complaint may be escalated to the Central Bank of Kenya or another competent authority. The parties should first attempt negotiation. If unresolved within 30 days, either party may refer the dispute to mediation or the courts of Kenya, including the Small Claims Court where applicable.</>,
        <>The borrower may not transfer their rights or obligations under this agreement. The Lender may transfer the agreement to another CBK-licensed lender after written notice, provided the borrower’s rights and agreed loan terms are not made less favourable.</>,
        <>Notices may be sent by SMS, email or hand delivery to the contact details provided. Electronic notices are treated as received in accordance with applicable law and evidence of delivery. Electronic signatures and counterparts may be used where permitted by Kenyan law.</>,
        <>Any change to this agreement must be in writing and signed or electronically accepted by both parties. Verbal arrangements do not change the agreement. A delay or failure to enforce a right does not mean that right has been waived.</>,
        <>This form and its schedules are the entire agreement about this loan. If one provision is invalid or unenforceable, the remaining provisions continue to apply to the extent permitted by law. If the agreement conflicts with applicable law or CBK regulation, the law or regulation prevails. The agreement is governed by the laws of Kenya, including the CBK Act, CBK (Digital Credit Providers) Regulations, 2022, Consumer Protection Act, 2012, Employment Act, 2007, Data Protection Act, 2019 and applicable regulations.</>,
      ].map((c, i) => (
        <p key={i} style={clause}>
          {c}
        </p>
      ))}

      {/* F */}
      <div style={pageBreak} className="html2pdf__page-break" />
      <div style={h2}>Salary deduction authority</div>
      <p style={clause}>
        I authorize my employer to deduct the monthly instalment shown in the Key Facts Statement and remit it to {L} until the loan is fully repaid. If I leave employment, I authorize lawful deductions from final salary and terminal dues, subject to legal limits. I authorize the employer to share salary, employment status and exit information only as needed to administer this loan.
      </p>
      <p style={clause}>
        I understand that deductions are subject to statutory limits; I remain responsible for any amount not deducted or remitted, except where my employer has deducted it from my salary but failed to remit it; and this authority continues until full repayment. Revoking it does not cancel the debt and I must agree another repayment method.
      </p>
      <table style={table} className="loan-form-keep">
        <tbody>
          <tr>
            <Field name="Employee name">{borrower.fullName}</Field>
            <Field name="Employee / payroll number">{[borrower.employeeNumber, borrower.payrollNumber].filter(Boolean).join(' / ')}</Field>
          </tr>
          <tr>
            <Field name="National ID number">{borrower.idNumber}</Field>
            <Field name="Agreement reference:">{reference}</Field>
          </tr>
          <tr>
            <Field name="Monthly deduction (KSh)">{formatKsh(facts.monthlyInstalment)}</Field>
            <Field name="First deduction month">{facts.firstDue ? facts.firstDue.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }) : ''}</Field>
          </tr>
          <tr>
            <Field name="Final deduction month">{facts.finalDue ? facts.finalDue.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }) : ''}</Field>
            <td style={cell} />
          </tr>
        </tbody>
      </table>
      <table style={table} className="loan-form-keep">
        <tbody>
          <tr>
            <Field name="Employee signature">
              <Signature src={form?.borrower_signature} alt="Borrower's signature" />
            </Field>
            <Field name="Date">{formDate(borrowerSignedOn)}</Field>
          </tr>
        </tbody>
      </table>

      <div style={{ ...h2, textTransform: 'none' }}>Employer Undertaking</div>
      <p style={clause}>
        The employer acknowledges this authority and, subject to applicable law and payroll requirements, undertakes to make authorized deductions and remit them within five Business Days after each payroll date; notify the Lender within five days if the employee resigns, is dismissed or goes on unpaid leave. The employer facilitates payroll deductions only and does not guarantee or assume liability for the loan.
      </p>
      <table style={table} className="loan-form-keep">
        <tbody>
          <tr>
            <Field name="Employer name">{borrower.employer}</Field>
            <Field name="Authorized officer">{form?.employer_officer}</Field>
          </tr>
          <tr>
            <Field name="Designation">{form?.employer_officer_title}</Field>
            <Field name="Signature">
              <Signature src={form?.employer_signature} alt="Employer officer's signature" />
            </Field>
          </tr>
          <tr>
            <Field name="Date">{formDate(form?.employer_signature ? form.reviewed_at : null)}</Field>
            <Field name="Official stamp">
              <span style={{ display: 'block', height: 40 }} />
            </Field>
          </tr>
        </tbody>
      </table>

      {/* G */}
      <div style={pageBreak} className="html2pdf__page-break" />
      <div style={h2}>Borrower acknowledgement &amp; declaration</div>
      <div>By signing, I confirm that:</div>
      <ul style={{ margin: '4px 0 10px', paddingLeft: 22 }}>
        <li>I have read this form and its Terms and Conditions, or they have been read and explained to me in a language I understand.</li>
        <li>I have received and understood the Key Facts Statement and repayment schedule before signing.</li>
        <li>I understand the Gross Loan Amount, {upfront ? 'upfront interest' : 'interest'}, Net Disbursement, total amount repayable, instalments and due dates.</li>
        {late !== null && <li>I understand the {late}% one-time late repayment penalty on the overdue amount, subject to applicable law and CBK requirements.</li>}
        <li>I have had an opportunity to ask questions and seek independent advice.</li>
        <li>The information I have provided is true, accurate and complete, and I am applying voluntarily.</li>
      </ul>
      <table style={table} className="loan-form-keep">
        <tbody>
          <tr>
            <Field name="Borrower full name">{borrower.fullName}</Field>
            <Field name="National ID / Passport number">{borrower.idNumber}</Field>
          </tr>
          <tr>
            <Field name="Borrower signature">
              <Signature src={form?.borrower_signature} alt="Borrower's signature" />
            </Field>
            <Field name="Date">{formDate(borrowerSignedOn)}</Field>
          </tr>
        </tbody>
      </table>
      <table style={table} className="loan-form-keep">
        <tbody>
          <tr>
            <Field name="Witness full name">{form?.witness_name}</Field>
            <Field name="Witness National ID number">{form?.witness_id_number}</Field>
          </tr>
          <tr>
            <Field name="Witness signature">
              <Signature src={form?.witness_signature} alt="Witness's signature" />
            </Field>
            <Field name="Date">{formDate(form?.witness_signed_at)}</Field>
          </tr>
        </tbody>
      </table>

      <div style={{ ...h2, textTransform: 'none', fontStyle: 'italic' }}>For Official Use</div>
      <table style={table} className="loan-form-keep">
        <tbody>
          <tr>
            <td style={cell}>
              Loan approved: <Box on={approved}>Yes</Box>
              <Box on={loan.status === 'rejected'}>No</Box>
            </td>
            <Field name="Approved Gross Loan Amount (KSh)">{approved ? formatKsh(loan.principal) : ''}</Field>
          </tr>
          <tr>
            <Field name="Approved term">{approved ? `${loan.months} ${loan.months === 1 ? 'month' : 'months'}` : ''}</Field>
            <Field name="Approved monthly instalment (KSh)">{approved ? formatKsh(facts.monthlyInstalment) : ''}</Field>
          </tr>
          <tr>
            <Field name="Affordability assessment completed by">{form?.affordability_by}</Field>
            <Field name="Approval date">{approved ? formDate(loan.decided_at) : ''}</Field>
          </tr>
          <tr>
            <Field name="Lender Approver’s name">{form?.approver_name}</Field>
            <Field name="Designation">{form?.approver_title}</Field>
          </tr>
          <tr>
            <Field name="Signature">
              <Signature src={form?.approver_signature} alt="Approver's signature" />
            </Field>
            <Field name="Company stamp">
              <span style={{ display: 'block', height: 40 }} />
            </Field>
          </tr>
          <tr>
            <Field name="Disbursement date">{formDate(payout?.paidOn ?? loan.disbursed_at)}</Field>
            <Field name="Disbursement transaction reference">{payout?.reference}</Field>
          </tr>
        </tbody>
      </table>

      <div style={h2}>Document checklist</div>
      {(
        [
          ['Signed application/agreement Loan form', form?.status === 'accepted'],
          ...CHECKLIST.map((c): [string, boolean] => [c.label, !!form?.checks?.includes(c.id)]),
        ] as [string, boolean][]
      ).map(([text, done]) => (
        <div key={text} style={{ margin: '0 0 5px' }}>
          {done ? '☑' : '☐'} {text}
        </div>
      ))}
    </div>
  );
});

export default LoanAgreementDocument;
