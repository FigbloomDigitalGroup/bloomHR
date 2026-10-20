// hr_law.js - the HR, labour and pay law the AI assistants may lean on, per country, each rule with its source.
//
// The product's rule: legal rules come first from cited data, the AI explains and suggests, a person confirms. So the
// model is not left to recall the law: ai_routes.js picks the entries that fit the question and the company's
// countries (selectHrLaw) and puts them in the system prompt (hrLawPrompt), with an instruction to cite the section,
// to call it a guide and not legal advice, and to say when it does not know.
//
// Figures that change often (tax bands, contribution rates and caps, levies, minimum wages) are NOT written here:
// entries point to the app's statutory_rates table (Settings > Statutory rates) or the company's minimum wage
// setting, and ai_routes.js adds the default rates in force today from statutory_rates when a question is about them.
// Figures that are part of the Act itself (21 days' annual leave, 15 days' severance a year, ...) are written in.
//
// asOf is the date the entry was last checked against the law; a later amendment may change it. Kenya, Tanzania
// (Mainland; Zanzibar has its own labour laws) and Uganda are covered; anywhere else gets the "General" entries,
// labelled as international good practice, not that country's law.

export const HR_LAW_AS_OF = "2026-10-20";

/** The countries with their own entries; any other country is given the General entries. */
export const HR_LAW_COUNTRIES = ["Kenya", "Tanzania", "Uganda"];

const RATES = "the current figures are in the app's statutory rates (Settings > Statutory rates), not here";

// topic -> words in a question that mean it is about that topic
const TOPIC_WORDS = {
  contracts: /\bcontract|written particulars|particulars of employment|letter of (appointment|offer)|offer letter|\bterms of employment/i,
  probation: /probation/i,
  casuals: /casual|day ?worker|daily (paid|rate|wage)|temporary worker|piece ?(rate|work)|vibarua/i,
  hours: /working hours|work(ing)? week|hours of work|overtime|rest day|day off|night (work|shift)|\bshifts?\b/i,
  annual_leave: /annual leave|leave days|holiday entitlement|\bleave\b(?! approver)|carry (forward|over)|vacation|leave balance/i,
  maternity: /maternity|pregnan|adoption|adoptive|giving birth|new mother/i,
  paternity: /paternity|new father|father'?s leave/i,
  sick_leave: /sick|illness|medical certificate|\bill\b|unwell|incapacity/i,
  compassionate: /compassionate|bereavement|funeral|death in the family/i,
  termination: /terminat|dismiss|\bfir(e|ed|ing)\b|sack|let (him|her|them) go|misconduct|disciplin|warning letter|show cause|hearing|resign|exit|leav(e|ing) the company|unfair/i,
  notice: /notice/i,
  redundancy: /redundan|retrench|lay ?off|downsiz|restructur/i,
  severance: /severance|service pay|gratuity|terminal (benefits|dues)|final dues/i,
  deductions: /deduct|two[- ]thirds|one[- ]third|recover(y|ing)? (a |the )?(loan|advance)|salary advance|net pay|take[- ]home/i,
  pay: /\bpay(slip|ment)?\b|wages?|salar|itemi[sz]ed/i,
  unions: /union|collective (bargaining )?agreement|\bcba\b|strike|recogni[sz]ation agreement|agency fee/i,
  safety: /safety|health and safety|\bosha\b|\bosh\b|hazard|risk assessment|first aid|dosh/i,
  work_injury: /injur|accident|wiba|workers'? compensation|\bwcf\b|occupational disease/i,
  harassment: /harass|discriminat|equal pay|equal remuneration/i,
  pension: /\bnssf\b|pension|social security|provident fund|retirement/i,
  health_insurance: /\bshif\b|\bsha\b|\bnhif\b|health insurance|social health/i,
  housing_levy: /housing levy|\bahl\b|affordable housing|housing fund/i,
  paye: /\bpaye\b|income tax|\btax(es|able)?\b|\bkra\b|\btra\b|\bura\b|personal relief|benefits? in kind|p9|p10/i,
  skills_levy: /\bsdl\b|skills development|\bnita\b|industrial training levy|training levy/i,
  local_service_tax: /\blst\b|local service tax/i,
  minimum_wage: /minimum wage|wage order|lowest pay|statutory minimum/i,
  child_labour: /child labou?r|employ(ing|ment of)? (a )?(child|children|minors?)|under ?age (worker|staff)|minimum age|young (worker|person)|forced labou?r/i,
};

/** Rate-like topics: a question about one of these also gets the default rates in force today (ai_routes.js). */
export const RATE_TOPICS = ["pension", "health_insurance", "housing_levy", "paye", "skills_levy", "local_service_tax", "work_injury"];

const KE = "Kenya";
const TZ = "Tanzania";
const UG = "Uganda";
const GENERAL = "General";

/**
 * Each entry: the topic, the country (or General), the rule in plain words, the source (Act and section) and the
 * date it was checked. Keep rules short: the prompt carries several at once.
 */
export const HR_LAW = [
  // ----------------------------------------------------------------------------------------------- Kenya
  { topic: "contracts", country: KE, source: "Employment Act 2007, ss. 9 and 10",
    rule: "A contract for 3 months or more in total (or for work that cannot reasonably be done within 3 months) must be in writing; the employer drafts it and explains it to the employee in a language they understand. It must state the particulars in s.10: names, job, start date, pay and how it is worked out, pay intervals, hours, leave, sick pay, pension, notice and place of work." },
  { topic: "probation", country: KE, source: "Employment Act 2007, s.42",
    rule: "Probation may be at most 6 months, and may be extended once by up to 6 more months only with the employee's agreement (12 months in all). During probation either side may end the contract with at least 7 days' notice or 7 days' pay instead of notice." },
  { topic: "casuals", country: KE, source: "Employment Act 2007, ss. 2 and 37",
    rule: "A casual is paid at the end of each day and engaged for no more than 24 hours at a time. A casual who works continuously for a month or more in total (or on work that cannot reasonably be done within 3 months) becomes, by law, an employee paid monthly with the notice of s.35(1)(c) and the Act's other rights (leave, sick pay and so on)." },
  { topic: "hours", country: KE, source: "Employment Act 2007, s.27; Regulation of Wages orders under the Labour Institutions Act 2007",
    rule: "Every employee is entitled to at least one rest day in every 7 days. Normal weekly hours and overtime pay are set by the Regulation of Wages orders (the General Order and the Agricultural Wages Order) for the sector; check the order that covers the worker." },
  { topic: "annual_leave", country: KE, source: "Employment Act 2007, s.28",
    rule: "After every 12 consecutive months of service an employee is entitled to at least 21 working days of annual leave with full pay; after 2 consecutive months, leave builds up pro rata at at least 1.75 days per month. Leave may be split by agreement, but the employee is entitled to at least 2 consecutive weeks uninterrupted, taken within the leave year or no later than 18 months after it ends." },
  { topic: "maternity", country: KE, source: "Employment Act 2007, s.29 and s.29A (Employment (Amendment) Act 2021)",
    rule: "A female employee is entitled to 3 months' maternity leave with full pay, on 7 days' notice (or as soon as reasonable) with a medical certificate. She returns to the same job or a reasonably suitable one on terms no less favourable, and does not lose annual leave because of it. An employee adopting a child is entitled to 1 month's pre-adoptive leave with full pay (s.29A)." },
  { topic: "paternity", country: KE, source: "Employment Act 2007, s.29(8)",
    rule: "A male employee is entitled to 2 weeks' paternity leave with full pay." },
  { topic: "sick_leave", country: KE, source: "Employment Act 2007, s.30",
    rule: "After 2 consecutive months of service, an employee is entitled in each 12 months to 7 days' sick leave with full pay and then 7 days with half pay, on producing a certificate of incapacity from a medical practitioner. They must tell the employer as soon as reasonably practicable." },
  { topic: "pay", country: KE, source: "Employment Act 2007, ss. 17, 18 and 20",
    rule: "Wages are paid in money (legal tender, or into a bank account with the employee's agreement), when they fall due (monthly pay at the end of the month), and with a written itemised statement of the gross pay and every deduction (s.20)." },
  { topic: "deductions", country: KE, source: "Employment Act 2007, s.19",
    rule: "An employer may deduct from wages only what s.19(1) allows: statutory deductions (PAYE, NSSF, SHIF, housing levy), amounts the employee agreed to in writing (loans, advances, SACCO, insurance), union dues under the Labour Relations Act, and certain losses caused by the employee's wilful default. All deductions at any one time may not exceed two-thirds of the wages (s.19(3)): the employee must keep at least one-third." },
  { topic: "notice", country: KE, source: "Employment Act 2007, ss. 35 and 36",
    rule: "Minimum notice: a contract paying daily ends at the close of any day without notice; one paying at intervals shorter than a month ends at the end of the next period after written notice; one paying monthly (or longer) needs 28 days' written notice, by either side. Either side may pay wages for the notice period instead of giving notice (s.36). A contract may give longer notice." },
  { topic: "termination", country: KE, source: "Employment Act 2007, ss. 41, 43, 44, 45 and 47",
    rule: "Before dismissing for misconduct, poor performance or physical incapacity, the employer must explain the reason in a language the employee understands, with a fellow employee or union representative of their choice present, and hear what they say (s.41). The employer must be able to prove a valid and fair reason (s.43, s.45); summary dismissal without notice is only for gross misconduct as listed in s.44. A dismissed employee may complain to a labour officer within 3 months (s.47); the Employment and Labour Relations Court may award up to 12 months' gross wages (s.49)." },
  { topic: "termination", country: KE, source: "Employment Act 2007, ss. 46 and 51",
    rule: "Pregnancy, union membership, filing a complaint, race, religion, HIV status and similar grounds are never fair reasons to dismiss (s.46). On leaving, every employee must get a certificate of service (s.51)." },
  { topic: "redundancy", country: KE, source: "Employment Act 2007, s.40",
    rule: "Before a redundancy the employer must: give the union (or, if not unionised, each employee in writing) and the local labour officer at least one month's notice of the reasons and extent; choose who goes by seniority, skill, ability and reliability; pay any leave due in cash; give one month's notice or one month's wages instead; and pay severance of at least 15 days' pay for each completed year of service." },
  { topic: "severance", country: KE, source: "Employment Act 2007, s.35(5) and (6)",
    rule: "An employee on monthly pay whose contract is ended under s.35(1)(c) is entitled to service pay for each year worked, on terms in the contract or collective agreement. Service pay is not due if the employee is a member of a registered pension or provident fund, a gratuity or service pay scheme, or the NSSF (s.35(6)). Redundancy severance is separate (s.40)." },
  { topic: "harassment", country: KE, source: "Employment Act 2007, ss. 5 and 6",
    rule: "Employers must not discriminate on grounds such as race, sex, religion, ethnicity, pregnancy, disability or HIV status, and must pay equal remuneration for work of equal value (s.5). An employer of 20 or more employees must have a written policy statement on sexual harassment (s.6)." },
  { topic: "unions", country: KE, source: "Labour Relations Act 2007, ss. 4, 48, 49 and 54",
    rule: "Employees may join a trade union (s.4). An employer must recognise a union that represents a simple majority of its unionisable employees (s.54). Once the Minister so orders, the employer deducts union dues for members who sign the form (s.48), and may be required to deduct an agency fee from non-members covered by a collective agreement (s.49)." },
  { topic: "safety", country: KE, source: "Occupational Safety and Health Act 2007, ss. 6, 9 and 44",
    rule: "The occupier must keep the workplace safe and without risk to health, carry out risk assessments and train workers (s.6); a workplace with 20 or more workers must have a safety and health committee (s.9); workplaces must be registered with the Directorate of Occupational Safety and Health Services (s.44)." },
  { topic: "work_injury", country: KE, source: "Work Injury Benefits Act 2007, ss. 7, 10 and 21",
    rule: "Every employer must hold an insurance policy, with an approved insurer, covering its liability for work injuries and occupational diseases (s.7). An employee injured at work, or who gets an occupational disease, is entitled to compensation under the Act (s.10). Accidents must be reported to the Director of Occupational Safety and Health in writing within 7 days (s.21)." },
  { topic: "pension", country: KE, source: "National Social Security Fund Act 2013 (Tier I and Tier II contributions)",
    rule: `Employers register every employee with the NSSF and pay a monthly contribution of the employee's share (deducted from pay) plus an equal employer's share, on pensionable earnings between the lower and upper earnings limits (Tier I and Tier II); ${RATES}.` },
  { topic: "health_insurance", country: KE, source: "Social Health Insurance Act 2023, s.27; Social Health Insurance (General) Regulations 2024",
    rule: `Every Kenyan resident must register with the Social Health Authority. For an employee the employer deducts the SHIF contribution, a percentage of gross salary with a minimum amount, and pays it to the Social Health Authority every month. SHIF replaced NHIF from 1 October 2024; ${RATES}.` },
  { topic: "housing_levy", country: KE, source: "Affordable Housing Act 2024, s.4",
    rule: `The Affordable Housing Levy is charged on an employee's gross salary, with an equal amount paid by the employer; the employer deducts and remits both through KRA. ${RATES.charAt(0).toUpperCase()}${RATES.slice(1)}.` },
  { topic: "paye", country: KE, source: "Income Tax Act (Cap. 470), ss. 3, 5 and 37; Income Tax (PAYE) Rules",
    rule: `Employment income includes salary, allowances and most benefits in kind (s.5). The employer must deduct PAYE each month from what it pays and remit it to KRA by the 9th of the following month (s.37), give each employee a P9 at the end of the year, and file the annual return. Tax bands, personal relief and the thresholds for benefits are set by the Finance Acts; ${RATES}. Whether a specific pay item is taxable is answered on the pay items page.` },
  { topic: "skills_levy", country: KE, source: "Industrial Training Act (Cap. 237); Industrial Training (Training Levy) Order",
    rule: `Employers pay the NITA training levy each month for each employee; it is the employer's cost and is not deducted from pay. ${RATES.charAt(0).toUpperCase()}${RATES.slice(1)}.` },
  { topic: "minimum_wage", country: KE, source: "Labour Institutions Act 2007 (wages councils and wage orders); Regulation of Wages (General) and (Agricultural Industry) Orders",
    rule: "Minimum wages are set by wage orders for each occupation and area (cities, other municipalities, the rest of the country) and agriculture, and are revised by legal notice, usually on Labour Day. Paying less is an offence. The amount your company uses is set under Settings > Minimum wage; check it against the latest legal notice." },
  { topic: "child_labour", country: KE, source: "Employment Act 2007, ss. 53 and 56; Children Act 2022",
    rule: "No child under 13 may be employed; a child of 13 to 16 may do only light work; no child may do the worst forms of child labour or hazardous work (s.53, s.56). Forced labour is prohibited (s.4)." },

  // ----------------------------------------------------------------------------------------------- Tanzania (Mainland)
  { topic: "contracts", country: TZ, source: "Employment and Labour Relations Act 2004 (Cap. 366), ss. 14 and 15",
    rule: "A contract may be for an unspecified period, a specified period (only for professionals and managers), or a specific task (s.14). A written contract, or written particulars of employment, must be given when the employee starts (s.15)." },
  { topic: "probation", country: TZ, source: "Employment and Labour Relations (Code of Good Practice) Rules 2007, rule 10; ELRA s.35",
    rule: "Probation should be a reasonable period for the job and should not normally exceed 12 months; the employer must tell the employee what is expected and give guidance before ending it. The unfair termination protections of the Act apply to employees with at least 6 months' service (s.35)." },
  { topic: "hours", country: TZ, source: "Employment and Labour Relations Act 2004, ss. 19, 20 and 24",
    rule: "Ordinary hours may not exceed 45 a week, 9 a day or 6 days a week; overtime needs agreement, is paid at at least 1.5 times the basic hourly wage and is limited to 50 hours in any 4-week cycle, and no one may work more than 12 hours a day (s.19). Night work is restricted and paid extra (s.20). Every employee gets at least 24 consecutive hours' rest a week (s.24)." },
  { topic: "annual_leave", country: TZ, source: "Employment and Labour Relations Act 2004, s.31",
    rule: "An employee is entitled to at least 28 consecutive days of paid annual leave in each leave cycle of 12 months, which includes any public holidays that fall in it." },
  { topic: "sick_leave", country: TZ, source: "Employment and Labour Relations Act 2004, s.32",
    rule: "In each leave cycle of 36 months an employee is entitled to at least 126 days of sick leave: the first 63 days with full pay and the next 63 days with half pay, on producing a certificate from a medical practitioner." },
  { topic: "maternity", country: TZ, source: "Employment and Labour Relations Act 2004, s.33",
    rule: "A female employee is entitled to at least 84 days' paid maternity leave (100 days if she has more than one child at once), on at least 3 months' notice of the expected birth with a medical certificate. She may not work within 6 weeks of the birth unless a doctor certifies she is fit." },
  { topic: "paternity", country: TZ, source: "Employment and Labour Relations Act 2004, s.34",
    rule: "In each leave cycle an employee is entitled to at least 3 days' paid paternity leave, taken within 7 days of the birth of his child." },
  { topic: "compassionate", country: TZ, source: "Employment and Labour Relations Act 2004, s.34",
    rule: "In each leave cycle an employee is entitled to at least 4 days' paid leave for the sickness or death of their child, or the death of their spouse, parent, grandparent, grandchild or sibling." },
  { topic: "deductions", country: TZ, source: "Employment and Labour Relations Act 2004, s.28",
    rule: "An employer may deduct from pay only what a law, a collective agreement, a court order or arbitration award requires, or what the employee has agreed to in writing (for example a loan); a deduction for loss or damage needs a fair procedure and the employee's written agreement." },
  { topic: "notice", country: TZ, source: "Employment and Labour Relations Act 2004, s.41",
    rule: "Minimum notice: 7 days in the first month of employment; after that 4 days for an employee paid daily or weekly, and 28 days for one paid monthly. Notice must be in writing with the reasons; pay instead of notice is allowed." },
  { topic: "termination", country: TZ, source: "Employment and Labour Relations Act 2004, ss. 37 and 44; Code of Good Practice Rules 2007",
    rule: "A termination is unfair unless the employer proves a valid reason (conduct, capacity, compatibility or operational requirements) and a fair procedure, including a hearing (s.37). On termination the employer pays wages due, leave not taken, notice, severance and transport to the place of recruitment where due, and gives a certificate of service (s.44)." },
  { topic: "redundancy", country: TZ, source: "Employment and Labour Relations Act 2004, s.38",
    rule: "Before retrenching for operational requirements the employer must give notice of the intended retrenchment as soon as it is contemplated, disclose the reasons and the information needed, and consult the union (or the employees) on the reasons, ways to avoid it, who is chosen and the severance." },
  { topic: "severance", country: TZ, source: "Employment and Labour Relations Act 2004, s.42",
    rule: "An employee with at least 12 months' continuous service whose employment is terminated is entitled to severance pay of at least 7 days' basic wage for each completed year, for up to 10 years. It is not due on a fair termination for misconduct, when the employee unreasonably refuses alternative employment, or on retirement." },
  { topic: "work_injury", country: TZ, source: "Workers' Compensation Act (Cap. 263)",
    rule: `Employers in Mainland Tanzania register with the Workers Compensation Fund (WCF) and pay a monthly contribution on employees' gross earnings, which is the employer's cost; injured workers claim from the WCF, and the employer must report accidents and occupational diseases to the Fund. ${RATES.charAt(0).toUpperCase()}${RATES.slice(1)}.` },
  { topic: "pension", country: TZ, source: "National Social Security Fund Act (Cap. 50)",
    rule: `Private-sector employees are members of the NSSF; the employer deducts the employee's share from wages, adds its own share, and pays both to the NSSF monthly; ${RATES}.` },
  { topic: "skills_levy", country: TZ, source: "Vocational Education and Training Act (Cap. 82), as amended by the Finance Acts",
    rule: `An employer with the number of employees set by the Act pays the Skills and Development Levy (SDL) to TRA on gross emoluments each month; it is the employer's cost; ${RATES}.` },
  { topic: "paye", country: TZ, source: "Income Tax Act 2004 (Cap. 332)",
    rule: `The employer withholds PAYE from employment income, including most benefits, and pays it to TRA monthly, filing the returns TRA requires; residents and non-residents and secondary employments are taxed differently; ${RATES}.` },
  { topic: "minimum_wage", country: TZ, source: "Labour Institutions Act 2004; Labour Institutions (Wage Order) in force",
    rule: "Minimum wages are set by a wage order for each sector and revised from time to time. The amount your company uses is set under Settings > Minimum wage; check it against the latest wage order." },
  { topic: "unions", country: TZ, source: "Employment and Labour Relations Act 2004, ss. 9, 61 and 67",
    rule: "Employees may form and join trade unions (s.9). An employer must recognise a registered union that represents the majority of employees in a bargaining unit (s.67) and bargain in good faith; union dues are deducted on the employee's written authority (s.61)." },
  { topic: "harassment", country: TZ, source: "Employment and Labour Relations Act 2004, s.7",
    rule: "Employers must promote equal opportunity and may not discriminate on grounds such as sex, race, religion, disability, HIV status or pregnancy; harassment on these grounds is discrimination; equal pay for work of equal value." },
  { topic: "child_labour", country: TZ, source: "Employment and Labour Relations Act 2004, ss. 5 and 6",
    rule: "No child under 14 may be employed; a child of 14 to 18 may do only light work that is not harmful; forced labour is prohibited." },

  // ----------------------------------------------------------------------------------------------- Uganda
  { topic: "contracts", country: UG, source: "Employment Act 2006, s.59",
    rule: "A contract of service may be oral or written; the employer must give the employee written particulars of employment (s.59), including pay, hours, leave, the job and notice." },
  { topic: "probation", country: UG, source: "Employment Act 2006, s.67",
    rule: "Probation may be at most 6 months, and may be extended by up to 6 more months only with the employee's agreement. During probation the contract may be ended by at least 14 days' notice or 14 days' pay instead." },
  { topic: "hours", country: UG, source: "Employment Act 2006, ss. 51 and 53",
    rule: "Normal hours are 48 a week; with overtime an employee should not work more than 10 hours a day or 56 a week, and overtime is paid at at least 1.5 times the normal rate (2 times on public holidays). Every employee gets at least 24 hours' rest in every 7 days (s.51)." },
  { topic: "annual_leave", country: UG, source: "Employment Act 2006, s.54",
    rule: "An employee is entitled to 7 days of paid annual leave for every 4 months of continuous service (21 working days a year), and to paid public holidays." },
  { topic: "sick_leave", country: UG, source: "Employment Act 2006, s.55",
    rule: "An employee who has worked continuously for at least one month and is sick, with a medical certificate, is entitled to sick pay for the period set in s.55; check the section for how long and how much, and the contract or collective agreement, which may give more." },
  { topic: "maternity", country: UG, source: "Employment Act 2006, s.56",
    rule: "A female employee is entitled to 60 working days of maternity leave with full pay, of which at least 4 weeks follow the birth or miscarriage, and returns to the same or a comparable job." },
  { topic: "paternity", country: UG, source: "Employment Act 2006, s.57",
    rule: "A male employee is entitled to 4 working days of paternity leave immediately after the birth or miscarriage." },
  { topic: "notice", country: UG, source: "Employment Act 2006, s.58",
    rule: "Minimum notice by length of service: more than 6 months but under 12 months, 2 weeks; 12 months to under 5 years, 1 month; 5 to under 10 years, 2 months; 10 years or more, 3 months. Pay instead of notice is allowed." },
  { topic: "termination", country: UG, source: "Employment Act 2006, ss. 66, 68, 69 and 71",
    rule: "Before dismissing for misconduct or poor performance the employer must explain the reason in a language the employee understands and hear them, with a person of their choice present (s.66); the employer must prove the reason (s.68); summary dismissal is only for conduct showing a fundamental breach (s.69). A complaint goes to a labour officer within 3 months (s.71)." },
  { topic: "redundancy", country: UG, source: "Employment Act 2006, s.81",
    rule: "Before terminating 10 or more employees over 3 months for economic, technological, structural or similar reasons, the employer must give their representatives and the labour commissioner at least 4 weeks' written notice with the reasons, numbers and period, and consult them." },
  { topic: "severance", country: UG, source: "Employment Act 2006, ss. 87-89",
    rule: "An employee with 6 months' or more continuous service is entitled to a severance allowance when unfairly dismissed, on death in service, on termination for physical incapacity, or on the employer's death, dissolution or insolvency (s.87). The amount is negotiated (s.89); where nothing was agreed, the Industrial Court has applied one month's wages per year of service (Donna Kamuli v DFCU Bank, 2015)." },
  { topic: "deductions", country: UG, source: "Employment Act 2006, s.46",
    rule: "An employer may deduct from wages only what a law or a collective agreement allows, or what the employee agreed to in writing; deductions as a penalty or for damage need the conditions in s.46." },
  { topic: "work_injury", country: UG, source: "Workers' Compensation Act (Cap. 225)",
    rule: "An employer must compensate an employee injured, or who gets an occupational disease, in the course of work, at the amounts the Act sets; accidents must be reported to the labour officer, and employers should insure the liability." },
  { topic: "safety", country: UG, source: "Occupational Safety and Health Act 2006",
    rule: "The employer must provide a safe workplace, protective equipment and training, register workplaces with the Department of Occupational Safety and Health, and report accidents." },
  { topic: "pension", country: UG, source: "National Social Security Fund Act (as amended in 2022)",
    rule: `Every employer, whatever its size, registers its employees with the NSSF and pays each month the employee's share (deducted from pay) and the employer's share of gross pay; ${RATES}.` },
  { topic: "paye", country: UG, source: "Income Tax Act (Uganda)",
    rule: `The employer withholds PAYE from employment income, including most benefits, and pays it to URA by the 15th of the following month; ${RATES}.` },
  { topic: "local_service_tax", country: UG, source: "Local Governments Act (Local Service Tax, as amended in 2008)",
    rule: `Employees earning above the threshold pay Local Service Tax to the local government where they work; the employer deducts it, in instalments over the first months of the financial year or as a lump sum, by band of monthly pay; ${RATES}.` },
  { topic: "minimum_wage", country: UG, source: "Employment Act 2006; Minimum Wages Advisory Board",
    rule: "Check the current position before relying on any figure: Uganda's minimum wage has long been set by old orders and has been under review. The amount your company uses is set under Settings > Minimum wage." },
  { topic: "harassment", country: UG, source: "Employment Act 2006, ss. 6 and 7",
    rule: "Discrimination on grounds such as sex, race, religion, disability, HIV status or pregnancy is prohibited, with equal pay for work of equal value (s.6). An employer of more than 25 employees must have measures against sexual harassment (s.7)." },
  { topic: "unions", country: UG, source: "Labour Unions Act 2006",
    rule: "Employees may join a union; an employer must recognise a union that represents more than half of the employees in a bargaining unit, and deduct union dues once recognised and authorised." },
  { topic: "child_labour", country: UG, source: "Employment Act 2006, s.32",
    rule: "A child under 12 may not be employed in any business; a child under 14 only in light work supervised by an adult; no child may do hazardous work or work between 7pm and 7am." },

  // ----------------------------------------------------------------------------------------------- General
  { topic: "core", country: GENERAL, source: "ILO Declaration on Fundamental Principles and Rights at Work (1998, amended 2022)",
    rule: "International good practice (not a country's law): the fundamental ILO conventions cover freedom of association and collective bargaining (C87, C98), no forced labour (C29, C105), no child labour (C138, C182), no discrimination and equal pay (C100, C111), and a safe and healthy working environment (C155, C187)." },
  { topic: "annual_leave", country: GENERAL, source: "ILO Holidays with Pay Convention (Revised) 1970, C132",
    rule: "International good practice: at least 3 working weeks of paid annual leave for a year of service, at least 2 weeks of it uninterrupted. Check the country's own law, which applies." },
  { topic: "maternity", country: GENERAL, source: "ILO Maternity Protection Convention 2000, C183",
    rule: "International good practice: at least 14 weeks' maternity leave paid at no less than two-thirds of earnings, protection from dismissal for pregnancy, and the right to return to the same or an equivalent job. Check the country's own law, which applies." },
  { topic: "termination", country: GENERAL, source: "ILO Termination of Employment Convention 1982, C158",
    rule: "International good practice: dismiss only for a valid reason connected with capacity, conduct or operational requirements; let the employee answer the allegations first; give reasonable notice or pay instead; allow an appeal to an independent body. Check the country's own law, which applies." },
  { topic: "pay", country: GENERAL, source: "ILO Protection of Wages Convention 1949, C95",
    rule: "International good practice: pay wages in money, regularly and directly to the worker; make only deductions allowed by law, a collective agreement or award; tell workers what makes up their pay each period." },
  { topic: "safety", country: GENERAL, source: "ILO Occupational Safety and Health Convention 1981, C155",
    rule: "International good practice: employers keep workplaces, machinery and processes safe as far as reasonably practicable, provide protective equipment and training at no cost to the worker, and workers may remove themselves from imminent serious danger." },
].map((e) => ({ asOf: HR_LAW_AS_OF, ...e }));

// topics that fall back to a General entry for a country we do not cover
const GENERAL_FALLBACK = {
  annual_leave: "annual_leave", maternity: "maternity", paternity: "maternity", sick_leave: "core", termination: "termination",
  notice: "termination", redundancy: "termination", severance: "termination", pay: "pay", deductions: "pay",
  unions: "core", safety: "safety", work_injury: "safety", harassment: "core", child_labour: "core", hours: "core",
};

const COUNTRY_WORDS = [
  [KE, /\bkenya|\bkra\b|\bshif\b|\bnhif\b|housing levy|\bnita\b|nairobi|mombasa|kisumu|nakuru|eldoret/i],
  [TZ, /tanzania|\btra\b|\bsdl\b|\bwcf\b|dar es salaam|dodoma|arusha|mwanza|zanzibar/i],
  [UG, /uganda|\bura\b|\blst\b|local service tax|kampala|entebbe|gulu|jinja|mbarara/i],
];
const OTHER_COUNTRIES = /rwanda|burundi|south sudan|ethiopia|somalia|nigeria|ghana|south africa|zambia|malawi|congo|\bdrc\b|india|united kingdom|\buk\b|united states|\busa\b|europe/i;

/** The covered countries named in a text, plus "General" when it names another country. */
export function countriesIn(text) {
  const t = String(text || "");
  const found = COUNTRY_WORDS.filter(([, re]) => re.test(t)).map(([c]) => c);
  if (OTHER_COUNTRIES.test(t)) found.push(GENERAL);
  return found;
}

/** A country as the entries name it: Kenya, Tanzania, Uganda, or General for any other. */
export function lawCountry(country) {
  const c = String(country || "").trim().toLowerCase();
  if (!c) return null;
  return HR_LAW_COUNTRIES.find((k) => k.toLowerCase() === c) ?? GENERAL;
}

/** The topics a question is about. */
export function topicsIn(text) {
  const t = String(text || "");
  return Object.entries(TOPIC_WORDS).filter(([, re]) => re.test(t)).map(([topic]) => topic);
}

export const MAX_HR_LAW_ENTRIES = 16;

/**
 * The entries for a question: its topics, in the countries it names, else the company's countries, else Kenya (the
 * main market). A country without its own entries gets the General ones. Nothing when the question has no legal topic.
 */
export function selectHrLaw({ text = "", countries = [], max = MAX_HR_LAW_ENTRIES } = {}) {
  const topics = topicsIn(text);
  if (!topics.length) return { countries: [], topics: [], entries: [] };
  const named = countriesIn(text);
  const fromCompany = countries.map(lawCountry).filter(Boolean);
  const chosen = [...new Set(named.length ? named : fromCompany.length ? fromCompany : [KE])];

  const entries = [];
  for (const country of chosen) {
    if (country === GENERAL) {
      const general = new Set(topics.map((t) => GENERAL_FALLBACK[t]).filter(Boolean));
      general.add("core");
      entries.push(...HR_LAW.filter((e) => e.country === GENERAL && general.has(e.topic)));
    } else {
      entries.push(...HR_LAW.filter((e) => e.country === country && topics.includes(e.topic)));
    }
  }
  return { countries: chosen, topics, entries: entries.slice(0, max) };
}

/** The instruction every assistant gets about legal questions, whether or not entries were found. */
export const HR_LAW_RULES = `Legal questions (labour, leave, termination, pay, tax, social security, safety):
- Answer from the cited rules below and the statutory rates given, nothing else. Cite the Act and section for each point, e.g. "(Employment Act 2007, s.28)".
- Say it is a guide, not legal advice, and that a person (HR, or a lawyer for disputes) should confirm before acting.
- If the rules below do not cover the question, or the country, say you do not have a cited rule for it and suggest checking the Act or a labour lawyer. Never guess a figure, a section number or a deadline.
- For rates, caps and minimum wages use only the figures given below from the app's statutory rates or the company's settings; if none are given, say they are in Settings and do not quote one.
- Rules marked General are international good practice, not the law of the country; say so.
- Each rule shows the date it was checked; mention that the law may have changed since.`;

/** The entries (and any rates) as the system prompt carries them. */
export function hrLawPrompt(entries, rates = []) {
  const lines = [HR_LAW_RULES, ""];
  if (!entries.length) {
    lines.push("Cited rules for this question: none found. If the question is about the law, say so as above.");
  } else {
    lines.push("Cited rules for this question:");
    for (const e of entries) lines.push(`- [${e.country}; ${e.topic}; checked ${e.asOf}] ${e.rule} Source: ${e.source}.`);
  }
  if (rates.length) {
    lines.push("", "Default statutory rates in force today, from the app's statutory_rates (a company may have its own):");
    for (const r of rates) lines.push(`- ${r.country} ${r.code}: ${r.text} (from ${r.effective_from}${r.source ? `; ${r.source}` : ""})`);
  }
  return lines.join("\n");
}
