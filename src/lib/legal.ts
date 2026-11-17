// DRAFT for legal review: the Privacy Policy and Terms of Service, as data. They are written from what the product really
// does (the sub-processors, the kinds of data, the safeguards are the ones found in the code, and each statement was put to
// a skeptical read of the code) in plain language, for the company's lawyer to correct and approve. Nothing here is legal advice.
//
// Everything only the company can know is a [[PLACEHOLDER]]. The pages stay switched off (src/lib/legalGate.ts) until
// someone fills every placeholder in and sets LEGAL_REVIEWED to true; legal.test.ts refuses true while any are left.

import { PRICING, SITE, kes } from './landing';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  items?: string[];
}

export interface LegalDocument {
  title: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
}

const entity = '[[REGISTERED LEGAL NAME AND REGISTRATION NUMBER]]';
const address = '[[REGISTERED ADDRESS]]';

export const PRIVACY: LegalDocument = {
  title: 'Privacy Policy',
  updated: '[[DATE OF APPROVAL]]',
  intro: [
    `This policy explains how ${SITE.name}, a service provided by ${entity} ("Figbloom", "we"), handles personal data, and the choices and rights people have. It applies to this website and to the ${SITE.name} application.`,
    "It is based on the Kenya Data Protection Act, 2019. [[WHETHER THIS POLICY SHOULD ALSO REFER TO THE DATA PROTECTION LAWS OF OTHER COUNTRIES WHERE A COMPANY HAS STAFF]] If you are an employee of a company that uses Figbloom HR, most of your data is held by your employer, and the first place to ask about it is your employer's HR team.",
  ],
  sections: [
    {
      heading: 'Who is responsible for which data',
      paragraphs: [
        "When a company uses Figbloom HR to keep its employee records, run payroll and manage leave, the company decides what is collected and why. The company is the data controller for those records, and Figbloom processes them on the company's behalf and on its instructions, as its data processor.",
        'For the details of the people who sign up for or sign in to Figbloom HR (their email address, name and sign-in details), and for visitors to this website, Figbloom is the data controller.',
      ],
    },
    {
      heading: 'What we collect',
      items: [
        'Visitors to this website: this page sets no cookies and has no analytics or advertising trackers. Your browser requests fonts from Google Fonts when the page loads, which tells Google your IP address.',
        'Account details: your email address, name, the company or companies you belong to, your role, and the time of your last sign-in. Passwords are handled by our authentication provider, Supabase, which stores them hashed. One-time sign-in codes expire after 10 minutes and are stored only as a keyed hash.',
        "Company records, entered by the company and its people: identity and contact details, job and employment details, pay, allowances and deductions, tax and social-security numbers (such as the KRA PIN, NSSF and SHA numbers), bank or mobile-money details, emergency contacts and next of kin, leave, attendance, performance scores, warnings, and documents such as ID copies, certificates, contracts and CVs.",
        "Attendance: the times people clock in and out, from the web app or from a door scanner (the scanner's user ID, serial number and the time), and the reason given for using the web app. When someone clocks in or out in the web app, their browser asks for their location. If they allow it, the coordinates are saved with that clock-in or clock-out and HR can see them. If they say no, clocking in still works unless the company's policy requires an office location.",
        'Health information that an employee adds about themselves (such as a medical condition or an accommodation need, with supporting documents) is stored only after they agree to a consent statement. They can withdraw consent at any time, which deletes those records. HR can open it only by choosing to, and the app logs each time. Some company processes also involve health-related documents that this consent does not cover, such as a doctor\'s report for sick leave or medical reports in a work-injury case. These are held as ordinary company records.',
        'Messages and meetings: messages sent through the application, email or SMS the company sends through it, and, where video rooms and optional transcripts are used, the transcript of the meeting.',
        "Mailbox: where a person connects their own work mailbox, the server address, username and password they enter (the password is stored encrypted), and the emails and attachments they open, send or manage through the app. These pass through our server to reach the mail server and are not stored by Figbloom. A company can also connect its own mail server for the email it sends through the app, and its login details are stored encrypted.",
        "Job applications: where a company has published a vacancy on its careers page, the details and CV a candidate submits there.",
      ],
    },
    {
      heading: 'Why we use it',
      items: [
        'To provide the service: keeping records, running payroll, handling leave, attendance and approvals, and sending the notices that go with them.',
        'To keep accounts and data secure: signing people in, two-step sign-in where a company turns it on, limiting what each person can see, rate-limiting sign-in codes and other sensitive requests, and monitoring our own cloud account for threats.',
        'To support companies and to fix problems.',
        'To meet our legal obligations.',
      ],
      paragraphs: ['We do not sell personal data, and we do not use it for advertising.'],
    },
    {
      heading: 'Who else handles data for us',
      paragraphs: [
        'We use these service providers (sub-processors) to run Figbloom HR. Each receives only the data needed for the feature it provides; what that includes is described in this policy.',
      ],
      items: [
        'Supabase: database, sign-in, file storage and scheduled jobs.',
        'Vercel: hosting of the website and its server functions.',
        'Resend: sending emails such as invitations, notifications, sign-in codes and, where a company turns it on, payslips.',
        'Celcom Africa: sending SMS, where a company uses it.',
        'OpenAI: only for the optional AI features (the HR assistant, warning-letter drafts, meeting summaries, pay-item tax suggestions and the company set-up chat), and only where the server has them switched on and someone uses them. What is sent is the question or text entered and, for the HR assistant, the employee records the person asking is allowed to see, which can include every field in those records.',
        'Jitsi and 8x8: video rooms.',
        'Cloudflare Turnstile: a spam check on public careers pages, where it is switched on.',
        'Amazon Web Services: security monitoring of our own infrastructure account, and, for companies whose door scanners can only speak plain HTTP, a relay that forwards the scanner\'s attendance records to the app.',
        'Google Fonts: fonts. DiceBear: default avatar pictures in chat, which are requested using an identifier such as the employee number as the seed.',
        '[[CONFIRM THIS LIST AGAINST WHAT IS LIVE IN PRODUCTION. THE CODE ALSO HOLDS M-PESA (SAFARICOM) AND BANK PAYOUT CODE THAT RUNS FROM RENDER OR FLY.IO, WHICH THE TERMS SAY IS NOT USED TO PAY SALARIES: SAY WHICH, IF ANY, IS LIVE AND LIST IT HERE]]',
      ],
    },
    {
      heading: 'Where data is stored',
      paragraphs: [
        'The database, sign-in and file storage are hosted by Supabase in Frankfurt, Germany (region eu-central-1). Other providers listed above may process data in other countries, including outside Kenya and the European Union.',
        '[[SAFEGUARDS USED WHEN DATA IS TRANSFERRED OUT OF KENYA (FOR EXAMPLE CONTRACT TERMS WITH EACH PROVIDER), AND THE REGION WHERE VERCEL RUNS THE SERVER FUNCTIONS, WHICH THE CODE DOES NOT SET]]',
      ],
    },
    {
      heading: 'How long we keep it',
      paragraphs: [
        "A company decides what it keeps and can delete records it no longer needs. The app does not delete company records on a schedule. When an employee's health consent is withdrawn, their health records are deleted. Payslip PDFs sent by email are kept for the number of days the company sets, and then deleted.",
        '[[RETENTION: HOW LONG ACCOUNT DATA AND COMPANY DATA ARE KEPT AFTER A COMPANY LEAVES, AND HOW BACKUPS ARE HANDLED]]',
      ],
    },
    {
      heading: 'How we protect it',
      items: [
        "Each company's data is kept apart from every other company's by row-level security in the database, and automated tests try to cross that line on every change.",
        'What each person can open or change follows the permission modules of their role, checked in the database for the main HR and pay data as well as in the menus.',
        'Two-step sign-in with a single-use code sent by email is available to every company, and a person can turn it on for their own account. SMS codes are available only to people with a registered number.',
        'While you have the app open, it signs you out of that browser after 30 minutes without activity.',
        'Employee documents, contracts, leave documents and CVs are kept in private storage and opened through links that expire after an hour. Payslip PDFs are held in private storage only until they are emailed, or for the number of days the company sets. Profile photos and company logos are stored at public addresses.',
        'Secret keys for our providers are kept on the server, never in your browser.',
        'Passwords for connected mailboxes and mail servers are encrypted with a key held on the server, and open only for the company (and, for a mailbox, the person) they belong to.',
      ],
      paragraphs: ['No system is perfectly secure. If we learn of a breach that affects personal data, we will tell the affected company and the authorities as the law requires.'],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'Under the Data Protection Act, 2019 you have the right to be informed about how your data is used, to see it, to object to its use, to have it corrected, to have it deleted where the law allows, and to receive a copy of it in a usable form.',
        "To use these rights over your employment records, ask your employer first: they decide what is kept, and we can help them respond. To use them over your account details, or over this website, write to us at the address below.",
        'You may also complain to the Office of the Data Protection Commissioner in Kenya. [[ODPC REGISTRATION NUMBER, IF THE COMPANY IS REGISTERED]]',
      ],
    },
    {
      heading: 'Cookies and browser storage',
      paragraphs: [
        "This page sets no cookies. The application keeps your sign-in session and preferences (colours, text size and similar) in your browser's local storage, and sets one small cookie that remembers whether the chat sidebar is open. Video rooms and the careers-page spam check come from other companies and may set their own cookies. We use no advertising or analytics cookies.",
      ],
    },
    {
      heading: 'Children',
      paragraphs: [`${SITE.name} is for workplaces and is not directed at children.`],
    },
    {
      heading: 'Changes to this policy',
      paragraphs: ['If we change this policy in a way that matters, we will update the date at the top and tell account administrators.'],
    },
    {
      heading: 'Contact',
      paragraphs: [`Write to us at ${SITE.email}, or at ${address}. [[NAME OR TITLE OF THE PERSON RESPONSIBLE FOR DATA PROTECTION]]`],
    },
  ],
};

export const TERMS: LegalDocument = {
  title: 'Terms of Service',
  updated: '[[DATE OF APPROVAL]]',
  intro: [
    `These terms are an agreement between ${entity} ("Figbloom", "we") and the company or organisation that creates a ${SITE.name} workspace (the "company"). By creating a company, or by using the service on a company's behalf, you confirm that you are allowed to accept these terms for it.`,
  ],
  sections: [
    {
      heading: 'The service',
      paragraphs: [
        `${SITE.name} is a web application for keeping employee records and for managing leave, attendance, approvals and monthly payroll. We may improve, add or change features. Some features rely on services run by others, such as email and SMS delivery, and are only as available as those services are.`,
      ],
    },
    {
      heading: 'Your account and company',
      items: [
        'The person who creates a company becomes its administrator. The administrator invites others and decides their roles, and is responsible for the permissions the company gives.',
        'Give us accurate information and keep your sign-in details safe. Tell us promptly if you think someone else has used your account.',
        'People who join a company through an invitation are subject to these terms as far as they use the service.',
      ],
    },
    {
      heading: "The company's data",
      paragraphs: [
        "The company's records belong to the company. We process them only to provide the service and on the company's instructions, as described in our Privacy Policy.",
        "The company is responsible for having a lawful reason to hold its people's data, for telling them how it is used, and for the accuracy of what is entered.",
        '[[HOW A COMPANY CAN EXPORT ITS DATA, AND WHAT HAPPENS TO IT WHEN THE COMPANY LEAVES]]',
      ],
    },
    {
      heading: 'Payroll and statutory calculations',
      items: [
        "Figbloom works out each employee's payroll from the rates and rules in the system for their branch's country, which include dated statutory rates that people with payroll access can see and override for their company. The company must review each payroll before it approves it, and is responsible for the figures it approves, for filing its returns, and for paying its staff.",
        'Payroll in Figbloom does not send salary payments. The app produces files, and the company uploads them to its bank or mobile-money provider.',
        'Return files and guidance in the application are tools to help the company. They are not tax or legal advice.',
        "Payroll outside Kenya rests on assumptions about how each country's laws are applied. [[SAY WHETHER A TAX PROFESSIONAL HAS REVIEWED THESE ASSUMPTIONS, AND WHERE THEY ARE SET OUT]] The company should check its figures with its own adviser before relying on them.",
      ],
    },
    {
      heading: 'Acceptable use',
      items: [
        'Do not use the service unlawfully, or to harm or harass anyone.',
        "Do not try to reach another company's data, to break or probe the service's security, or to overload it.",
        'Do not upload malware or content you have no right to share.',
      ],
    },
    {
      heading: 'Availability and support',
      paragraphs: [
        'We work to keep the service available, but it is provided as it is, and we do not promise it will be uninterrupted or error-free.',
        '[[SERVICE LEVEL AND SUPPORT COMMITMENTS, IF ANY]]',
      ],
    },
    {
      heading: 'Fees',
      paragraphs: [
        // the amounts are the owner's decision of 2026-10-29, shown on the landing page (PRICING in landing.ts)
        `The fee is ${kes(PRICING.monthly)} a month for the company, plus ${kes(PRICING.perEmployee)} a month for each active employee.`,
        '[[PAYMENT TERMS: HOW AND WHEN THE FEE IS INVOICED, DUE DATE, VAT AND OTHER TAXES, LATE PAYMENT, WHAT COUNTS AS AN ACTIVE EMPLOYEE, AND NOTICE OF A CHANGE IN THE FEE]]',
      ],
    },
    {
      heading: 'Intellectual property',
      paragraphs: ['We own the service, its design and its software. The company owns its data. These terms do not transfer either to the other, apart from the right to use the service as described here.'],
    },
    {
      heading: 'Suspension and ending',
      paragraphs: [
        'A company can stop using the service at any time by writing to us; what happens to its data is described under "The company\'s data" above. We may suspend a company that breaks these terms or puts the service or others at risk, and will tell it why where we can.',
      ],
    },
    {
      heading: 'Liability',
      paragraphs: ['[[LIMITATION OF LIABILITY AND ANY WARRANTY DISCLAIMER, FOR YOUR LAWYER TO WRITE]]'],
    },
    {
      heading: 'Changes, law and disputes',
      paragraphs: [
        'We may update these terms. If a change matters, we will tell account administrators and update the date above.',
        '[[GOVERNING LAW AND HOW DISPUTES ARE SETTLED]]',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [`Write to us at ${SITE.email}, or at ${address}.`],
    },
  ],
};

/** Every [[PLACEHOLDER]] still left in the text. */
export function placeholdersIn(doc: LegalDocument): string[] {
  const text = [doc.updated, ...doc.intro, ...doc.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.items ?? [])])].join('\n');
  return text.match(/\[\[[^\]]*\]\]/g) ?? [];
}
