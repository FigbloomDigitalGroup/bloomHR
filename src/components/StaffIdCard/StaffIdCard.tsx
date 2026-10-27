import { useId } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { code128Bars } from '../../lib/code128';
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '../../lib/companyProfile';
import type { LetterBranding } from '../../lib/offers';
import { companyAddress, wrapText } from './cardText';
import {
  type StaffIdCardData,
  type StaffIdCardSettings,
  cardDate,
  cardExpiry,
  formatCardDate,
  fullName,
  initials,
  nameParts,
  verifyUrl,
} from '../../lib/staffIdCards';

// The staff ID card (a "job card", migration 20261027400000): portrait CR80, 54 x 85.6 mm, front and back, in the
// company's colours. Each face is one SVG drawn at 10 units per millimetre, so the same drawing is sharp on a phone,
// in the PNG and PDF downloads (lib/staffIdCardExport.ts turns it into an image) and printed at its true size.
// SVG rather than HTML because the hexagon photo and the angled colour panels need clipping that html2canvas can't
// draw, and because a whole face as one image can be scaled to millimetres without anything reflowing.

export const CARD_W = 540;
export const CARD_H = 856;
const DARK = '#14171C';
const INK = '#1F2328';
const MUTED = '#6B7280';
const FONT = "'Geist Sans', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export interface CardFaceProps {
  card: StaffIdCardData;
  branding: LetterBranding;
  settings: StaffIdCardSettings;
  /** where the QR code points (the app's address); defaults to this page's */
  origin?: string;
  /** width on screen (any CSS length); the height follows */
  width?: string;
  className?: string;
}

const colours = (b: LetterBranding) => ({
  primary: b.primary_color || DEFAULT_PRIMARY_COLOR,
  secondary: b.secondary_color || DEFAULT_SECONDARY_COLOR,
});

/** Shortens text to about `max` characters, with an ellipsis. */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text);

/** A font size that fits about `chars` characters in `width` units (sans-serif averages ~0.55 em a character). */
const fit = (chars: number, width: number, max: number, min = 14) => Math.max(min, Math.min(max, width / (Math.max(chars, 1) * 0.56)));

/** A pointy-topped hexagon's corners around (cx, cy). */
const hexagon = (cx: number, cy: number, r: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

/** An id usable inside url(#...) (React's ids contain colons). */
const useSvgId = (prefix: string) => `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

function Svg({ label, width, className, children }: { label: string; width?: string; className?: string; children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      width={width ?? '100%'}
      role="img"
      aria-label={label}
      className={className}
      style={{ display: 'block', aspectRatio: `${CARD_W} / ${CARD_H}`, height: 'auto', fontFamily: FONT }}
      data-card-face=""
    >
      {children}
    </svg>
  );
}

/** The company's logo in a white rounded tile, or its first letter when it has none. */
function Logo({ branding, x, y, size, clipId }: { branding: LetterBranding; x: number; y: number; size: number; clipId: string }) {
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={size * 0.2} fill="#FFFFFF" />
      {branding.logo_url ? (
        <>
          <clipPath id={clipId}>
            <rect x={x + 4} y={y + 4} width={size - 8} height={size - 8} rx={size * 0.16} />
          </clipPath>
          <image
            href={branding.logo_url}
            x={x + 4} y={y + 4} width={size - 8} height={size - 8}
            preserveAspectRatio="xMidYMid meet"
            clipPath={`url(#${clipId})`}
            crossOrigin="anonymous"
            data-card-image="logo"
          />
        </>
      ) : (
        <text x={x + size / 2} y={y + size * 0.68} textAnchor="middle" fontSize={size * 0.5} fontWeight={800} fill={colours(branding).primary}>
          {(branding.name || '?').trim().charAt(0).toUpperCase()}
        </text>
      )}
    </g>
  );
}

export function StaffIdCardFront({ card, branding, settings, width, className }: CardFaceProps) {
  const { primary, secondary } = colours(branding);
  const photoClip = useSvgId('photo');
  const logoClip = useSvgId('logo');
  const { first, rest } = nameParts(card);
  const name = [first, rest].filter(Boolean).join(' ');
  // a long name goes on two lines: the first name, then the rest
  const twoLines = name.length > 20 && !!first && !!rest;
  const nameSize = twoLines ? fit(Math.max(first.length, rest.length), 470, 40) : fit(name.length, 470, 42);
  const company = clip(branding.name || '', 26);
  const title = card.job_title ? clip(card.job_title.toUpperCase(), 34) : '';
  const facts: [string, string][] = [
    ['ID NO', card.employee_number],
    ['DEPARTMENT', card.department ?? ''],
    ['PHONE', card.work_phone ?? ''],
    ['EMAIL', card.work_email ?? ''],
    ...(settings.show_date_of_birth && card.date_of_birth ? [['DOB', cardDate(card.date_of_birth)] as [string, string]] : []),
  ].filter(([, v]) => v) as [string, string][];
  const factsTop = twoLines ? 640 : 615;
  const barcode = code128Bars(card.employee_number);
  const unit = Math.min(3, 380 / barcode.width);
  const barX = (CARD_W - barcode.width * unit) / 2;
  const hexR = 118;
  const hexY = 318;

  return (
    <Svg label={`Staff ID card of ${fullName(card)}, front`} width={width} className={className}>
      <rect width={CARD_W} height={CARD_H} fill="#FFFFFF" />
      {/* the dark band with its angled edge, and the colour panels under it */}
      <polygon points={`0,0 ${CARD_W},0 ${CARD_W},215 0,300`} fill={DARK} />
      <polygon points={`0,300 ${CARD_W},215 ${CARD_W},255 0,340`} fill={primary} />
      <polygon points={`0,340 ${CARD_W * 0.5},297.5 ${CARD_W * 0.5},309.5 0,352`} fill={secondary} />
      <polygon points={`${CARD_W * 0.62},0 ${CARD_W},0 ${CARD_W},160`} fill={primary} opacity={0.35} />
      <polygon points={`${CARD_W * 0.8},0 ${CARD_W},0 ${CARD_W},70`} fill={secondary} opacity={0.8} />

      <Logo branding={branding} x={36} y={34} size={78} clipId={logoClip} />
      <text x={130} y={branding.tagline ? 70 : 82} fontSize={fit(company.length, 280, 30, 18)} fontWeight={800} fill="#FFFFFF">
        {company}
      </text>
      {branding.tagline && (
        <text x={130} y={100} fontSize={17} fill="#FFFFFF" opacity={0.75}>{clip(branding.tagline, 32)}</text>
      )}

      {/* the photo in a hexagon, initials when there is none (the photo covers them when it loads) */}
      <polygon points={hexagon(CARD_W / 2, hexY, hexR + 14)} fill={primary} />
      <polygon points={hexagon(CARD_W / 2, hexY, hexR + 6)} fill="#FFFFFF" />
      <polygon points={hexagon(CARD_W / 2, hexY, hexR)} fill="#E8ECEF" />
      <text x={CARD_W / 2} y={hexY + 30} textAnchor="middle" fontSize={84} fontWeight={800} fill={primary}>{initials(card)}</text>
      {card.photo_url && (
        <>
          <clipPath id={photoClip}>
            <polygon points={hexagon(CARD_W / 2, hexY, hexR)} />
          </clipPath>
          <image
            href={card.photo_url}
            x={CARD_W / 2 - hexR} y={hexY - hexR} width={hexR * 2} height={hexR * 2}
            preserveAspectRatio="xMidYMid slice"
            clipPath={`url(#${photoClip})`}
            crossOrigin="anonymous"
            data-card-image="photo"
          />
        </>
      )}

      {/* the name, first name bold */}
      {twoLines ? (
        <text x={CARD_W / 2} y={505} textAnchor="middle" fontSize={nameSize} fill={INK}>
          <tspan x={CARD_W / 2} fontWeight={800}>{first}</tspan>
          <tspan x={CARD_W / 2} dy={nameSize * 1.1} fontWeight={400}>{rest}</tspan>
        </text>
      ) : (
        <text x={CARD_W / 2} y={515} textAnchor="middle" fontSize={nameSize} fill={INK}>
          <tspan fontWeight={800}>{first}</tspan>
          {rest && <tspan fontWeight={400}>{first ? ` ${rest}` : rest}</tspan>}
        </text>
      )}
      {title && (
        <text x={CARD_W / 2} y={twoLines ? 578 : 553} textAnchor="middle" fontSize={fit(title.length, 440, 20, 13)} fontWeight={600} letterSpacing={1.5} fill={MUTED}>
          {title}
        </text>
      )}
      <line x1={CARD_W / 2 - 110} x2={CARD_W / 2 + 110} y1={twoLines ? 596 : 571} y2={twoLines ? 596 : 571} stroke={primary} strokeWidth={2} />

      {/* the details, two columns */}
      {facts.map(([label, value], i) => (
        <g key={label}>
          <text x={62} y={factsTop + i * 31} fontSize={15} fontWeight={700} letterSpacing={0.8} fill={MUTED}>{label}</text>
          <text x={192} y={factsTop + i * 31} fontSize={16.5} fontWeight={label === 'ID NO' ? 700 : 500} fill={INK}>
            {`: ${clip(value, 32)}`}
          </text>
        </g>
      ))}

      {/* the employee number as a barcode */}
      <g transform={`translate(${barX}, 776)`} data-barcode={card.employee_number}>
        {barcode.bars.map((b, i) => (
          <rect key={i} x={b.x * unit} y={0} width={b.w * unit} height={48} fill={INK} />
        ))}
      </g>
      <rect x={0} y={CARD_H - 14} width={CARD_W} height={14} fill={primary} />
      <rect x={CARD_W * 0.7} y={CARD_H - 14} width={CARD_W * 0.3} height={14} fill={secondary} />
    </Svg>
  );
}

export function StaffIdCardBack({ card, branding, settings, origin, width, className }: CardFaceProps) {
  const { primary, secondary } = colours(branding);
  const logoClip = useSvgId('logo');
  const company = branding.name || 'the company';
  const address = companyAddress(branding);
  const terms = [
    `This card is the property of ${company} and must be returned on leaving.`,
    'Carry it at all times at work and show it when asked.',
    `If found, please return to ${company}${address ? `, ${address}` : ''}.`,
  ];
  const termLines = terms.map((t) => wrapText(t, 46).slice(0, 3));
  let y = 92;
  const expiry = cardExpiry(card);
  const contact = [
    address && clip(address, 50),
    branding.phone && `Tel: ${branding.phone}`,
    branding.email && clip(branding.email, 44),
  ].filter(Boolean) as string[];

  return (
    <Svg label={`Staff ID card of ${fullName(card)}, back`} width={width} className={className}>
      <rect width={CARD_W} height={CARD_H} fill="#FFFFFF" />
      <polygon points={`0,0 ${CARD_W},0 ${CARD_W},330 0,400`} fill={DARK} />
      <polygon points={`0,400 ${CARD_W},330 ${CARD_W},360 0,430`} fill={primary} />
      <polygon points={`0,0 ${CARD_W * 0.3},0 0,120`} fill={primary} opacity={0.4} />
      <polygon points={`0,0 ${CARD_W * 0.14},0 0,52`} fill={secondary} opacity={0.85} />

      <text x={46} y={y - 32} fontSize={15} fontWeight={700} letterSpacing={2} fill={secondary}>STAFF ID CARD</text>
      {termLines.map((lines, i) => {
        const top = y;
        y += lines.length * 24 + 14;
        return (
          <g key={i}>
            <circle cx={52} cy={top - 6} r={4.5} fill={secondary} />
            <text x={68} y={top} fontSize={17} fill="#FFFFFF">
              {lines.map((line, j) => (
                <tspan key={j} x={68} dy={j === 0 ? 0 : 24}>{line}</tspan>
              ))}
            </text>
          </g>
        );
      })}
      <text x={46} y={Math.max(y + 12, 290)} fontSize={18} fill="#FFFFFF">
        <tspan fontWeight={700}>Joined Date: </tspan>
        <tspan>{cardDate(card.date_joined) || '—'}</tspan>
      </text>
      <text x={46} y={Math.max(y + 42, 320)} fontSize={18} fill="#FFFFFF">
        <tspan fontWeight={700}>Expiry Date: </tspan>
        <tspan>{formatCardDate(expiry) || '—'}</tspan>
      </text>

      {/* the authorised signatory */}
      {settings.signature && (
        <image href={settings.signature} x={40} y={472} width={230} height={86} preserveAspectRatio="xMidYMid meet" />
      )}
      <line x1={40} x2={270} y1={566} y2={566} stroke={INK} strokeWidth={1.5} />
      <text x={40} y={592} fontSize={17} fontWeight={700} fill={INK}>{clip(settings.signatory_name || 'Authorised signatory', 26)}</text>
      {settings.signatory_name && (
        <text x={40} y={615} fontSize={15} fill={MUTED}>{clip(settings.signatory_title || 'Authorised signatory', 28)}</text>
      )}

      {/* the QR code: opens the public check that says whether the person is a current employee */}
      <rect x={316} y={452} width={190} height={190} rx={12} fill="#FFFFFF" stroke="#E5E7EB" strokeWidth={2} />
      <QRCodeSVG value={verifyUrl(card.token, origin)} x={326} y={462} size={170} level="M" fgColor={INK} bgColor="#FFFFFF" />
      <text x={411} y={664} textAnchor="middle" fontSize={14} fontWeight={600} fill={MUTED}>Scan to verify</text>

      {/* the company's contacts */}
      <line x1={36} x2={CARD_W - 36} y1={690} y2={690} stroke="#E5E7EB" strokeWidth={2} />
      <Logo branding={branding} x={36} y={712} size={64} clipId={logoClip} />
      <text x={114} y={736} fontSize={fit(clip(company, 30).length, 380, 20, 14)} fontWeight={800} fill={INK}>{clip(company, 30)}</text>
      {contact.map((line, i) => (
        <text key={i} x={114} y={760 + i * 21} fontSize={14} fill={MUTED}>{line}</text>
      ))}
      <rect x={0} y={CARD_H - 14} width={CARD_W} height={14} fill={primary} />
      <rect x={0} y={CARD_H - 14} width={CARD_W * 0.3} height={14} fill={secondary} />
    </Svg>
  );
}

/** Both faces side by side (one above the other on a narrow phone). */
export default function StaffIdCard(props: Omit<CardFaceProps, 'width' | 'className'>) {
  return (
    <div className="flex flex-wrap justify-center gap-4" data-testid="staff-id-card">
      <div className="w-full max-w-[260px] rounded-[14px] overflow-hidden shadow-md ring-1 ring-black/5">
        <StaffIdCardFront {...props} />
      </div>
      <div className="w-full max-w-[260px] rounded-[14px] overflow-hidden shadow-md ring-1 ring-black/5">
        <StaffIdCardBack {...props} />
      </div>
    </div>
  );
}
